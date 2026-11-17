import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, analyzeCSV, cleanupCSV, serializeCSV, isFormulaRisk } from '../src/core.mjs';

test('parses quoted delimiters, escaped quotes and original multiline line endings', () => {
  const parsed = parseCSV('\uFEFFid,name,note\r\n001,"A, B","said ""hello""\r\nagain"\r\n002,C,done\r\n');
  assert.deepEqual(parsed.rows, [
    ['id', 'name', 'note'], ['001', 'A, B', 'said "hello"\r\nagain'], ['002', 'C', 'done'],
  ]);
  assert.deepEqual(parsed.rowLines, [1, 2, 4]);
  assert.equal(parsed.errors.length, 0);
});

test('auto-detection ignores punctuation inside quotes and supports all separators', () => {
  for (const delimiter of [',', ';', '\t', '|']) {
    const text = ['id', 'note', 'amount'].join(delimiter) + '\n' + ['001', '"one,two;three|four\tfive"', '0'].join(delimiter);
    const parsed = parseCSV(text);
    assert.equal(parsed.delimiter, delimiter);
    assert.deepEqual(parsed.rows[1], ['001', 'one,two;three|four\tfive', '0']);
  }
});

test('auto-detection favors a consistent delimiter over unquoted thousands separators', () => {
  const parsed = parseCSV('name;amount\nA;1,000\nB;2,000');
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.rows[1], ['A', '1,000']);
});

test('explicit delimiter overrides automatic detection', () => {
  assert.deepEqual(parseCSV('a,b;c,d', { delimiter: ';' }).rows, [['a,b', 'c,d']]);
});

test('terminal newlines do not create phantom records, actual blank lines do', () => {
  const cases = [
    ['', []], ['\uFEFF', []], ['a\n', [['a']]], ['a\r', [['a']]], ['a\r\n', [['a']]],
    ['\n', [['']]], ['\n\n', [[''], ['']]], ['a\n\n', [['a'], ['']]],
    ['a,', [['a', '']]], ['""', [['']]], [',', [['', '']]],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseCSV(text).rows, expected, JSON.stringify(text));
});

test('reports different malformed quoting cases without pretending to repair them', () => {
  for (const [text, code] of [
    ['name\n"unfinished', 'UNCLOSED_QUOTE'],
    ['name\nhe"llo', 'UNEXPECTED_QUOTE'],
    ['name\n"hello"world', 'TRAILING_QUOTE_CONTENT'],
    ['name\n"hello" ', 'TRAILING_QUOTE_CONTENT'],
  ]) {
    const result = analyzeCSV(text);
    assert.ok(result.issues.some(issue => issue.code === code), code);
    assert.equal(result.valid, false);
    assert.throws(() => cleanupCSV(result), { code: 'UNSAFE_CLEANUP' });
  }
});

test('diagnostics identify physical starting lines after multiline cells', () => {
  const result = analyzeCSV('id,note\n1,"two\nlines"\n2,ok,extra\n3,"unfinished');
  assert.equal(result.issues.find(issue => issue.code === 'COLUMN_COUNT').row, 4);
  assert.equal(result.issues.find(issue => issue.code === 'UNCLOSED_QUOTE').row, 5);
});

test('empty input is an error; a header-only CSV remains valid', () => {
  assert.equal(analyzeCSV('').issues[0].code, 'EMPTY_FILE');
  assert.throws(() => cleanupCSV(analyzeCSV('')), { code: 'UNSAFE_CLEANUP' });
  const result = analyzeCSV('id,name\n');
  assert.equal(result.valid, true);
  assert.equal(result.stats.rows, 0);
  assert.equal(cleanupCSV(result).csv, 'id,name\r\n');
});

test('header checks cover blank names, whitespace, and duplicate names', () => {
  const result = analyzeCSV('id, id , \n1,2,3');
  assert.deepEqual(result.headers, ['id', ' id ', ' ']);
  assert.ok(result.issues.some(issue => issue.code === 'DUPLICATE_HEADER'));
  assert.ok(result.issues.some(issue => issue.code === 'EMPTY_HEADER'));
  assert.equal(result.issues.filter(issue => issue.code === 'HEADER_WHITESPACE').length, 2);
  assert.throws(() => cleanupCSV(result, { trim: true }), { code: 'UNSAFE_CLEANUP' });
});

test('ragged nonblank rows prevent cleanup; blank rows can be deliberately removed', () => {
  const ragged = analyzeCSV('a,b\n1,2,3');
  assert.ok(ragged.issues.some(issue => issue.code === 'COLUMN_COUNT'));
  assert.throws(() => cleanupCSV(ragged, { removeBlankRows: true }), { code: 'UNSAFE_CLEANUP' });
  const blank = analyzeCSV('a,b\n\n1,2\n,\n');
  assert.equal(blank.stats.blankRows, 2);
  assert.equal(blank.exportBlocked, false);
  assert.deepEqual(cleanupCSV(blank, { removeBlankRows: true }).rows, [['1', '2']]);
});

