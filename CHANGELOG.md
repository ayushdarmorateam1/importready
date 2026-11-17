# Changelog

## 0.1.0 — 2026-11-17

Initial public release of ImportReady.

- Inspect CSV files in a local browser interface, Node.js command-line tool, or reusable JavaScript module.
- Find malformed quoting, inconsistent columns, ambiguous headers, blank records, exact duplicates, and formula-like cells.
- Apply explicit required, unique, email, number, and ISO date rules.
- Preview optional whitespace trimming, blank-row removal, deduplication, and spreadsheet formula guarding.
- Preserve leading-zero identifiers and unchanged cell values; keep original files untouched.
- Export a new CSV and a diagnostic JSON report, with structural errors blocking unsafe output.
- Include synthetic examples, regression tests, contribution guidelines, and scoped support information.

### Scope

The browser app and CLI accept UTF-8 input up to 5 MiB and 50,000 data records. Separator detection is a heuristic with a manual override. This release does not read Excel workbooks or infer business rules. Data processing uses no network requests, API keys, or runtime dependencies.
