# Contributing to ImportReady

Help make CSV imports easier to understand and harder to damage. Small, well-explained changes are welcome.

## Start locally

Use Node.js 20 or later. There are no runtime dependencies to install.

```sh
npm test
npm start
```

Use the local address printed by the server. The `examples/` directory contains synthetic input and a rules file. See [README.md](README.md) for CLI and library examples.

## Report a problem

Open a bug report with the smallest **synthetic** CSV that reproduces it, the delimiter and header settings, the rules used, and expected versus actual behavior. Explain whether the problem occurs in the browser, CLI, or core. Include your browser or Node version.

Public issues are public. Replace names, email addresses, financial details, access tokens, and other sensitive values before sharing a sample or report. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

## Propose a change

1. For a substantial behavior or API change, open a short issue first so scope can be discussed.
2. Create a branch and keep the change focused on one problem.
3. Add a meaningful regression test for parser, validation, cleanup, or CLI behavior. Documentation-only changes do not need artificial tests.
4. Run `npm test`; exercise the affected browser workflow when changing the UI.
5. Describe the problem, the resulting behavior, and verification in your pull request.

## Design commitments

- Preserve strings and identifiers. Do not infer types or silently discard data.
- Make repairs explicit and inspectable. Ambiguous structure should produce a useful error.
- Keep file processing local and the runtime free of dependencies, telemetry, and paid APIs. Discuss exceptions before implementation.
- Share parsing and validation behavior between browser and CLI through `src/core.mjs`.
- Render file-derived content as text. Keep diagnostics useful without copying entire datasets into reports.
- Keep keyboard operation and clear labels intact when changing the interface.

AI-assisted contributions are welcome when the contributor understands the change, verifies its behavior, and has the right to submit the code. Disclose relevant assistance in the pull request. Generated volume is not a substitute for a small, reviewable solution.

By submitting a contribution, you agree that it may be distributed under this project's [MIT license](LICENSE). Be respectful and constructive when discussing problems and proposed solutions.
