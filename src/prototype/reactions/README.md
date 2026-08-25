# Micro-belief and surprise reaction prototype

**PROTOTYPE — throwaway decision aid, not production code.**

This terminal prototype answers one question: how should Wisp's LeakyIntegrator
Micro-belief state and Temporal Derivative surprise combine into short-lived
curiosity, startle, boredom, and excitement reactions without replacing the
existing idle/walk/jump behavior state machine?

Run it with:

```bash
npm run prototype:reactions
```

The candidate design separates three time scales:

1. **Temporal Derivative** reacts quickly. It turns the latest observation into
   a fast/slow EMA difference, then a bounded surprise gate.
2. **Micro-belief** interprets slowly. A LeakyIntegrator tracks change, social,
   habit, and caution channels; those channels are projected into novelty,
   familiarity, social positivity, and caution.
3. **Affect and reactions** are short lived. Surprise, arousal, and valence
   decay independently; a scored reaction may temporarily bias—but never
   command—the idle/walk/jump scheduler.

The prototype applies the Temporal Derivative sigmoid as a **centered surprise
energy** value: its mathematically neutral 0.5 gate becomes zero affect rather
than a permanent 50% surprise floor. Current candidate thresholds are:

| Reaction | Threshold | Duration | Cooldown after duration |
|---|---:|---:|---:|
| Curiosity | 0.35 | 3.0 s | 3.0 s |
| Startle | 0.58 | 0.8 s | 4.0 s |
| Excitement | 0.62 | 2.0 s | 5.0 s |
| Boredom | 0.75 | 4.0 s | 12.0 s |

Selection is exclusive: startle has priority over excitement, curiosity, and
boredom. A 0.6 s global lock follows every reaction. A repeated strong gesture
should progress from curiosity toward excitement; app blur should become
startle as caution accumulates; roughly 9–12 seconds without a stimulus should
produce boredom once.

The behavior pane is deliberately scheduler-shaped. Reaction selection is
exclusive, threshold-gated, and cooldown-protected. Jump and bubble actions
still happen only at their existing rolls, respect airborne status and the
global bubble cooldown, and receive bounded multipliers.

## Validated decision

The interactive prototype was accepted on 2026-08-25. The validated reaction
policy is:

- compute a centered **surprise energy** from the Temporal Derivative gate so
  its neutral 0.5 resting output becomes zero affect;
- let LeakyIntegrator Micro-belief interpret change, social, habit, and caution
  channels into novelty, familiarity, social positivity, and caution;
- decay surprise, arousal, and valence independently while micro-belief changes
  much more slowly;
- select one exclusive reaction in priority order: startle, excitement,
  curiosity, boredom;
- keep the current durations and cooldowns above as the initial Wisp tunables;
- emit only bounded `behaviorBias` multipliers. Reactions never force an
  idle/walk transition, jump, or bubble; the existing scheduler, airborne rule,
  jump rolls, bubble rolls, and global bubble cooldown remain authoritative.
