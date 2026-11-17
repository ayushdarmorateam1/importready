# ImportReady: first revenue experiments

This is a small launch plan with hypotheses to test. It records no existing customers, sponsors, revenue, or verified demand. Revenue and its timing remain uncertain.

## Offer worth testing

Keep the public checker and core useful on their own. Offer a narrowly scoped service around an actual import problem: custom rules, a repeatable mapping, or integration of the CLI/core into an existing workflow.

**Illustrative pilot range: ₹2,500–₹7,500**, contingent on scope, effort, and customer fit. This is a hypothesis for an individual pilot quote, not a market-rate claim or standing public price. Confirm the work and quote before starting. A larger or ambiguous request needs a fresh estimate.

Each pilot should identify one input format, one destination or output specification, a synthetic acceptance example, the agreed deliverable, and clear exclusions. Avoid promising an entire migration or indefinite support for a small fixed fee.

## First three conversations

The project owner should identify **three existing contacts** who actually deal with CSV imports, such as an operations colleague, an agency contact, or a developer maintaining an importer. These are candidate roles, not known prospects or claimed relationships.

The owner sends any invitation personally and only where an existing relationship makes it appropriate. No automatic outreach or unsolicited mass messaging is part of this plan. If no suitable contacts exist, use an appropriate public feedback channel under its rules.

Ask each person:

1. When did a CSV import last fail, and what went wrong?
2. How was it fixed, and how much time did that take?
3. Does ImportReady identify a problem their current workflow misses?
4. Would a specific repeatable fix or integration be worth paying for?

Use a synthetic or properly anonymized sample. Collect the problem, current workaround, desired outcome, and decision criteria. A compliment or a free trial is not evidence that someone will buy.

## Keep the experiment small

| Stage | Time budget | Evidence to seek |
| --- | --- | --- |
| Publish and verify | One focused release session | Runnable project, clear docs, passing checks, honest limitations |
| Discovery | Up to two hours across three days | Three useful conversations and at least one repeated problem |
| Pilot scoping | Up to one hour | A specific deliverable and a quote accepted before work |
| Review | Thirty minutes after the first pilot or discovery round | Outcome, actual effort, margin, and a concrete next decision |

Set a delivery budget before accepting a pilot. If no one has a problem worth solving, refine the target use case before adding features. If a request exposes a general bug, fix it in the public project when appropriate.

## Sponsorship in parallel

Prepare the [Sponsors profile](SPONSOR_PROFILE.md) and explain what maintenance support funds. Ask for optional support in the project documentation once receiving sponsorships is enabled. Do not use sponsor benefits to imply a service contract or guaranteed turnaround.

Measure actual signals: reproducible issues, repeat use described by users, accepted service quotes, completed paid work, and real sponsorships. Do not report invented traction or treat stars as revenue.

## Why this problem is plausible

[CSVLint](https://csvlint.io/about) documents structure and schema checks, and [Flatfile's troubleshooting guide](https://support.flatfile.com/articles/1688774284-csv-file-import-troubleshooting-missing-or-incorrect-records) describes import failures involving column counts, headers, and blank rows. These establish concrete failure modes; they do not establish demand for ImportReady or the proposed pilot price.

The product hypothesis is that local processing, understandable diagnostics, deliberate repairs, and a reusable CLI/core make a useful small workflow. Validate it with people and real problems.