test('no-header mode keeps the first record and supplies stable rule names', () => {
  const result = analyzeCSV('001,a@example.com\n002,nope', { hasHeader: false, rules: [{ column: 'Column 2', type: 'email' }] });
  assert.equal(result.hasHeader, false);
  assert.deepEqual(result.headers, ['Column 1', 'Column 2']);
  assert.equal(result.stats.rows, 2);
  assert.equal(result.issues.find(issue => issue.code === 'TYPE').row, 2);
  assert.equal(cleanupCSV(result).csv, '001,a@example.com\r\n002,nope\r\n');
});

test('values, leading zeros, whitespace and long identifiers are preserved by default', () => {
  const text = 'id,amount,note\n000012345678901234567890,1.20, hello \n';
  const result = analyzeCSV(text);
  const cleaned = cleanupCSV(result);
  assert.deepEqual(cleaned.rows, [['000012345678901234567890', '1.20', ' hello ']]);
  assert.deepEqual(cleaned.changes, { trimmedCells: 0, removedBlankRows: 0, removedDuplicateRows: 0, protectedCells: 0 });
});

test('exact duplicates use entire records, retaining the first occurrence', () => {
  const result = analyzeCSV('id,value\n1,a\n1,b\n1,a\n01,a\n1,a ');
  assert.equal(result.stats.duplicateRows, 1);
  assert.equal(result.issues.find(issue => issue.code === 'DUPLICATE_ROW').row, 4);
  assert.deepEqual(cleanupCSV(result, { removeDuplicateRows: true }).rows, [['1', 'a'], ['1', 'b'], ['01', 'a'], ['1', 'a ']]);
});

test('explicit cleanup order is trim, remove blank rows, deduplicate, protect formulas', () => {
  const result = analyzeCSV(' id ,note\n 001 , hello \n001,hello\n , \n002, =1+2');
  const snapshot = structuredClone(result);
  const cleaned = cleanupCSV(result, { trim: true, removeBlankRows: true, removeDuplicateRows: true, protectFormulas: true });
  assert.deepEqual(cleaned.headers, ['id', 'note']);
  assert.deepEqual(cleaned.rows, [['001', 'hello'], ['002', "'=1+2"]]);
  assert.deepEqual(cleaned.changes, { trimmedCells: 6, removedBlankRows: 1, removedDuplicateRows: 1, protectedCells: 1 });
  assert.deepEqual(result, snapshot, 'cleanup must not mutate its analysis');
});

test('formula warnings exempt ordinary signed numbers and mitigation is opt-in', () => {
  for (const value of ['=SUM(A1:A2)', '  +cmd', '-cmd', '@SUM(1)', '\tvalue', '\nvalue']) assert.equal(isFormulaRisk(value), true, value);
  for (const value of ['-42', '+1.25', ' -1e3 ', "'=1+2", 'plain']) assert.equal(isFormulaRisk(value), false, value);
  const result = analyzeCSV('value\n=1+2\n-42');
  assert.equal(result.stats.warnings, 1);
  assert.equal(cleanupCSV(result).rows[0][0], '=1+2');
  assert.equal(cleanupCSV(result, { protectFormulas: true }).rows[0][0], "'=1+2");
});

test('formula mitigation covers headers too', () => {
  const result = analyzeCSV('=formula,id\nvalue,001');
  assert.equal(result.issues[0].code, 'FORMULA_RISK');
  const cleaned = cleanupCSV(result, { protectFormulas: true });
  assert.deepEqual(cleaned.headers, ["'=formula", 'id']);
  assert.equal(cleaned.changes.protectedCells, 1);
});

test('rules check required, exact uniqueness and types without converting cells', () => {
  const rules = [{ column: 'id', required: true, unique: true }, { column: 'email', type: 'email' }, { column: 'amount', type: 'number' }];
  const result = analyzeCSV('id,email,amount\n001,a@example.com,01.20\n001,invalid,0xFF\n , ,1e999', { rules });
  assert.equal(result.issues.filter(issue => issue.code === 'UNIQUE').length, 1);
  assert.equal(result.issues.filter(issue => issue.code === 'REQUIRED').length, 1);
  assert.equal(result.issues.filter(issue => issue.code === 'TYPE').length, 3);
  assert.equal(result.rows[0][2], '01.20');
  assert.equal(result.exportBlocked, false, 'semantic errors are reported but do not block selected cleanup');
});

test('date rules validate real calendar dates including century leap-year rules', () => {
  const dates = ['2024-02-29', '2000-02-29', '1900-02-29', '2023-02-29', '2024-04-31', '2024-12-31', '0000-01-01', '01/02/2024'];
  const result = analyzeCSV('date\n' + dates.join('\n'), { rules: [{ column: 'date', type: 'date' }] });
  assert.deepEqual(result.issues.filter(issue => issue.code === 'TYPE').map(issue => issue.row), [4, 5, 6, 8, 9]);
});

