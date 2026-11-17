import { analyzeCSV, cleanupCSV, isFormulaRisk } from '../src/core.mjs';

const MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS = 100, PREVIEW_COLUMNS = 12, PREVIEW_ISSUES = 100;
const DEMO = `id,name,email,joined,amount,notes
001, Mira Patel ,mira@example.com,2026-10-02,120.00, First import 
002,Alex Morgan,alex@example.com,2026-10-05,75.50,Returning customer
003,Sam Rivera,sam-at-example.com,2026-02-30,95.00,Check contact details
002,Alex Morgan,alex@example.com,2026-10-05,75.50,Returning customer
004,Noor Khan,noor@example.com,2026-10-09,0042,=2+3

005,Jamie Chen,,2026-10-12,80.00,Email needed
006,Taylor Reed,taylor@example.com,2026-10-14,90.00,"New line
in note"
`;
const DEMO_RULES = [
  { column: 'id', required: true, unique: true, type: 'text' },
  { column: 'email', required: true, type: 'email' },
  { column: 'joined', type: 'date' },
  { column: 'amount', type: 'number' },
];
const $ = id => document.getElementById(id);
const state = { text: '', name: '', size: 0, kind: 'example', rules: [], afterRules: [], analysis: null, cleaned: null, after: null, view: 'original', pending: false };
let analysisRevision = 0, loadRevision = 0;
const urls = new Set();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function number(value) { return value.toLocaleString('en-US'); }
function bytes(value) { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`; }
function label(value, limit = 120) {
  const text = String(value), preview = text.slice(0, limit).replace(/\r\n|\r|\n/g, ' ↵ ').replace(/\t/g, ' ↹ ').replace(/\0/g, ' ␀ ');
  return preview.slice(0, limit) + (text.length > limit || preview.length > limit ? '…' : '');
}
function separator() { return $('delimiter').value === 'tab' ? '\t' : $('delimiter').value; }
function separatorName(value) { return ({ ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' })[value] || 'Unknown'; }
function options() { return { delimiter: separator(), hasHeader: $('has-header').checked, rules: state.rules }; }
function changes() { return { trim: $('fix-trim').checked, removeBlankRows: $('fix-blank').checked, removeDuplicateRows: $('fix-duplicate').checked, protectFormulas: $('fix-formula').checked }; }
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}

function readBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('This file could not be read. Try choosing it again.'));
    reader.onabort = () => reject(new Error('Reading the file was canceled.'));
    reader.readAsArrayBuffer(file);
  });
}

async function loadFile(file) {
  if (!file) return;
  const revision = ++loadRevision;
  if (file.size > MAX_BYTES) { notice('This file is larger than 5 MiB. Split it into smaller CSV files before checking. The current dataset is still shown.', true); return; }
  if (!/\.(csv|tsv|txt)$/i.test(file.name)) { notice('Choose a CSV, TSV, or TXT file. Excel workbooks need to be exported as UTF-8 CSV first. The current dataset is still shown.', true); return; }
  try {
    const buffer = await readBytes(file);
    if (revision !== loadRevision) return;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new Error('This file is not valid UTF-8. Export it as UTF-8 CSV and try again.'); }
    await loadSource(text, file.name, 'file', []);
  } catch (error) { if (revision === loadRevision) notice(`${error.message} The current dataset is still shown.`, true); }
  finally { $('csv-file').value = ''; }
}

async function loadSource(text, name, kind, rules = []) {
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_BYTES) { notice('This input exceeds 5 MiB. Split it into smaller CSV files before checking.', true); return; }
  state.text = text; state.name = name; state.kind = kind; state.size = size;
  state.rules = rules.map(rule => ({ ...rule }));
  for (const id of ['fix-trim', 'fix-blank', 'fix-duplicate', 'fix-formula']) $(id).checked = false;
  state.view = 'original'; $('issue-scope').value = 'original';
  notice('');
  await runAnalysis();
}

async function loadDemo() {
  ++loadRevision;
  $('delimiter').value = 'auto'; $('has-header').checked = true;
  await loadSource(DEMO, 'example-contacts.csv', 'example', DEMO_RULES);
}

async function runAnalysis() {
  const revision = ++analysisRevision;
  // Invalidate every exportable result before yielding; never attach an old
  // analysis to a new filename, parsing setting, or validation rule set.
  state.pending = true;
  state.analysis = null; state.cleaned = null; state.after = null; state.afterRules = [];
  $('results').setAttribute('aria-busy', 'true');
  $('download-csv').disabled = true; $('download-report').disabled = true;
  // Give the busy state a frame to paint before bounded local processing begins.
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  if (revision !== analysisRevision) return;
  try {
    state.analysis = analyzeCSV(state.text, options());
    state.pending = false;
    calculateCleanup();
  } catch (error) {
    state.pending = false;
    state.analysis = null; state.cleaned = null; state.after = null; state.afterRules = [];
    notice(`The data could not be checked: ${error.message}`, true);
  }
  renderAll();
  $('results').setAttribute('aria-busy', 'false');
}

function calculateCleanup() {
  state.cleaned = null; state.after = null; state.afterRules = [];
  if (state.pending || !state.analysis || state.analysis.exportBlocked) return;
  try {
    state.cleaned = cleanupCSV(state.analysis, changes());
    // Cleanup can rename a header. Keep each rule attached to its original
    // column; an already-missing column remains missing instead of being guessed.
    state.afterRules = state.rules.map(rule => {
      const index = state.analysis.headers.indexOf(rule.column);
      return { ...rule, column: index >= 0 ? state.cleaned.headers[index] : rule.column };
    });
    state.after = analyzeCSV(state.cleaned.csv, { ...options(), delimiter: state.analysis.delimiter, rules: state.afterRules });
  } catch (error) {
    if (error.code !== 'UNSAFE_CLEANUP') notice(`The selected changes could not be previewed: ${error.message}`, true);
  }
}

function renderOverview() {
  const analysis = state.analysis;
  $('file-name').textContent = label(state.name || 'No file selected', 120);
  $('file-details').textContent = `${state.kind === 'example' ? 'Synthetic sample · ' : ''}${bytes(state.size)}`;
  $('dataset-badge').textContent = state.kind === 'example' ? 'Example dataset' : state.kind === 'paste' ? 'Pasted data' : 'Your local file';
  $('dataset-badge').classList.toggle('user-data', state.kind !== 'example');
  for (const key of ['rows', 'columns', 'errors', 'warnings']) $(`stat-${key}`).textContent = analysis ? number(analysis.stats[key]) : '—';
  $('detected-delimiter').textContent = analysis ? `${separatorName(analysis.delimiter).toLowerCase()} separated` : 'separator not checked';
  $('issues-count').textContent = analysis ? number(analysis.stats.errors + analysis.stats.warnings) : '0';
  $('download-report').disabled = state.pending || !analysis;
}

function renderRules() {
  const select = $('rule-column'), selected = select.value;
  select.replaceChildren();
  const headers = state.analysis?.headers || [];
  headers.slice(0, 500).forEach((header, index) => {
    const option = element('option', '', label(header || `(unnamed column ${index + 1})`, 120));
    option.value = String(index); select.append(option);
  });
  if (!headers.length) { const option = element('option', '', 'Load a dataset first'); option.value = ''; select.append(option); }
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
  select.disabled = !headers.length; $('save-rule').disabled = !headers.length;
  $('rule-count').textContent = String(state.rules.length);
  $('clear-rules').disabled = !state.rules.length;
  $('rule-limit-note').hidden = headers.length <= 500;
  $('rule-limit-note').textContent = 'The rule editor shows the first 500 columns. All columns are still analyzed.';
  $('active-rules').replaceChildren();
  state.rules.forEach((rule, index) => {
    const item = element('div', 'rule-item'), text = element('div', 'rule-text');
    text.append(element('strong', '', label(rule.column, 65)));
    const descriptions = [];
    if (rule.required) descriptions.push('required');
    if (rule.unique) descriptions.push('unique');
    if (rule.type && rule.type !== 'text') descriptions.push(rule.type);
    text.append(element('span', '', descriptions.join(' · ') || 'text'));
    const remove = element('button', 'remove-rule', '×');
    remove.type = 'button'; remove.dataset.removeRule = String(index);
    remove.setAttribute('aria-label', `Remove rule for ${label(rule.column, 80)}`);
    item.append(text, remove); $('active-rules').append(item);
  });
  syncRuleForm();
}

function syncRuleForm() {
  const header = state.analysis?.headers[Number($('rule-column').value)];
  const rule = state.rules.find(item => item.column === header);
  $('rule-type').value = rule?.type || 'text';
  $('rule-required').checked = !!rule?.required;
  $('rule-unique').checked = !!rule?.unique;
}

function emptyState(title, message, success = false) {
  const container = element('div', 'empty-state');
  if (success) container.append(element('span', 'empty-icon', '✓'));
  container.append(element('strong', '', title), element('p', '', message));
  return container;
}

function renderTable(analysis) {
  if (!analysis) return emptyState('Preview unavailable', 'Resolve the structural issues in the original file to preview selected changes.');
  if (!analysis.headers.length && !analysis.rows.length) return emptyState('No CSV records found', 'Choose a file with CSV records or paste data to begin.');
  const table = element('table', 'data-table');
  table.setAttribute('aria-label', state.view === 'cleaned' ? 'CSV after selected changes' : 'Original CSV');
  const head = element('thead'), heading = element('tr');
  const lineHead = element('th', 'line-column', 'LINE'); lineHead.scope = 'col'; heading.append(lineHead);
  const rows = analysis.rows.slice(0, PREVIEW_ROWS);
  const columns = Math.min(PREVIEW_COLUMNS, Math.max(analysis.headers.length, ...rows.map(row => row.length), 0));
  for (let column = 0; column < columns; column++) {
    const th = element('th', '', label(analysis.headers[column] || `Column ${column + 1}`, 80));
    th.scope = 'col'; th.title = label(analysis.headers[column] || 'Unnamed or extra column', 500); heading.append(th);
  }
  head.append(heading); table.append(head);
  const body = element('tbody');
  rows.forEach((row, index) => {
    const tr = element('tr');
    tr.append(element('td', 'line-column', String(analysis.rowLines[index])));
    for (let column = 0; column < columns; column++) {
      const value = row[column];
      const td = element('td');
      if (value === undefined) { td.textContent = '—'; td.className = 'missing-cell'; td.title = 'Missing field in this record'; }
      else if (!value) { td.textContent = 'empty'; td.className = 'empty-cell'; }
      else { td.textContent = label(value, 140); td.title = label(value, 1000); if (isFormulaRisk(value)) td.className = 'risk-cell'; }
      tr.append(td);
    }
    body.append(tr);
  });
  table.append(body);
  if (!rows.length) {
    const tr = element('tr'), td = element('td', '', 'This file contains a header but no data rows.');
    td.colSpan = columns + 1; tr.append(td); body.append(tr);
  }
  return table;
}

function renderIssues(analysis) {
  if (!analysis) return emptyState('No cleaned-file diagnostics yet', 'Resolve the original file’s structural issues before checking the selected changes.');
  if (!analysis.issues.length) return emptyState('No issues found in these checks.', 'This file passed the active rules. Your destination may have additional requirements.', true);
  const table = element('table', 'data-table issue-table'), head = element('thead'), heading = element('tr');
  table.setAttribute('aria-label', 'CSV diagnostics');
  for (const title of ['Severity', 'Line', 'Column', 'What to check']) { const th = element('th', '', title); th.scope = 'col'; heading.append(th); }
  head.append(heading); table.append(head);
  const body = element('tbody');
  for (const issue of analysis.issues.slice(0, PREVIEW_ISSUES)) {
    const tr = element('tr'), severityCell = element('td');
    severityCell.append(element('span', `severity ${issue.severity}`, issue.severity === 'error' ? 'Error' : 'Warning'));
    tr.append(severityCell, element('td', 'line-column', issue.row === undefined ? '—' : String(issue.row)), element('td', '', issue.columnName ? label(issue.columnName, 60) : issue.column ? String(issue.column) : '—'));
    const message = element('td', 'issue-message');
    message.append(element('span', '', label(issue.message, 500)), element('span', 'issue-code', issue.code));
    tr.append(message); body.append(tr);
  }
  table.append(body); return table;
}

function renderPreview() {
  const tabs = document.querySelectorAll('[data-view]');
  tabs.forEach(tab => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  });
  $('data-panel').setAttribute('aria-labelledby', `tab-${state.view}`);
  $('issue-view-controls').hidden = state.view !== 'issues';
  $('issue-scope').options[1].disabled = !state.after;
  const container = $('preview-container'); container.replaceChildren();
  if (!state.analysis) { container.append(emptyState('Choose a dataset to begin.', 'Load a CSV file, paste text, or try the clearly labeled example.')); return; }
  if (state.view === 'issues') {
    const analysis = $('issue-scope').value === 'cleaned' ? state.after : state.analysis;
    container.append(renderIssues(analysis));
    if (analysis) {
      const total = analysis.stats.errors + analysis.stats.warnings;
      $('preview-caption').textContent = `Showing ${number(Math.min(analysis.issues.length, PREVIEW_ISSUES))} of ${number(total)} issues. JSON includes up to 1,000 per view. Line = record’s starting line.`;
    } else $('preview-caption').textContent = 'Cleaned-file diagnostics are available after structural problems are resolved.';
  } else {
    const analysis = state.view === 'cleaned' ? state.after : state.analysis;
    container.append(renderTable(analysis));
    $('preview-caption').textContent = analysis ? `Showing ${number(Math.min(analysis.rows.length, PREVIEW_ROWS))} of ${number(analysis.rows.length)} rows · up to ${PREVIEW_COLUMNS} columns. Line = record’s starting line; long values abbreviated.` : 'No values are discarded or repaired to bypass structural errors.';
  }
}

function renderCleanup() {
  const summary = $('change-summary'), selected = changes(); summary.replaceChildren();
  const counts = state.cleaned?.changes;
  const labels = [
    ['trim', 'trimmedCells', 'Cells trimmed'],
    ['removeBlankRows', 'removedBlankRows', 'Blank rows removed'],
    ['removeDuplicateRows', 'removedDuplicateRows', 'Duplicates removed'],
    ['protectFormulas', 'protectedCells', 'Cells guarded'],
  ];
  if (!Object.values(selected).some(Boolean)) summary.append(element('p', '', 'No cell or row changes selected.'));
  else for (const [option, count, title] of labels) if (selected[option]) {
    const row = element('div', 'change-row'); row.append(element('span', '', title), element('strong', '', counts ? number(counts[count]) : '—')); summary.append(row);
  }
  const after = state.after;
  $('after-status').textContent = after ? `After selected changes: ${number(after.stats.rows)} rows · ${number(after.stats.errors)} errors · ${number(after.stats.warnings)} warnings.${after.stats.errors ? ' Review remaining errors before importing.' : ''}` : state.analysis?.exportBlocked ? 'Resolve structural errors to enable export.' : 'Load a dataset to see the result.';
  $('after-status').classList.toggle('has-errors', !!after?.stats.errors || !!state.analysis?.exportBlocked);
  const blocked = !!state.analysis?.exportBlocked || !!after?.exportBlocked;
  $('download-csv').disabled = state.pending || !state.cleaned || blocked;
  $('export-blocked').hidden = !blocked;
  $('export-blocked').textContent = state.analysis?.exportBlocked ? 'Export is paused: fix malformed quotes, inconsistent columns, missing or duplicate headers, or row-limit errors in the original file. Open Issues for the exact locations.' : after?.exportBlocked ? 'The selected changes leave an empty or structurally invalid CSV. Adjust your options and review the result before exporting.' : '';
}

function renderAll() { renderOverview(); renderRules(); renderPreview(); renderCleanup(); }
function setView(view) { state.view = view; renderPreview(); }

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); urls.add(url);
  const anchor = element('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 5000);
}
function baseName() { return (state.name.replace(/\.(csv|tsv|txt)$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'importready'); }
function reportView(analysis) {
  if (!analysis) return null;
  return {
    stats: { ...analysis.stats }, valid: analysis.valid, exportBlocked: analysis.exportBlocked,
    delimiter: analysis.delimiter, hasHeader: analysis.hasHeader, issuesTruncated: analysis.issuesTruncated,
    issues: analysis.issues.map(issue => ({
      code: issue.code, severity: issue.severity, message: label(issue.message, 500),
      ...(issue.row === undefined ? {} : { row: issue.row }), ...(issue.column === undefined ? {} : { column: issue.column }),
      ...(issue.columnName === undefined ? {} : { columnName: label(issue.columnName, 120) }),
    })),
  };
}

$('browse-file').addEventListener('click', () => $('csv-file').click());
$('csv-file').addEventListener('change', event => loadFile(event.target.files[0]));
$('load-demo').addEventListener('click', loadDemo);
const dropZone = $('drop-zone');
for (const name of ['dragenter', 'dragover']) dropZone.addEventListener(name, event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', event => {
  event.preventDefault(); dropZone.classList.remove('dragging');
  const files = event.dataTransfer?.files;
  if (files?.length !== 1) { notice('Choose one CSV file at a time.', true); return; }
  loadFile(files[0]);
});
$('paste-form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('csv-text').value;
  if (!text.trim()) { notice('Paste some CSV text before checking it.', true); $('csv-text').focus(); return; }
  ++loadRevision;
  await loadSource(text, 'pasted-data.csv', 'paste', state.kind === 'paste' ? state.rules : []);
});
$('delimiter').addEventListener('change', runAnalysis);
$('has-header').addEventListener('change', () => {
  const hadRules = !!state.rules.length; state.rules = [];
  if (hadRules) notice('Rules were cleared because changing header mode changes the column names. Add rules for the new view.');
  runAnalysis();
});
$('rule-column').addEventListener('change', syncRuleForm);
$('rule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const column = state.analysis?.headers[Number($('rule-column').value)];
  if (column === undefined || !column.trim()) { notice('Give this column a nonempty name in your original CSV before adding a rule.', true); return; }
  const rule = { column, type: $('rule-type').value, required: $('rule-required').checked, unique: $('rule-unique').checked };
  if (rule.type === 'text' && !rule.required && !rule.unique) { notice('Choose Required, Unique, or a specific value type to add a meaningful check.'); return; }
  const index = state.rules.findIndex(item => item.column === column);
  if (index < 0) state.rules.push(rule); else state.rules[index] = rule;
  notice(''); await runAnalysis();
});
$('active-rules').addEventListener('click', async event => {
  const button = event.target.closest('[data-remove-rule]');
  if (!button) return;
  state.rules.splice(Number(button.dataset.removeRule), 1); await runAnalysis();
});
$('clear-rules').addEventListener('click', async () => { state.rules = []; await runAnalysis(); });
document.querySelectorAll('[data-view]').forEach(tab => {
  tab.addEventListener('click', () => setView(tab.dataset.view));
  tab.addEventListener('keydown', event => {
    const views = ['original', 'cleaned', 'issues']; let index = views.indexOf(state.view);
    if (event.key === 'ArrowRight') index = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') index = (index + views.length - 1) % views.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = views.length - 1;
    else return;
    event.preventDefault(); setView(views[index]); $(`tab-${views[index]}`).focus();
  });
});
$('issue-scope').addEventListener('change', renderPreview);
for (const id of ['fix-trim', 'fix-blank', 'fix-duplicate', 'fix-formula']) $(id).addEventListener('change', () => { calculateCleanup(); renderCleanup(); renderPreview(); });
$('download-csv').addEventListener('click', () => {
  if (state.pending || !state.cleaned || state.analysis?.exportBlocked || state.after?.exportBlocked) return;
  download(state.cleaned.csv, `${baseName()}.cleaned.csv`, 'text/csv;charset=utf-8');
});
$('download-report').addEventListener('click', () => {
  if (state.pending || !state.analysis) return;
  const report = {
    tool: 'ImportReady', version: '0.1.0', generatedAt: new Date().toISOString(),
    source: { name: label(state.name, 120), bytes: state.size, example: state.kind === 'example' },
    notes: ['Raw row values are excluded.', 'Diagnostic line numbers identify the physical starting line of each record in its selected CSV view.', 'Up to 1,000 diagnostics are included per view; total counts include omitted diagnostics.', 'Long diagnostic header labels and messages are abbreviated; validation rules retain exact column names.', 'When cleanup changes a header, its rule follows the original column position. Already-missing rule columns remain missing.'],
    validationRules: state.rules.map(rule => ({ ...rule })),
    afterValidationRules: state.after ? state.afterRules.map(rule => ({ ...rule })) : null,
    original: reportView(state.analysis), selectedChanges: changes(), changes: state.cleaned?.changes || null,
    afterSelectedChanges: reportView(state.after),
  };
  download(JSON.stringify(report, null, 2) + '\n', `${baseName()}.report.json`, 'application/json;charset=utf-8');
});
window.addEventListener('beforeunload', () => { for (const url of urls) URL.revokeObjectURL(url); });
loadDemo();
