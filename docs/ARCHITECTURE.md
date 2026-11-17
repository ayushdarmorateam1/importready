# Architecture

ImportReady is a static browser tool and a Node.js CLI built around the same dependency-free JavaScript core. It has no processing server, authentication service, telemetry, external API, or database.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| `src/core.mjs` | Parse strings, detect structure problems, apply column rules, perform requested cleanup, serialize CSV |
| Browser UI | Read a selected local file, enforce size limits, collect settings, present diagnostics and previews, create downloads |
| `bin/importready.mjs` | Read bounded UTF-8 input, validate rule files, call the core, report results, create new output files, set exit status |
| `scripts/serve.mjs` | Serve the static app locally for development |
| `test/` and `examples/` | Reproducible behavior checks and synthetic usage examples |

## Processing sequence

1. **Bound and decode input.** The browser and CLI enforce 5 MiB and UTF-8 input. Core callers must supply equivalent boundary checks themselves.
2. **Parse.** An explicit separator or a heuristic across comma, semicolon, tab, and pipe produces string records and their physical starting lines.
3. **Analyze.** The first record is a header by default. With headers disabled, generated column names are `Column 1`, `Column 2`, and so on. Structure checks and explicit rules produce diagnostics.
4. **Review.** Original values stay unchanged. The UI or caller chooses which repairs to request.
5. **Clean and serialize.** Structural ambiguity blocks this stage. Selected operations run in order: trim, remove blank rows, remove exact duplicate rows, protect formula-like values. Serialization uses CRLF record endings and CSV quoting.
6. **Validate the result.** Cleanup can leave semantic errors. The browser and CLI reanalyze exported text with the intended rules. If cleanup changes a header, they derive output-side rule names from each rule's original column index. The CLI uses the output result for its exit code.

## Core API

`analyzeCSV(text, options)` returns the full in-memory analysis, including records. `cleanupCSV(analysis, options)` creates new arrays and CSV text; it does not mutate the source analysis. `parseCSV`, `serializeCSV`, and `isFormulaRisk` are available for lower-level use.

`valid` means no validation errors were found. `exportBlocked` separately records whether cleaned export would be unsafe because of structure or truncation. Semantic rule failures do not necessarily block cleanup: removing an empty record, for example, can resolve a required-value error. Callers must still inspect the final validation result.

Rules use exact header names. `required` treats whitespace-only values as empty; `unique` compares exact nonblank values; type checks inspect trimmed values without converting stored strings. Email checks cover basic syntax. Number checks require finite decimal/exponent notation. Date checks require an actual ISO calendar date.

Trimming and formula protection can change header text. Browser and CLI post-cleanup validation therefore uses copies of the rules, mapped from each original header's column index to the corresponding cleaned header. They preserve the original rules for source analysis; a rule without an original column match retains its name for normal validation against the output. The lower-level core does not perform this rule mapping for callers. Integrations that revalidate cleaned output must map rules themselves, as shown in the README example. A separately saved rules file must use the current headers of the file it will validate.

## Limits and diagnostics

The default limit is 50,000 data records. A header does not consume that allowance. Exceeding the limit is an error and prevents exporting a truncated result.

Diagnostic rows are physical starting lines, not zero-based array indexes or logical record numbers. This matters when a quoted field spans several lines. Columns are one-based.

At most 1,000 individual issues are returned. Aggregate counts continue to represent the inspected input, and blocking state survives the cap. Do not infer overall safety from the visible issue list alone.

## Privacy and integrity

Raw records belong in memory and the user-requested CSV export. Reports contain selected metadata and diagnostics rather than the full analysis object; integrations should not serialize the entire analysis as a supposedly data-free report. Filenames and column names can still be sensitive.

Render every file-derived value as text. File content must not become executable markup. Formula warnings and optional apostrophe prefixing address a separate risk at the destination spreadsheet; they do not promise universal spreadsheet compatibility.

The CLI creates output files exclusively, refuses input/output collisions, and rolls back only outputs it created if a requested write fails. It never overwrites the original CSV.

## Deliberate scope

The current design favors small, reviewable files and explicit rules. It does not include streaming huge files, XLSX parsing, automatic encoding repair, inferred business schemas, remote synchronization, or guaranteed importer-specific validation. Extending those boundaries should begin with a concrete use case and performance/correctness evidence.
