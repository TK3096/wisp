# Live-cognition human A/B kit

This kit prepares, but does not claim, the human evaluation required by issue #58. It contains four 70-second deterministic scenario traces rendered at 30 Hz with baseline-neutral behavior and optimized WASM cognition. Each scenario passed an automated visible-behavior precheck: it differs in at least one scheduler-owned bubble or jump event between arms. Each evaluator receives two differently labeled replays per scenario, with both scenario order and first-replay arm randomized. The committed manifest binds the hidden assignment mapping only by SHA-256.

The experimental live app now uses `COGNITION_LIVE_DEFAULT_ENABLED = true` under an explicit product-owner waiver. This is not an acceptance pass: only one of three evaluators has participated, baseline was preferred overall, and cognition medians were below the proposed gates. See [`WAIVER.md`](./WAIVER.md) and [`results/pilot-evaluator-1.json`](./results/pilot-evaluator-1.json). The included replay viewer is a behavior-event preview for reviewer convenience, not the production Pixi renderer.

Forms are under `forms/`; replay checksums are in `manifest.json`. The study remains blocked because three external human evaluators have not participated and the product owner has not yet accepted the numeric gates.
