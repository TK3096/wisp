# Phase 1 Cognition Acceptance Evidence

Status: **pass** — [`phase1-cognition.json`](./phase1-cognition.json)

The committed JSON is the raw evidence pack for the run at
`2026-09-01T14:38:07.131Z`. It records host/runtime and Git identity, contract
versions, all threshold comparisons, raw p50/p95/max values, stress trace size,
and dropped-event count. The report schema is version 1.

## Reproduce

```bash
PHASE1_ACCEPTANCE_OUTPUT="$(pwd)/docs/acceptance/phase1-cognition.json" \
  npm run test:acceptance
```

The command regenerates the optimized WASM facade and runs
`integration/phase1Acceptance.integration.test.ts`. The live WASM handles are
used for every replay and persistence check. Omitting the environment variable
runs the same assertions without rewriting evidence.

## Replay coverage

- Eight canonical scenario families pass at 30, 60, and 120 Hz: Neutral
  Baseline, Novel Strong Gesture, Habituation, Caution/Startle Arc, Quiet
  Boredom, Personality Contrast, Reaction Storm, and Cadence/Frame Independence.
- The cadence scenario is an eight-character, 120-second virtual replay with
  9,520 simulated public stimulus deliveries and 20,883 trace records.
- Its worst supported render schedule is 30 Hz; Cognition stays fixed at 10 Hz.
- A second run at the same seed/scenario/schedule is byte-identical. Cross-
  schedule acceptance compares each character's actual Cognition steps; the
  stress scheduler sequence remains equivalent and every jump remains
  scheduler-owned, rather than requiring frame-local event positions to match.
- Restart persistence, despawn deletion, corruption quarantine, future-version
  quarantine, and no-offline-replay checks all pass.
- Nine of nine scenario/replay determinism cases pass; no trace event is dropped.

## Measured result

| Budget | p95 measured | Gate |
| --- | ---: | ---: |
| Per-character Cognition tick | 0.002333 ms | <= 0.1 ms |
| Eight-character Cognition batch | 0.018210 ms | <= 0.8 ms |
| Virtual render tick | 0.134042 ms | <= 33.333 ms |
| Trace write | 0.000208 ms | <= 0.5 ms |
| Stimulus to Behavior Bias | 0.104458 ms | <= 1 ms |
| Incremental heap | 105,967,928 bytes | <= 268,435,456 bytes |
| WASM initialization | 3.885875 ms | <= 500 ms |
| Frame time | 0.134042 ms | <= 33.333 ms |
| CPU per simulated second | 2.393625 ms/s | <= 40 ms/s |

The stress is a virtual-time deterministic replay: frame time and CPU measure
wall-clock compute cost of advancing the simulated 30 Hz schedule, not Pixi GPU
presentation or macOS window composition. Values at or below 110% of a gate are
recorded `marginal`; any marginal, failed, or absent budget becomes an explicit
blocker in `blockers[]` and forces the overall status to `blocked`. This run has
no blockers.
