# Issue #58 activation waiver

## Decision

The product owner explicitly authorized cognition default-on in the
experimental Wisp line, despite the issue #58 human comparison being incomplete
and the completed pilot not meeting the proposed human gates.

This is an **experimental rollout waiver**, not an acceptance pass. Issue #58
must remain open because only 1 of 3 evaluators participated.

## Evidence summary

- Evaluators completed: **1 / 3**
- Pair preferences for cognition: **0 / 4**
- Overall preference: **baseline**
- Cognition medians: Alive/Aware **2.5**, Individuality **2.5**,
  Appropriateness **2.5**, Variation **2.5**, Calm **3.5**
- Correct principal-reaction descriptions: **0 / 4** in the pilot
- Noisy/disturbing reports: **0**

## Revert condition

Revert `COGNITION_LIVE_DEFAULT_ENABLED` to `false` if later human evaluation
reports noisy or disturbing behavior, or if cognition remains worse than
baseline when more evaluators complete the study.
