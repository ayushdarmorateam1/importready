import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, access, rm, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = join(root, 'bin', 'importready.mjs');

function run(args, cwd = root) {
  return spawnSync(process.execPath, [executable, ...args], { cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
}

async function fixture(t, csv = 'id,email\n001,a@example.com\n002,b@example.com\n') {
  const dir = await mkdtemp(join(root, '.importready-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'input.csv'), csv);
  return dir;
}

async function absent(path) {
  await assert.rejects(access(path), { code: 'ENOENT' });
}

test('help and version are available without an input file', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--protect-formulas/);
  assert.match(help.stdout, /5 MiB/);
  assert.equal(run(['--version']).stdout.trim(), '0.1.0');
});

test('valid CSV gets a data-free machine-readable report', async t => {
  const dir = await fixture(t, 'id,email\n001,private-record@example.com\n');
  const result = run(['input.csv', '--json'], dir);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.valid, true);
  assert.equal(report.stats.rows, 1);
  assert.equal(report.stats.columns, 2);
  assert.equal(report.file, 'input.csv');
  assert.equal('rows' in report, false);
  assert.equal(result.stdout.includes('private-record@example.com'), false);
});

test('CLI infers semicolons and supports an explicit delimiter', async t => {
  const dir = await fixture(t, 'id;email\n001;a@example.com\n');
  for (const args of [['input.csv', '--json'], ['input.csv', '--delimiter', 'semicolon', '--json']]) {
    const result = run(args, dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).delimiter, ';');
  }
});

