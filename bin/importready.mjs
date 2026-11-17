#!/usr/bin/env node
import { open, readFile, lstat, stat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeCSV, cleanupCSV } from '../src/core.mjs';

const VERSION = '0.1.0';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 50_000;
const DELIMITERS = { auto: 'auto', comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const TYPES = new Set(['text', 'email', 'number', 'date']);
const RULE_KEYS = new Set(['column', 'required', 'unique', 'type']);
const HELP = `ImportReady ${VERSION} — CSV checks that stay on your machine

Usage: importready <file.csv> [options]
       node bin/importready.mjs <file.csv> [options]

Checks:
  --delimiter <name>     auto (default), comma, semicolon, tab, or pipe
  --no-header            Treat every record as data; rules use Column 1, etc.
  --rules <rules.json>    Array of column rules: column, required, unique, type
  --json                 Print a machine-readable report, without raw records
  --report <report.json>  Save that report to a new file

Explicit cleanup (requires --out):
  --out <cleaned.csv>     Write a new file; never overwrite an existing file
  --trim                 Trim leading and trailing whitespace from cells
  --remove-empty         Remove records whose cells are all blank
  --dedupe               Remove exact duplicate records after selected repairs
  --protect-formulas     Prefix spreadsheet-formula-like values with an apostrophe

  -h, --help             Show this help
  -v, --version          Print the version

Limits: UTF-8 input, 5 MiB per CSV, 50,000 data records. No network requests.
Types: text, email, number, date (ISO YYYY-MM-DD). Values remain strings.
Exit codes: 0 = no validation errors; 1 = validation errors; 2 = usage or I/O error.
Warnings do not fail the command. With --out, exit status uses the cleaned file.
Malformed CSV or ambiguous headers block cleaned export; reports remain available.
Formula protection changes values and is a conservative mitigation, not a guarantee.
`;

function display(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, c =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

async function readLimited(path, maxBytes, label) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} must be a regular file.`);
  if (info.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes === MAX_BYTES ? '5 MiB' : '256 KiB'} limit.`);
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new Error(`${label} grew beyond its size limit while being read.`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8. Export it as UTF-8 CSV and try again.`);
  }
}

async function readRules(path) {
  let rules;
  try {
    rules = JSON.parse(await readLimited(path, 256 * 1024, 'Rules file'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Rules file must contain valid JSON.');
    throw error;
  }
  if (!Array.isArray(rules)) throw new Error('Rules must be a JSON array of column-rule objects.');
  if (rules.length > 1_000) throw new Error('Rules file can contain at most 1,000 column rules.');
  const columns = new Set();
  for (const [index, rule] of rules.entries()) {
    const label = `Rule ${index + 1}`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error(`${label} must be an object.`);
    if (Object.keys(rule).some(key => !RULE_KEYS.has(key))) throw new Error(`${label} has an unknown property. Allowed: column, required, unique, type.`);
    if (typeof rule.column !== 'string' || !rule.column.trim()) throw new Error(`${label} needs a nonempty column name.`);
    if (columns.has(rule.column)) throw new Error(`${label} repeats a column. Combine its checks in one rule.`);
    columns.add(rule.column);
    for (const key of ['required', 'unique']) {
      if (key in rule && typeof rule[key] !== 'boolean') throw new Error(`${label}.${key} must be true or false.`);
    }
    if ('type' in rule && !TYPES.has(rule.type)) throw new Error(`${label}.type must be text, email, number, or date.`);
  }
  return rules;
}

function summarize(analysis) {
  return {
    valid: analysis.valid,
    exportBlocked: Boolean(analysis.exportBlocked),
    delimiter: analysis.delimiter,
    hasHeader: analysis.hasHeader,
    stats: analysis.stats,
    issues: analysis.issues,
    issuesTruncated: Boolean(analysis.issuesTruncated),
  };
}

// Exclusive creation prevents accidental input/output replacement. Roll back only
// files this process created if another requested output cannot be completed.
async function writeOutputs(outputs, inputPath) {
  const paths = new Set();
  for (const output of outputs) {
    output.path = resolve(output.path);
    if (output.path === inputPath) throw new Error('An output path cannot be the input CSV path.');
    if (paths.has(output.path)) throw new Error('CSV output and report must use different file paths.');
    paths.add(output.path);
    try {
      await lstat(output.path);
      throw new Error(`Refusing to overwrite existing file: ${output.path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = await stat(dirname(output.path));
    if (!parent.isDirectory()) throw new Error(`Output parent is not a directory: ${dirname(output.path)}`);
  }
  const created = [];
  try {
    for (const output of outputs) {
      const handle = await open(output.path, 'wx', 0o600);
      const identity = await handle.stat();
      created.push({ path: output.path, identity });
      try {
        await handle.writeFile(output.contents, 'utf8');
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    for (const file of created) {
      try {
        const current = await lstat(file.path);
        if (current.dev === file.identity.dev && current.ino === file.identity.ino) await unlink(file.path);
      } catch { /* Preserve the original failure; never delete another file. */ }
    }
    throw error;
  }
}

function printText(report, paths) {
  const { stats } = report;
  console.log(`ImportReady ${VERSION} — ${display(report.file)}`);
  console.log(`${stats.rows} data records, ${stats.columns} columns, ${stats.errors} errors, ${stats.warnings} warnings`);
  for (const issue of report.issues.slice(0, 25)) {
    const location = [issue.row ? `line ${issue.row}` : '', issue.column ? `column ${issue.column}` : ''].filter(Boolean).join(', ');
    console.log(`${String(issue.severity).toUpperCase()} [${display(issue.code)}]${location ? ` ${location}:` : ':'} ${display(issue.message)}`);
  }
  if (report.issues.length > 25 || report.issuesTruncated) {
    console.log('More issues are available with --json or --report (the issue list is capped at 1,000).');
  }
  if (report.cleanup?.blocked) console.log(`Cleaned export blocked: ${display(report.cleanup.reason)}`);
  if (report.cleanup?.output && !report.cleanup.blocked) {
    const after = report.cleanup.output.stats;
    console.log(`Cleaned CSV: ${display(paths.out)}`);
    console.log(`After cleanup: ${after.rows} data records, ${after.errors} errors, ${after.warnings} warnings`);
    console.log(`Changes: ${Object.entries(report.cleanup.changes).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  if (paths.report) console.log(`Report: ${display(paths.report)}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      delimiter: { type: 'string', default: 'auto' },
      'no-header': { type: 'boolean' },
      rules: { type: 'string' },
      json: { type: 'boolean' },
      out: { type: 'string' },
      report: { type: 'string' },
      trim: { type: 'boolean' },
      'remove-empty': { type: 'boolean' },
      dedupe: { type: 'boolean' },
      'protect-formulas': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) { console.log(HELP); return 0; }
  if (values.version) { console.log(VERSION); return 0; }
  if (positionals.length !== 1) throw new Error('Provide exactly one CSV file. Run with --help for usage.');
  if (!Object.hasOwn(DELIMITERS, values.delimiter)) throw new Error('Delimiter must be auto, comma, semicolon, tab, or pipe.');
  for (const name of ['out', 'report', 'rules']) {
    if (name in values && !values[name].trim()) throw new Error(`--${name} requires a nonempty file path.`);
  }
  const repairOptions = {
    trim: Boolean(values.trim),
    removeBlankRows: Boolean(values['remove-empty']),
    removeDuplicateRows: Boolean(values.dedupe),
    protectFormulas: Boolean(values['protect-formulas']),
  };
  if (!values.out && Object.values(repairOptions).some(Boolean)) throw new Error('Cleanup flags require --out <new-file.csv>.');
  const inputPath = resolve(positionals[0]);
  const options = {
    delimiter: DELIMITERS[values.delimiter],
    hasHeader: !values['no-header'],
    rules: values.rules ? await readRules(values.rules) : [],
    maxRows: MAX_ROWS,
  };
  const text = await readLimited(inputPath, MAX_BYTES, 'CSV file');
  const analysis = analyzeCSV(text, options);
  const report = {
    schemaVersion: 1, tool: 'ImportReady', version: VERSION, file: basename(inputPath),
    rules: options.rules.map(rule => ({ ...rule })), ...summarize(analysis),
  };
  const outputs = [];
  let result = analysis.valid ? 0 : 1;
  if (values.out) {
    try {
      const cleaned = cleanupCSV(analysis, repairOptions);
      // Rules refer to columns, so an explicitly repaired header must retain its
      // original checks. Leave genuinely missing columns missing in the report.
      const appliedRules = options.rules.map(rule => {
        const index = analysis.headers.indexOf(rule.column);
        return { ...rule, column: index >= 0 ? cleaned.headers[index] : rule.column };
      });
      const after = analyzeCSV(cleaned.csv, { ...options, rules: appliedRules, delimiter: analysis.delimiter });
      report.cleanup = {
        requested: repairOptions,
        changes: cleaned.changes,
        appliedRules,
        output: { file: basename(values.out), written: !after.exportBlocked, ...summarize(after) },
      };
      if (after.exportBlocked) {
        report.cleanup.blocked = true;
        report.cleanup.reason = 'The selected changes leave an empty or structurally invalid CSV. Adjust the cleanup options before exporting.';
      } else {
        outputs.push({ path: values.out, contents: cleaned.csv });
      }
      result = after.valid ? 0 : 1;
    } catch (error) {
      if (error.code !== 'UNSAFE_CLEANUP') throw error;
      report.cleanup = { requested: repairOptions, blocked: true, reason: error.message };
      result = 1;
    }
  }
  if (values.report) outputs.push({ path: values.report, contents: `${JSON.stringify(report, null, 2)}\n` });
  await writeOutputs(outputs, inputPath);
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printText(report, { out: values.out, report: values.report });
  return result;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`ImportReady: ${display(error.message)}`);
  process.exitCode = 2;
}
