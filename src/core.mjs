/** ImportReady: deterministic CSV inspection. No network calls or type coercion. */
const DELIMITERS = [',', ';', '\t', '|'];
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BLOCKING_CODES = new Set([
  'EMPTY_FILE', 'UNCLOSED_QUOTE', 'UNEXPECTED_QUOTE', 'TRAILING_QUOTE_CONTENT',
  'ROW_LIMIT', 'COLUMN_COUNT', 'EMPTY_HEADER', 'DUPLICATE_HEADER',
]);
const MAX_ISSUES = 1000;

function checkDelimiter(delimiter, auto = false) {
  if (!DELIMITERS.includes(delimiter) && !(auto && delimiter === 'auto')) {
    throw new TypeError('Delimiter must be comma, semicolon, tab, or pipe' + (auto ? ', or auto.' : '.'));
  }
}

// Compare delimiter counts outside quoted fields across a bounded sample of records.
function detectDelimiter(text) {
  const counts = [], current = [0, 0, 0, 0];
  let quoted = false, nonempty = false;
  for (let i = 0; i < text.length && i < 65536 && counts.length < 30; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (c === '\r' || c === '\n')) {
      if (nonempty) counts.push([...current]);
      current.fill(0);
      nonempty = false;
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (!quoted) {
      const index = DELIMITERS.indexOf(c);
      if (index >= 0) current[index]++;
    }
    if (!/\s/.test(c)) nonempty = true;
  }
  if (nonempty && counts.length < 30) counts.push(current);
  let best = ',', bestScore = 0;
  for (let column = 0; column < DELIMITERS.length; column++) {
    const frequencies = new Map();
    let positive = 0, modeCount = 0, modeFrequency = 0;
    for (const record of counts) {
      const count = record[column];
      if (!count) continue;
      positive++;
      const frequency = (frequencies.get(count) || 0) + 1;
      frequencies.set(count, frequency);
      if (frequency > modeFrequency) { modeFrequency = frequency; modeCount = count; }
    }
    const score = counts.length ? (positive * 50 + modeFrequency * 100) / counts.length + Math.min(modeCount, 10) : 0;
    if (score > bestScore) { best = DELIMITERS[column]; bestScore = score; }
  }
  return best;
}

/** Parse CSV without coercing cell values. maxRows counts logical CSV records. */
export function parseCSV(text, { delimiter = 'auto', maxRows = 50000 } = {}) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be a string.');
  checkDelimiter(delimiter, true);
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new TypeError('maxRows must be a positive integer.');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (delimiter === 'auto') delimiter = detectDelimiter(text);
  const rows = [], rowLines = [], errors = [];
  let row = [], field = '', state = 'start', line = 1, recordLine = 1;
  let fieldError = false, errorCount = 0, stopped = false;
  const error = (code, message) => {
    errorCount++;
    if (errors.length < MAX_ISSUES) errors.push({ code, severity: 'error', message, row: recordLine, column: row.length + 1 });
  };
  const endField = () => { row.push(field); field = ''; state = 'start'; fieldError = false; };
  const endRecord = () => {
    if (rows.length >= maxRows) { error('ROW_LIMIT', `More than ${maxRows.toLocaleString('en-US')} CSV records; split this file before checking it.`); stopped = true; return; }
    endField(); rows.push(row); rowLines.push(recordLine); row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else {
        field += c;
        if (c === '\r') {
          if (text[i + 1] === '\n') { field += '\n'; i++; }
          line++;
        } else if (c === '\n') line++;
      }
      continue;
    }
    if (c === delimiter) endField();
    else if (c === '\r' || c === '\n') {
      endRecord();
      if (stopped) break;
      if (c === '\r' && text[i + 1] === '\n') i++;
      recordLine = ++line;
    } else if (state === 'closed') {
      if (!fieldError) error('TRAILING_QUOTE_CONTENT', 'Unexpected text after a closing quote; use a delimiter or a line ending.');
      fieldError = true; field += c;
    } else if (c === '"') {
      if (state === 'start') state = 'quoted';
      else {
        if (!fieldError) error('UNEXPECTED_QUOTE', 'A quote appeared inside an unquoted field; quote the entire field and double embedded quotes.');
        fieldError = true; field += c;
      }
    } else { field += c; state = 'unquoted'; }
  }
  if (!stopped) {
    if (state === 'quoted') error('UNCLOSED_QUOTE', 'Quoted field reaches the end of the file without a closing quote.');
    if (row.length || field !== '' || state !== 'start') endRecord();
  }
  return { rows, rowLines, delimiter, errors, errorCount, errorsTruncated: errorCount - errors.length };
}

