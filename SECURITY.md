# Security

## Reporting a vulnerability

Reports are welcome for the current default branch. If this repository offers **Security → Advisories → Report a vulnerability**, use that private reporting route. Otherwise, open an issue that only says you need a private security contact; wait for a private route before sharing exploitation steps or sensitive details.

Include affected behavior, a minimal synthetic reproduction, impact, and any proposed fix through the private channel. Community response is best effort; no response-time commitment is offered.

## Data boundaries

The browser processes selected files locally. The CLI reads local files. ImportReady has no CSV-upload endpoint, analytics, remote validation service, or paid API dependency. The host serving the web app may log normal page and asset requests.

Downloaded reports can include filenames, column names, rule names, and diagnostic locations. Review them before sharing. Public issues and pull requests must use synthetic examples.

CSV text is untrusted input. UI contributions must render file-derived content as text, and CLI output must preserve control-character escaping. Do not introduce HTML interpretation of cell content.

## Export behavior

Formula-like values receive warnings. Optional formula protection prefixes an apostrophe and changes the exported value; behavior can vary between spreadsheet applications. This is a conservative mitigation, not a guarantee that an arbitrary spreadsheet workflow is safe.

Malformed quotes, ambiguous headers, inconsistent nonblank rows, and row-limit failures block cleaned export. Reports remain available for diagnosis. The CLI refuses to overwrite existing output paths or the input file.

Limits of 5 MiB and 50,000 data records bound browser and CLI processing. The core library expects its caller to bound input bytes. Do not remove these controls without evaluating the resulting memory and responsiveness behavior.
