# ImportReady

**Catch CSV problems before they become failed imports.**

ImportReady checks CSV files on your machine, explains problems by line and column, and lets you preview deliberate repairs before exporting a new file. Use the browser app, the command line, or the reusable JavaScript core.

**No uploads · No API keys · No telemetry · No runtime dependencies**

[Quick start](#quick-start) · [Checks and repairs](#checks-and-repairs) · [CLI](#command-line) · [JavaScript API](#javascript-api) · [Support](SUPPORT.md)

## Quick start

Clone the project and use **Node.js 20 or later**. No dependency installation is needed.

```sh
git clone https://github.com/ayushdarmorateam1/importready.git
cd importready
npm start
```

Open the local address printed by the server. Choose a UTF-8 CSV, confirm the delimiter and header setting, and inspect the results. Select any repairs you want, review the preview, then download the cleaned CSV or JSON report.

To try the command line and run the tests:

```sh
node bin/importready.mjs examples/clean.csv
npm test
```

The repository also includes `examples/contacts-messy.csv` and `examples/contacts-rules.json` for exploring diagnostics. Their deliberately invalid values should produce validation errors.

## Checks and repairs

| Check | What you get |
| --- | --- |
| CSV structure | Malformed quotes, inconsistent column counts, missing or duplicate headers |
| Import hygiene | Blank rows, exact duplicate records, surrounding header whitespace |
| Column rules | Required values, uniqueness, email syntax, finite numbers, real ISO calendar dates |
| Spreadsheet formulas | Warnings for values a spreadsheet may interpret as formulas |
| Review and export | Located diagnostics, selected repairs, change counts, CSV and JSON downloads |

Repairs are optional. Select trimming, blank-row removal, exact deduplication, or formula protection only when appropriate for your destination. ImportReady does not guess missing values, rename ambiguous headers, or invent data.

Cells remain strings, so identifiers such as `000123` stay intact in the CSV. Your destination spreadsheet can still apply its own automatic formatting when you open a file.

## Command line

Check a file against column rules:

```sh
node bin/importready.mjs examples/contacts-messy.csv \
  --rules examples/contacts-rules.json --json
```

Write explicitly selected repairs and a report to **new** paths:

```sh
node bin/importready.mjs examples/contacts-messy.csv \
  --rules examples/contacts-rules.json \
  --trim --remove-empty --dedupe --protect-formulas \
  --out contacts-cleaned.csv --report contacts-report.json
```

Cleanup does not fix every rule violation. This example can still exit with validation errors; review the report before importing. Existing output files are never overwritten, and the input is never modified.

| Option | Purpose |
| --- | --- |
| `--delimiter auto\|comma\|semicolon\|tab\|pipe` | Detect a separator or select it explicitly |
| `--no-header` | Treat every record as data; rules use `Column 1`, `Column 2`, etc. |
| `--rules rules.json` | Apply a JSON array of column rules |
| `--json` | Print a machine-readable report |
| `--report report.json` | Save a report to a new file |
| `--out cleaned.csv` | Export to a new CSV file |
| `--trim` | Trim surrounding whitespace in headers and cells |
| `--remove-empty` | Remove records whose cells are all blank |
| `--dedupe` | Keep the first occurrence of each exact record after selected repairs |
| `--protect-formulas` | Prefix formula-like values with an apostrophe; this changes their values |

Cleanup flags require `--out`. Run `node bin/importready.mjs --help` for the complete interface.

**Exit codes:** `0` means no validation errors, `1` means validation errors, and `2` means an invocation, rule-file, or I/O problem. Warnings alone do not fail the command. With `--out`, the exit status reflects the revalidated output. Structurally ambiguous files block CSV export while diagnostic reports remain available.

### Column rules

Rules name columns exactly, including case and whitespace:

```json
[
  { "column": "customer_id", "required": true, "unique": true, "type": "text" },
  { "column": "email", "required": true, "type": "email" },
  { "column": "amount", "type": "number" },
  { "column": "joined", "type": "date" }
]
```

`type` accepts `text`, `email`, `number`, or `date`. Dates must be real calendar dates in `YYYY-MM-DD` form. Number checks accept finite decimal or exponent notation and do not convert stored values. Email validation checks basic syntax; it cannot confirm that an address exists.

Uniqueness compares exact nonblank values. Empty values are allowed unless `required` is set. When trimming or formula protection changes a header, the browser and CLI keep each rule attached to its original column for post-cleanup validation. The original rules remain unchanged. For a separate future run, a rules file must name the file's current headers.

## JavaScript API

Import the source directly from your checkout. Registry publication is not required.

```js
import { analyzeCSV, cleanupCSV } from './src/core.mjs';

const options = {
  delimiter: 'auto',
  hasHeader: true,
  rules: [{ column: ' customer_id ', required: true, unique: true }],
};

const analysis = analyzeCSV(' customer_id ,name\n0007, Ada \n', options);
console.log(analysis.stats, analysis.issues);

if (!analysis.exportBlocked) {
  const cleaned = cleanupCSV(analysis, { trim: true });
  const rulesForOutput = options.rules.map(rule => {
    const index = analysis.headers.indexOf(rule.column);
    return index < 0 ? { ...rule } : { ...rule, column: cleaned.headers[index] };
  });
  const checked = analyzeCSV(cleaned.csv, {
    ...options,
    delimiter: analysis.delimiter,
    rules: rulesForOutput,
  });
  console.log(cleaned.csv, cleaned.changes, checked.valid);
}
```

The example matches the source header exactly, then maps a copy of the rule to the same column after trimming. Core-library callers are responsible for this mapping when cleanup changes headers; the browser and CLI handle it automatically.

`analyzeCSV` returns `headers`, data `rows`, physical `rowLines`, the detected `delimiter`, `hasHeader`, `stats`, `issues`, `issuesTruncated`, `exportBlocked`, and `valid`. Diagnostic columns are one-based; diagnostic rows identify the physical starting line of a record, including quoted multiline records.

`cleanupCSV` returns new `headers`, `rows`, `changes`, and serialized `csv`. Its options are `trim`, `removeBlankRows`, `removeDuplicateRows`, and `protectFormulas`, all false by default. Unsafe structural input raises an error with code `UNSAFE_CLEANUP`. Lower-level `parseCSV`, `serializeCSV`, and `isFormulaRisk` are also exported.

## Limits and data handling

- The browser app and CLI accept **UTF-8 CSV up to 5 MiB and 50,000 data records**. The JavaScript core defaults to the same row limit; library callers must enforce their own byte limits before decoding input.
- Automatic delimiter detection is a heuristic. Select the separator explicitly when the preview does not match your file.
- The issue list is capped at 1,000 entries; aggregate counts still reflect the inspected records. Row-limit failures prevent cleaned export.
- Export preserves unchanged cell values, but normalizes record endings to CRLF and may change CSV quoting. It is not a byte-for-byte copy.
- Formula protection is a conservative mitigation that changes values. Review compatibility with the spreadsheet or importer you use.
- The app does not upload CSV content or run analytics. Hosting services still receive ordinary requests for the page and its assets. Reports can contain filenames, column names, and diagnostics; review them before sharing.
- Excel workbooks, automatic encoding conversion, inferred business rules, and guaranteed compatibility with a particular importer are outside this release's scope.

See [architecture](docs/ARCHITECTURE.md) and [security](SECURITY.md) for the boundaries in more detail.

## Contribute and support

Useful contributions include small reproducible CSV fixtures, clearer diagnostics, documentation, accessibility improvements, and focused correctness fixes. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

For an issue or a scoped custom-rule, mapping, or integration request, see [SUPPORT.md](SUPPORT.md). The software remains free under the [MIT license](LICENSE). Sponsorship, when available, supports maintenance, tests, and documentation.

ImportReady was developed with AI assistance. Contributions are judged by their behavior, readable implementation, reproducible examples, and meaningful tests.