/** Conservative spreadsheet-formula warning; ordinary signed decimal numbers are exempt. */
export function isFormulaRisk(value) {
  if (/^[\t\r\n]/.test(value)) return true;
  const trimmed = value.trimStart();
  return /^[=+@-]/.test(trimmed) && !NUMBER.test(trimmed.trim());
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function validEmail(value) {
  // Deliberately basic syntax checking with bounded linear work on long cells.
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@'), dot = value.lastIndexOf('.');
  return at > 0 && at === value.lastIndexOf('@') && dot > at + 1 && dot < value.length - 1;
}

function checkRules(rules) {
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array.');
  const allowed = new Set(['column', 'required', 'unique', 'type']);
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.column !== 'string' || !rule.column.trim()) {
      throw new TypeError('Each rule must name a nonempty column.');
    }
    if (Object.keys(rule).some(key => !allowed.has(key))) throw new TypeError('Unknown rule property.');
    for (const flag of ['required', 'unique']) {
      if (rule[flag] !== undefined && typeof rule[flag] !== 'boolean') throw new TypeError(`${flag} must be a boolean.`);
    }
    if (rule.type !== undefined && !['text', 'email', 'number', 'date'].includes(rule.type)) throw new TypeError('Unknown rule type.');
  }
}

/** Inspect a CSV. rows excludes the header; diagnostic row numbers use physical lines. */
export function analyzeCSV(text, { delimiter = 'auto', hasHeader = true, rules = [], maxRows = 50000 } = {}) {
  if (typeof hasHeader !== 'boolean') throw new TypeError('hasHeader must be a boolean.');
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows >= Number.MAX_SAFE_INTEGER) throw new TypeError('maxRows must be a positive safe integer.');
  checkRules(rules);
  const parsed = parseCSV(text, { delimiter, maxRows: maxRows + (hasHeader ? 1 : 0) });
  const headers = hasHeader ? (parsed.rows[0] || []) : (parsed.rows[0] || []).map((_, i) => `Column ${i + 1}`);
  const rows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
  const rowLines = hasHeader ? parsed.rowLines.slice(1) : parsed.rowLines;
  const issues = [];
  let errors = parsed.errorsTruncated, warnings = 0, blankRows = 0, duplicateRows = 0, exportBlocked = parsed.errorCount > 0;
  const add = issue => {
    if (issue.severity === 'error') errors++; else warnings++;
    if (BLOCKING_CODES.has(issue.code)) exportBlocked = true;
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };
  parsed.errors.forEach(add);
  const issue = (code, severity, message, row, column) => add({ code, severity, message, ...(row === undefined ? {} : { row }), ...(column === undefined ? {} : { column, columnName: headers[column - 1] }) });
  if (!parsed.rows.length) issue('EMPTY_FILE', 'error', 'The file contains no CSV records.');
  const seenHeaders = new Map();
  if (hasHeader) headers.forEach((header, i) => {
    const name = header.trim();
    if (!name) issue('EMPTY_HEADER', 'error', 'Column has an empty header; assign a name before importing.', parsed.rowLines[0], i + 1);
    else if (seenHeaders.has(name)) issue('DUPLICATE_HEADER', 'error', `Header duplicates column ${seenHeaders.get(name)} after trimming surrounding whitespace.`, parsed.rowLines[0], i + 1);
    else seenHeaders.set(name, i + 1);
    if (header !== name) issue('HEADER_WHITESPACE', 'warning', 'Header has leading or trailing whitespace.', parsed.rowLines[0], i + 1);
    if (isFormulaRisk(header)) issue('FORMULA_RISK', 'warning', 'Header may be interpreted as a spreadsheet formula or control-prefixed value.', parsed.rowLines[0], i + 1);
  });
  const rowKeys = new Map();
  const compiledRules = rules.map(rule => ({ ...rule, index: headers.indexOf(rule.column), seen: new Map() }));
  for (const rule of compiledRules) {
    if (rule.index < 0) issue('RULE_COLUMN_MISSING', 'error', `Rule refers to missing column: ${rule.column}.`);
  }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], line = rowLines[index], blank = row.every(cell => !cell.trim());
    if (blank) { blankRows++; issue('BLANK_ROW', 'warning', 'Blank row; remove it only if your import does not need it.', line); }
    else if (row.length !== headers.length) issue('COLUMN_COUNT', 'error', `Expected ${headers.length} columns but found ${row.length}; check delimiters and quoting.`, line);
    const key = JSON.stringify(row);
    if (rowKeys.has(key)) { duplicateRows++; issue('DUPLICATE_ROW', 'warning', `Exact duplicate of the record starting on line ${rowKeys.get(key)}.`, line); }
    else rowKeys.set(key, line);
    row.forEach((cell, column) => {
      if (isFormulaRisk(cell)) issue('FORMULA_RISK', 'warning', 'Cell may be interpreted as a spreadsheet formula or control-prefixed value.', line, column + 1);
    });
    for (const rule of compiledRules) {
      if (rule.index < 0) continue;
      const value = row[rule.index] ?? '', trimmed = value.trim(), column = rule.index + 1;
      if (!trimmed) {
        if (rule.required) issue('REQUIRED', 'error', 'A value is required in this column.', line, column);
        continue;
      }
      if (rule.unique) {
        if (rule.seen.has(value)) issue('UNIQUE', 'error', `Value duplicates the record starting on line ${rule.seen.get(value)}.`, line, column);
        else rule.seen.set(value, line);
      }
      const valid = !rule.type || rule.type === 'text' ||
        (rule.type === 'email' && validEmail(trimmed)) ||
        (rule.type === 'number' && NUMBER.test(trimmed) && Number.isFinite(Number(trimmed))) ||
        (rule.type === 'date' && validDate(trimmed));
      if (!valid) issue('TYPE', 'error', `Expected ${rule.type === 'date' ? 'a real date in YYYY-MM-DD format' : `a valid ${rule.type} value`}.`, line, column);
    }
  }
  return { headers, rows, rowLines, delimiter: parsed.delimiter, hasHeader, issues, issuesTruncated: errors + warnings - issues.length,
    exportBlocked, stats: { rows: rows.length, columns: headers.length, errors, warnings, blankRows, duplicateRows }, valid: errors === 0 };
}