test('validation errors return 1 and saved report matches JSON stdout', async t => {
  const dir = await fixture(t, 'id,email\n001,invalid\n001,b@example.com\n');
  await writeFile(join(dir, 'rules.json'), JSON.stringify([
    { column: 'id', unique: true, required: true },
    { column: 'email', type: 'email' },
  ]));
  const result = run(['input.csv', '--rules', 'rules.json', '--json', '--report', 'report.json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(issue => issue.code === 'TYPE'));
  assert.ok(report.issues.some(issue => issue.code === 'UNIQUE'));
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')), report);
});

test('malformed quoting blocks cleaned output but permits a diagnostic report', async t => {
  const dir = await fixture(t, 'id,email\n001,"unclosed\n');
  const result = run(['input.csv', '--out', 'cleaned.csv', '--trim', '--report', 'report.json', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cleanup.blocked, true);
  assert.ok(report.issues.some(issue => issue.code === 'UNCLOSED_QUOTE'));
  await absent(join(dir, 'cleaned.csv'));
  await access(join(dir, 'report.json'));
});

test('ragged rows cannot be silently discarded or padded on export', async t => {
  const dir = await fixture(t, 'id,email\n001,a@example.com,extra\n');
  const result = run(['input.csv', '--out', 'cleaned.csv', '--remove-empty', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).cleanup.blocked, true);
  await absent(join(dir, 'cleaned.csv'));
});

test('explicit repairs preserve leading zeros and leave the source untouched', async t => {
  const original = 'id,email\n001, a@example.com \n001,a@example.com\n,\n002,=SUM(1;2)\n';
  const dir = await fixture(t, original);
  const result = run(['input.csv', '--out', 'cleaned.csv', '--trim', '--remove-empty', '--dedupe', '--protect-formulas', '--json'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(dir, 'input.csv'), 'utf8'), original);
  const cleaned = await readFile(join(dir, 'cleaned.csv'), 'utf8');
  assert.match(cleaned, /001,a@example\.com/);
  assert.match(cleaned, /002,'=SUM\(1;2\)/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cleanup.changes.removedBlankRows, 1);
  assert.equal(report.cleanup.changes.removedDuplicateRows, 1);
  assert.equal(report.cleanup.changes.protectedCells, 1);
  assert.equal(report.cleanup.output.stats.rows, 2);
});

test('remaining semantic errors are preserved in output report and exit status', async t => {
  const dir = await fixture(t, 'email\n invalid \n');
  await writeFile(join(dir, 'rules.json'), '[{"column":"email","type":"email"}]');
  const result = run(['input.csv', '--rules', 'rules.json', '--out', 'cleaned.csv', '--trim', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).cleanup.output.valid, false);
  await access(join(dir, 'cleaned.csv'));
});

test('trimmed headers retain their original type and required checks', async t => {
  const dir = await fixture(t, ' email ,id\nbad,001\n,002\n');
  const rules = [{ column: ' email ', required: true, type: 'email' }];
  await writeFile(join(dir, 'rules.json'), JSON.stringify(rules));
  const result = run(['input.csv', '--rules', 'rules.json', '--out', 'cleaned.csv', '--trim', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.rules, rules, 'original rules remain unchanged');
  assert.deepEqual(report.cleanup.appliedRules, [{ column: 'email', required: true, type: 'email' }]);
  assert.ok(report.cleanup.output.issues.some(issue => issue.code === 'TYPE' && issue.columnName === 'email'));
  assert.ok(report.cleanup.output.issues.some(issue => issue.code === 'REQUIRED' && issue.row === 3));
  assert.equal(report.cleanup.output.issues.some(issue => issue.code === 'RULE_COLUMN_MISSING'), false);
  assert.equal(report.cleanup.output.written, true);
});

test('formula-protected headers retain their original type and required checks', async t => {
  const dir = await fixture(t, '=email,id\nbad,001\n,002\n');
  const rules = [{ column: '=email', required: true, type: 'email' }];
  await writeFile(join(dir, 'rules.json'), JSON.stringify(rules));
  const result = run(['input.csv', '--rules', 'rules.json', '--out', 'cleaned.csv', '--protect-formulas', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.rules, rules);
  assert.equal(report.cleanup.appliedRules[0].column, "'=email");
  assert.ok(report.cleanup.output.issues.some(issue => issue.code === 'TYPE' && issue.columnName === "'=email"));
  assert.ok(report.cleanup.output.issues.some(issue => issue.code === 'REQUIRED' && issue.row === 3));
  assert.equal(report.cleanup.output.issues.some(issue => issue.code === 'RULE_COLUMN_MISSING'), false);
});

test('header remapping does not invent targets for missing rule columns', async t => {
  const dir = await fixture(t, ' name \nAda\n');
  await writeFile(join(dir, 'rules.json'), '[{"column":"missing","required":true}]');
  const result = run(['input.csv', '--rules', 'rules.json', '--out', 'cleaned.csv', '--trim', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cleanup.appliedRules[0].column, 'missing');
  assert.ok(report.cleanup.output.issues.some(issue => issue.code === 'RULE_COLUMN_MISSING'));
});

test('cleanup that empties a headerless file blocks CSV output but preserves its report', async t => {
  const dir = await fixture(t, '\n');
  const result = run(['input.csv', '--no-header', '--remove-empty', '--out', 'cleaned.csv', '--report', 'report.json', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.cleanup.blocked, true);
  assert.equal(report.cleanup.output.written, false);
  assert.equal(report.cleanup.output.exportBlocked, true);
  assert.ok(report.cleanup.output.issues.some(issue => issue.code === 'EMPTY_FILE'));
  await absent(join(dir, 'cleaned.csv'));
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')), report);
});

test('warnings alone do not fail a CSV check', async t => {
  const dir = await fixture(t, 'id,value\n001,=SUM(1;2)\n');
  const result = run(['input.csv', '--json'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).stats.warnings > 0);
});

test('existing output is never overwritten and report creation is not partial', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'cleaned.csv'), 'keep me');
  const result = run(['input.csv', '--out', 'cleaned.csv', '--report', 'report.json'], dir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to overwrite/);
  assert.equal(await readFile(join(dir, 'cleaned.csv'), 'utf8'), 'keep me');
  await absent(join(dir, 'report.json'));
});

test('existing report prevents creation of another requested output', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'report.json'), 'keep me');
  const result = run(['input.csv', '--out', 'cleaned.csv', '--report', 'report.json'], dir);
  assert.equal(result.status, 2);
  await absent(join(dir, 'cleaned.csv'));
  assert.equal(await readFile(join(dir, 'report.json'), 'utf8'), 'keep me');
});

test('input and duplicate output paths are rejected', async t => {
  const dir = await fixture(t);
  const original = await readFile(join(dir, 'input.csv'), 'utf8');
  for (const args of [
    ['input.csv', '--out', './input.csv'],
    ['input.csv', '--report', 'input.csv'],
    ['input.csv', '--out', 'same.csv', '--report', './same.csv'],
  ]) {
    assert.equal(run(args, dir).status, 2);
  }
  assert.equal(await readFile(join(dir, 'input.csv'), 'utf8'), original);
  await absent(join(dir, 'same.csv'));
});

test('missing output directories fail before creating any output', async t => {
  const dir = await fixture(t);
  const result = run(['input.csv', '--out', 'cleaned.csv', '--report', 'missing/report.json'], dir);
  assert.equal(result.status, 2);
  await absent(join(dir, 'cleaned.csv'));
});

test('invalid arguments fail without changing input', async t => {
  const dir = await fixture(t);
  for (const args of [
    [], ['input.csv', 'extra.csv'], ['input.csv', '--unknown'],
    ['input.csv', '--delimiter', 'colon'], ['input.csv', '--trim'],
    ['input.csv', '--out', ''],
  ]) {
    const result = run(args, dir);
    assert.equal(result.status, 2, `${JSON.stringify(args)}: ${result.stdout} ${result.stderr}`);
  }
});

test('invalid rule schemas return usage error 2', async t => {
  const dir = await fixture(t);
  const invalidRules = [
    '{bad', '{}', '[null]', '[{"column":""}]',
    '[{"column":"id","required":"yes"}]',
    '[{"column":"id","type":"integer"}]',
    '[{"column":"id","pattern":".*"}]',
    '[{"column":"id"},{"column":"id","unique":true}]',
  ];
  for (const rules of invalidRules) {
    await writeFile(join(dir, 'rules.json'), rules);
    const result = run(['input.csv', '--rules', 'rules.json'], dir);
    assert.equal(result.status, 2, `${rules}: ${result.stdout} ${result.stderr}`);
  }
});

test('headerless input supports generated column-name rules', async t => {
  const dir = await fixture(t, '001,a@example.com\n002,invalid\n');
  await writeFile(join(dir, 'rules.json'), '[{"column":"Column 2","type":"email"}]');
  const result = run(['input.csv', '--no-header', '--rules', 'rules.json', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.hasHeader, false);
  assert.equal(report.stats.rows, 2);
  assert.ok(report.issues.some(issue => issue.code === 'TYPE' && issue.row === 2));
});

test('input encoding and byte limits are checked before parsing', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'invalid.csv'), Buffer.from([0xc3, 0x28]));
  const encoding = run(['invalid.csv'], dir);
  assert.equal(encoding.status, 2);
  assert.match(encoding.stderr, /UTF-8/);
  await writeFile(join(dir, 'large.csv'), Buffer.alloc(5 * 1024 * 1024 + 1, 65));
  const oversized = run(['large.csv'], dir);
  assert.equal(oversized.status, 2);
  assert.match(oversized.stderr, /5 MiB/);
});

test('directories and missing files are handled as I/O errors', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'directory.csv'));
  assert.equal(run(['directory.csv'], dir).status, 2);
  assert.equal(run(['missing.csv'], dir).status, 2);
});

test('row limit blocks export without quietly dropping records', async t => {
  const dir = await fixture(t, `id\n${'001\n'.repeat(50_001)}`);
  const result = run(['input.csv', '--out', 'cleaned.csv', '--json'], dir);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.code === 'ROW_LIMIT'));
  await absent(join(dir, 'cleaned.csv'));
});

test('text diagnostics escape terminal control characters', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'rules.json'), JSON.stringify([{ column: '\u001b[31m\u009b31m', required: true }]));
  const result = run(['input.csv', '--rules', 'rules.json'], dir);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout.includes('\u001b'), false);
  assert.equal(result.stderr.includes('\u001b'), false);
  assert.equal(result.stdout.includes('\u009b'), false);
  assert.equal(result.stderr.includes('\u009b'), false);
  assert.match(result.stdout, /\\u001b/);
  assert.match(result.stdout, /\\u009b/);
});
