import { BehaviorSignal, PersonalityDimensions } from "./cognition";
import { BUBBLE_TONE_WEIGHTS } from "./config";

/** The accepted tone vocabulary. Every speech line has exactly one tag. */
export type BubbleTone = "cheerful" | "curious" | "grumpy";

export interface TaggedLine {
  readonly text: string;
  readonly tone: BubbleTone;
}

/**
 * Weighted sampling is deterministic but deliberately non-exclusive: every
 * tone keeps a positive base weight, so a bold character may occasionally be
 * grumpy and a low-valence character may occasionally be cheerful.
 */
export function bubbleToneWeights(
  personality: PersonalityDimensions,
  affect: BehaviorSignal["affect"],
): Record<BubbleTone, number> {
  const positiveValence = Math.max(0, affect.valence);
  const negativeValence = Math.max(0, -affect.valence);
  return {
    cheerful:
      BUBBLE_TONE_WEIGHTS.cheerful.base +
      BUBBLE_TONE_WEIGHTS.cheerful.sociability * personality.sociability +
      BUBBLE_TONE_WEIGHTS.cheerful.energy * personality.energy +
      BUBBLE_TONE_WEIGHTS.cheerful.positiveValence * positiveValence,
    curious:
      BUBBLE_TONE_WEIGHTS.curious.base +
      BUBBLE_TONE_WEIGHTS.curious.curiosity * personality.curiosity +
      BUBBLE_TONE_WEIGHTS.curious.surprise * affect.surprise +
      BUBBLE_TONE_WEIGHTS.curious.arousal * affect.arousal,
    grumpy:
      BUBBLE_TONE_WEIGHTS.grumpy.base +
      BUBBLE_TONE_WEIGHTS.grumpy.negativeValence * negativeValence +
      BUBBLE_TONE_WEIGHTS.grumpy.arousal * affect.arousal +
      BUBBLE_TONE_WEIGHTS.grumpy.lowSociability * (1 - personality.sociability),
  };
}

export function selectBubbleTone(
  signal: Pick<BehaviorSignal, "personality" | "affect">,
  roll: number,
): BubbleTone {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error("Bubble tone roll must be finite and within [0, 1)");
  }

  const weights = bubbleToneWeights(signal.personality, signal.affect);
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let cursor = roll * total;
  for (const tone of ["cheerful", "curious", "grumpy"] as const) {
    cursor -= weights[tone];
    if (cursor < 0) return tone;
  }
  return "grumpy";
}

export function selectTaggedLine<Line extends TaggedLine>(
  lines: readonly Line[],
  signal: Pick<BehaviorSignal, "personality" | "affect">,
  roll: number,
): Line {
  if (lines.length === 0) throw new Error("Speech line pool must not be empty");
  const tone = selectBubbleTone(signal, roll);
  const candidates = lines.filter((line) => line.tone === tone);
  if (candidates.length === 0) {
    throw new Error(`Speech pool has no accepted ${tone} line`);
  }
  // The tone consumes one deterministic roll; within a tone, retain the old
  // stable floor selection by mapping the same roll through that subset.
  return candidates[Math.floor(roll * candidates.length)];
}
