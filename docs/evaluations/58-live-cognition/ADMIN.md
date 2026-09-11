# Issue #58 evaluation administration

Status: **awaiting three independent human evaluations**. This repository currently has a solo developer, so the developer cannot satisfy the evaluator-count gate by rating their own work.

The default numeric gates in `manifest.json` are proposed, not accepted. Before collecting responses, record the product-owner acceptance decision in a linked comment. Do not mark `acceptedByProductOwner` true without that explicit decision.

- Keep `assignments.private.json` and `study-assets.private.json` uncommitted and give them only to the study administrator.
- Give each evaluator only their form and replay links/files.
- Do not reveal A/B identities until ratings and free-text descriptions are captured.
- After collection, code each free-text principal reaction as true/false in `results.json`; do not attach evaluator names or contact details.
- Verify with `evaluateHumanResults()` using the public plan, private assignments, and responses.
- A pass still requires the product decision to enable default-on; a safety report blocks activation and must be recorded with its scenario.
