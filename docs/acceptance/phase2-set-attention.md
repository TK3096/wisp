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
seven after the scheduled despawn. Distinct personality and Behavior Bias groups
remained legible at the end of the soak. Population pass cost was within the
0.20 ms p95 and 5 ms host-GC-tolerant maximum gates. Projection spread retained
100.95% of the no-social baseline, and first signal influence occurred at
1 second.

## Blockers

1. **Human evaluation pending.** The required blind social-on/social-off review
   has not shown stronger perceived peer awareness without reduced
   Individuality or Calm.

All deterministic gates pass, but activation is still blocked because issue #60
explicitly requires the human gate before real desktop use. Set Attention
therefore remains guarded by `POPULATION_COGNITION_ENABLED = false`.
