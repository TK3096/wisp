# Phase 2 Set Attention Acceptance Evidence

Status: **blocked — remains default-off**

The committed JSON is deterministic evidence for issue #60:
[`phase2-set-attention.json`](./phase2-set-attention.json).

## Reproduce

```bash
PHASE2_SET_ATTENTION_OUTPUT="$(pwd)/docs/acceptance/phase2-set-attention.json" \
  npm run test:set-attention
```

## Result

The eight-character, five-minute virtual soak completed with finite bounded
values and a byte-identical repeat trace. Membership changed from eight to
seven after the scheduled despawn. Population pass cost was within the
0.20 ms p95 and 0.50 ms maximum gates. Projection spread retained 100% of the
no-social baseline.

## Blockers

1. **No measurable signal-level social influence.** The Population Cognition
   summaries report `influenceNorm: 0` throughout, so the five-second gradual
   build gate fails.
2. **No final individuality separation.** All eight characters finish with the
   same `microBelief.socialPositivity`, failing the legible individuality gate.
3. **Human evaluation pending.** The required blind social-on/social-off review
   has not shown stronger perceived peer awareness without reduced
   Individuality or Calm.

Because the first two deterministic gates fail, Set Attention must remain
guarded by `POPULATION_COGNITION_ENABLED = false`. Human evaluation is deferred
until the implementation produces measurable gradual influence.