test('email validation handles very long adversarial cells in linear work', () => {
  const value = 'a@' + 'a.'.repeat(250000) + '@';
  const result = analyzeCSV('email\n' + value, { rules: [{ column: 'email', type: 'email' }] });
  assert.equal(result.issues.filter(issue => issue.code === 'TYPE').length, 1);
});

test('unknown columns report errors; dangerous object-like strings are ordinary data', () => {
  const result = analyzeCSV('__proto__,constructor\none,two\none,three', { rules: [{ column: '__proto__', unique: true }, { column: 'missing', required: true }] });
  assert.equal(result.issues.filter(issue => issue.code === 'RULE_COLUMN_MISSING').length, 1);
  assert.equal(result.issues.filter(issue => issue.code === 'UNIQUE').length, 1);
});

test('row limits never permit truncated files to be exported', () => {
  const atLimit = analyzeCSV('id\n1\n2\n', { maxRows: 2 });
  assert.equal(atLimit.valid, true);
  const overLimit = analyzeCSV('id\n1\n2\n3\n', { maxRows: 2 });
  assert.equal(overLimit.stats.rows, 2);
  assert.ok(overLimit.issues.some(issue => issue.code === 'ROW_LIMIT'));
  assert.throws(() => cleanupCSV(overLimit), { code: 'UNSAFE_CLEANUP' });
  const noHeader = analyzeCSV('1\n2\n3', { hasHeader: false, maxRows: 2 });
  assert.equal(noHeader.stats.rows, 2);
  assert.equal(noHeader.exportBlocked, true);
});

test('capped diagnostics retain full counts and do not hide cleanup blockers', () => {
  const text = 'a,b\n' + Array.from({ length: 1100 }, (_, i) => `${i},=1+2`).join('\n') + '\nbroken';
  const result = analyzeCSV(text);
  assert.equal(result.issues.length, 1000);
  assert.equal(result.stats.warnings, 1100);
  assert.equal(result.stats.errors, 1);
  assert.equal(result.issuesTruncated, 101);
  assert.equal(result.exportBlocked, true);
  assert.throws(() => cleanupCSV(result), { code: 'UNSAFE_CLEANUP' });
});

test('parser caps stored errors but analysis retains total error count', () => {
  const text = 'value\n' + Array.from({ length: 1100 }, (_, i) => `row${i}"bad`).join('\n');
  const parsed = parseCSV(text, { delimiter: ',' });
  assert.equal(parsed.errorCount, 1100);
  assert.equal(parsed.errors.length, 1000);
  const result = analyzeCSV(text, { delimiter: ',' });
  assert.equal(result.stats.errors, 1100);
  assert.equal(result.issuesTruncated, 100);
});

test('serialization round-trips strings with quotes, separators and every line ending', () => {
  const rows = [['a', 'b', 'c'], ['"hello"', 'comma,semicolon;tab\tpipe|', 'line\r\nnext\rthird\nlast'], ['', '001', '  value  ']];
  for (const delimiter of [',', ';', '\t', '|']) {
    for (const lineEnding of ['\r\n', '\n', '\r']) {
      const text = serializeCSV(rows, { delimiter, lineEnding, bom: true });
      assert.deepEqual(parseCSV(text, { delimiter }).rows, rows);
    }
  }
});

test('a literal BOM inside the first cell survives serialization', () => {
  const rows = [['\uFEFFliteral', 'value']];
  assert.deepEqual(parseCSV(serializeCSV(rows)).rows, rows);
  const result = analyzeCSV('"\uFEFFliteral",value', { hasHeader: false });
  assert.deepEqual(parseCSV(cleanupCSV(result).csv).rows, rows);
});

test('invalid configuration fails clearly instead of silently changing behavior', () => {
  for (const options of [{ delimiter: ':' }, { maxRows: 0 }, { maxRows: 1.5 }]) assert.throws(() => parseCSV('a', options), TypeError);
  assert.throws(() => parseCSV(null), TypeError);
  for (const rules of [null, {}, [{ column: '' }], [{ column: 'a', regex: '.*' }], [{ column: 'a', required: 'yes' }], [{ column: 'a', type: 'url' }]]) {
    assert.throws(() => analyzeCSV('a\nvalue', { rules }), TypeError);
  }
  assert.throws(() => analyzeCSV('a', { hasHeader: 'yes' }), TypeError);
  assert.throws(() => serializeCSV([[42]]), TypeError);
  assert.throws(() => serializeCSV([[]]), TypeError);
  assert.throws(() => serializeCSV([['a']], { delimiter: 'auto' }), TypeError);
});