/** Serialize strings using explicit delimiters and quoting, never numeric conversion. */
export function serializeCSV(rows, { delimiter = ',', lineEnding = '\r\n', bom = false } = {}) {
  checkDelimiter(delimiter);
  if (!['\r\n', '\n', '\r'].includes(lineEnding)) throw new TypeError('Unsupported line ending.');
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array.');
  const content = rows.map(row => {
    if (!Array.isArray(row) || !row.length) throw new TypeError('Each CSV row must be a nonempty array of strings.');
    return row.map(cell => {
      if (typeof cell !== 'string') throw new TypeError('CSV cells must be strings.');
      // A literal BOM in a cell must not become the document's removable BOM.
      return cell.startsWith('\uFEFF') || cell.includes(delimiter) || /["\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
    }).join(delimiter);
  }).join(lineEnding);
  return (bom ? '\uFEFF' : '') + content + (rows.length ? lineEnding : '');
}

/** Apply only selected changes. Malformed/structurally ambiguous files cannot be exported. */
export function cleanupCSV(analysis, { trim = false, removeBlankRows = false, removeDuplicateRows = false, protectFormulas = false } = {}) {
  if (!analysis || !Array.isArray(analysis.rows) || !Array.isArray(analysis.headers)) throw new TypeError('Expected an ImportReady analysis.');
  if (analysis.exportBlocked || analysis.issues.some(item => BLOCKING_CODES.has(item.code))) {
    const error = new Error('Resolve malformed CSV, row limits, missing/duplicate headers, or inconsistent columns before exporting cleaned data.');
    error.code = 'UNSAFE_CLEANUP'; throw error;
  }
  const changes = { trimmedCells: 0, removedBlankRows: 0, removedDuplicateRows: 0, protectedCells: 0 };
  const trimCell = cell => {
    const result = trim ? cell.trim() : cell;
    if (result !== cell) changes.trimmedCells++;
    return result;
  };
  let headers = [...analysis.headers], rows = analysis.rows.map(row => row.map(trimCell));
  if (analysis.hasHeader) headers = headers.map(trimCell);
  const seen = new Set();
  rows = rows.filter(row => {
    if (removeBlankRows && row.every(cell => !cell.trim())) { changes.removedBlankRows++; return false; }
    const key = JSON.stringify(row);
    if (removeDuplicateRows && seen.has(key)) { changes.removedDuplicateRows++; return false; }
    seen.add(key); return true;
  });
  if (protectFormulas) {
    const protect = cell => { if (isFormulaRisk(cell)) { changes.protectedCells++; return `'${cell}`; } return cell; };
    if (analysis.hasHeader) headers = headers.map(protect);
    rows = rows.map(row => row.map(protect));
  }
  return { headers, rows, changes, csv: serializeCSV(analysis.hasHeader ? [headers, ...rows] : rows, { delimiter: analysis.delimiter }) };
}
