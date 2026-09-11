import {
  BehaviorSignal,
  NEUTRAL_BEHAVIOR_SIGNAL,
  PersonalityDimensions,
  ToneSeed,
} from "./cognition";
import { BUBBLE_TONE_WEIGHTS } from "./config";

/** The accepted tone vocabulary. Every speech line has exactly one tag. */
export type BubbleTone = "cheerful" | "curious" | "grumpy";

export interface TaggedLine {
  readonly text: string;
  readonly tone: BubbleTone;
}

/** Compatibility boundary for the disabled production speech seam. */
export const SPEECH_VOICE_PROFILE_VERSION = "neutral-speech-v1";

/** Upper bound for a generated expression before the registry validates it. */
export const MAX_SPEECH_TEXT_LENGTH = 160;
/** Hard bound on the in-session anti-repetition context. */
export const MAX_RECENT_EXPRESSIONS = 8;

export type SpeechOccasionKind = "greeting" | "idle";
export type UtteranceIntent =
  | "greet"
  | "idle"
  | "startle"
  | "excite"
  | "investigate"
  | "bored";
export type ExpressionIntensity = "quiet" | "neutral" | "charged";
export type StanceModifier = "novel" | "familiar" | "social" | "cautious";

export interface ExpressionDirection {
  readonly tone: BubbleTone;
  readonly intent: UtteranceIntent;
  readonly intensity: ExpressionIntensity;
  readonly stance: StanceModifier | null;
}

export interface SpeechHandleInit {
  readonly characterId: string;
  readonly archetype: string;
  readonly personalitySeed: number;
}

export interface SpeechRequest {
  readonly occasion: { readonly kind: SpeechOccasionKind };
  readonly personality: PersonalityDimensions;
  readonly direction: ExpressionDirection;
  readonly context: {
    readonly recentExpressions: readonly string[];
  };
  readonly seed: number;
}

export interface SpeechExpression {
  readonly text: string;
  readonly tone: BubbleTone;
  readonly source: "generated" | "fallback";
}

/** Final, immutable outcome recorded by the canonical expression trace. */
export type SpeechExpressionStatus = "generated" | "substituted";

export interface SpeechExpressionRecord {
  readonly characterId: string;
  readonly occasion: { readonly kind: SpeechOccasionKind };
  readonly expressionOrdinal: number;
  readonly archetype: string;
  readonly personalitySeed: number;
  readonly voiceProfileVersion: string;
  readonly expressionSeed: number;
  readonly tone: BubbleTone;
  readonly intent: UtteranceIntent;
  readonly intensity: ExpressionIntensity;
  readonly stance: StanceModifier | null;
  readonly status: SpeechExpressionStatus;
  readonly text: string;
}

export interface SpeechHandle {
  generate(request: SpeechRequest): SpeechExpression | null;
}

export type SpeechHandleFactory = (init: SpeechHandleInit) => SpeechHandle;

/**
 * The disabled production default. Its only decision is to refuse generation;
 * the registry then owns the exact existing fixed-line fallback.
 */
export function createNeutralSpeechHandle(): SpeechHandle {
  return {
    generate() {
      return null;
    },
  };
}

const REACTION_INTENTS = {
  startle: "startle",
  excitement: "excite",
  curiosity: "investigate",
  boredom: "bored",
} as const;

/**
 * Registry-side projection from observable Cognition state. The thresholds are
 * intentionally coarse and frame-independent; they do not expose raw
 * BehaviorSignal to a Speech Handle.
 */
export function deriveExpressionDirection(
  signal: BehaviorSignal,
  occasion: SpeechOccasionKind,
  toneRoll = 0,
): ExpressionDirection {
  const intent =
    signal.reaction.kind === "none"
      ? occasion === "greeting" ? "greet" : "idle"
      : REACTION_INTENTS[signal.reaction.kind];
  const intensity: ExpressionIntensity =
    signal.reaction.kind !== "none" || signal.affect.arousal > 0.66
      ? "charged"
      : signal.affect.arousal < 0.33 ? "quiet" : "neutral";

  const centeredBeliefs = [
    { stance: "novel" as const, magnitude: signal.microBelief.novelty - 0.5 },
    {
      stance: "familiar" as const,
      magnitude: signal.microBelief.familiarity - 0.5,
    },
    {
      stance: "social" as const,
      magnitude: signal.microBelief.socialPositivity - 0.5,
    },
    { stance: "cautious" as const, magnitude: signal.microBelief.caution - 0.5 },
  ].sort((left, right) => Math.abs(right.magnitude) - Math.abs(left.magnitude));
  const dominant = centeredBeliefs[0];
  const stance =
    Math.abs(dominant.magnitude) > 0.05 ? dominant.stance : null;

  return { tone: selectBubbleTone(signal, toneRoll), intent, intensity, stance };
}

/** Derive the opaque expression lineage seed without consuming scheduler RNG. */
export function deriveExpressionSeed(
  init: SpeechHandleInit,
  occasion: SpeechOccasionKind,
  expressionOrdinal: number,
  direction: ExpressionDirection,
  recentExpressions: readonly string[],
): number {
  const lineage = [
    SPEECH_VOICE_PROFILE_VERSION,
    init.archetype,
    init.personalitySeed,
    init.characterId,
    occasion,
    expressionOrdinal,
    direction.intent,
    direction.tone,
    direction.intensity,
    direction.stance ?? "none",
    ...recentExpressions.slice(-MAX_RECENT_EXPRESSIONS),
  ].join("\0");

  let hash = 0x811c9dc5;
  for (let index = 0; index < lineage.length; index++) {
    hash ^= lineage.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Independent, bounded, fail-closed acceptance check. Subjective quality is not
 * validation: only contract and safety bounds gate use of generated text.
 */
export function isValidGeneratedSpeechExpression(
  expression: unknown,
  direction: ExpressionDirection,
): expression is SpeechExpression {
  if (!expression || typeof expression !== "object") return false;
  const candidate = expression as Partial<SpeechExpression>;
  return (
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    candidate.text.length <= MAX_SPEECH_TEXT_LENGTH &&
    candidate.tone === direction.tone &&
    candidate.source === "generated"
  );
}

/** Convenience projection for the greeting, which precedes the first cadence tick. */
export function neutralSpeechSignal(
  toneSeed: Pick<ToneSeed, "personality" | "affect">,
): BehaviorSignal {
  return {
    ...NEUTRAL_BEHAVIOR_SIGNAL,
    personality: { ...toneSeed.personality },
    affect: { ...toneSeed.affect },
  };
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
