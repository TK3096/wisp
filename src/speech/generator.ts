import type { PersonalityDimensions } from "../cognition";
import {
  GENERATED_SPEECH_VOICE_PROFILE_VERSION,
  MAX_GENERATED_ATTEMPTS,
  SpeechHandle,
  SpeechRequest,
  isValidGeneratedSpeechExpression,
} from "../speech";
import type {
  BubbleTone,
  ExpressionIntensity,
  StanceModifier,
  UtteranceIntent,
} from "../speech";
import type { SpeechHandleInit } from "../speech";
import {
  approvedSemanticWords,
  getSemanticVoiceProfile,
  semanticSlotSelection,
  stanceSemanticWords,
  isValidSemanticExpansion,
  type SemanticSkeletonData,
  type SemanticVoiceProfile,
} from "./semanticContract";

interface SemanticAssignment {
  readonly slot: string;
  readonly word: string;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function pickWord(
  skeletonSlot: string,
  tone: BubbleTone,
  stance: StanceModifier | null,
  personality: PersonalityDimensions,
  preferences: ReadonlySet<string>,
  random: number,
): string | null {
  const words = approvedSemanticWords(skeletonSlot, tone);
  if (words.length === 0) return null;

  const personalityBias =
    0.75 + personality[semanticSlotSelection(skeletonSlot)] * 0.5;
  const weighted = words.map((word) => ({
    word,
    weight:
      personalityBias *
      (preferences.has(word) ? 2.2 : 1) *
      (stance !== null && stanceSemanticWords(skeletonSlot, stance).includes(word)
        ? 1.8
        : 1),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.word;
  }
  return weighted[weighted.length - 1].word;
}

function skeletonWeight(
  skeleton: SemanticSkeletonData,
  intent: UtteranceIntent,
  intensity: ExpressionIntensity,
  personality: PersonalityDimensions,
): number {
  const exclamatory = skeleton.template.endsWith("!");
  const terse = skeleton.template.length <= 24;
  let weight = 1;
  if (intent === "excite" || intent === "startle") {
    weight += exclamatory
      ? (intent === "excite" ? personality.energy : personality.boldness) * 0.8
      : -0.15;
  }
  if ((intent === "idle" || intent === "bored") && intensity === "quiet") {
    weight += terse ? 0.6 : -0.2;
  }
  if (intensity === "charged" && exclamatory) weight += 0.5;
  return Math.max(0.05, weight);
}

function pickSkeleton(
  profile: SemanticVoiceProfile,
  request: SpeechRequest,
  random: number,
): SemanticSkeletonData {
  const skeletons = profile.skeletons[request.direction.intent].filter(
    (skeleton) =>
      skeleton.intensities.includes(request.direction.intensity),
  );
  const weighted = skeletons.map((skeleton) => ({
    skeleton,
    weight: skeletonWeight(
      skeleton,
      request.direction.intent,
      request.direction.intensity,
      request.personality,
    ),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.skeleton;
  }
  return weighted[weighted.length - 1].skeleton;
}

/** Re-read the completed text from the exact template and chosen members. */
function exactSkeletonText(
  skeleton: SemanticSkeletonData,
  assignments: readonly SemanticAssignment[],
): string | null {
  let assignmentIndex = 0;
  const expanded = skeleton.template.replace(
    /\{([a-z-]+)\}/g,
    (_match, slot: string) => {
      const assignment = assignments[assignmentIndex++];
      return assignment?.slot === slot ? assignment.word : "";
    },
  );
  if (assignmentIndex !== assignments.length) return null;
  return expanded.replace(/\s+/g, " ").trim();
}

function finalizeSemanticText(
  exact: string,
  intensity: ExpressionIntensity,
  terminal: string,
): string {
  if (/[.!?]$/.test(exact)) return exact;
  const suffix = intensity === "charged" ? "!" : intensity === "quiet" ? "." : terminal;
  return `${exact}${suffix}`;
}

/**
 * The production generator expands only contract-approved semantic-slot words
 * through authored persona skeletons. It is synchronous and pure: every choice
 * descends from the request seed and no mutable generation state survives.
 */
export function createGeneratedSpeechHandle(init: SpeechHandleInit): SpeechHandle {
  const profile = getSemanticVoiceProfile(init.archetype, init.personalitySeed);
  return {
    voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
    generateWithAttemptCount(request: SpeechRequest) {
      const random = mulberry32(request.seed);
      for (let attempt = 0; attempt < MAX_GENERATED_ATTEMPTS; attempt++) {
        const skeleton = pickSkeleton(profile, request, random());
        const assignments: SemanticAssignment[] = [];
        const cache = new Map<string, string | null>();
        let expansionFailed = false;
        for (const slot of skeleton.slots) {
          if (!cache.has(slot)) {
            cache.set(
              slot,
              pickWord(
                slot,
                request.direction.tone,
                request.direction.stance,
                request.personality,
                profile.preferredWords.get(slot) ?? new Set(),
                random(),
              ),
            );
          }
          const word = cache.get(slot);
          if (word === null || word === undefined) {
            expansionFailed = true;
            break;
          }
          assignments.push({ slot, word });
        }
        if (expansionFailed) continue;

        if (
          !isValidSemanticExpansion(
            profile,
            request.direction.intent,
            skeleton,
            assignments,
            request.direction.tone,
          )
        ) {
          continue;
        }

        const exact = exactSkeletonText(skeleton, assignments);
        const text = exact === null
          ? null
          : finalizeSemanticText(
            exact,
            request.direction.intensity,
            profile.terminal,
          );
        if (
          exact !== null &&
          text !== null &&
          isValidGeneratedSpeechExpression(
            { text, tone: request.direction.tone, source: "generated" },
            request.direction,
            request.context.recentExpressions,
          )
        ) {
          return {
            expression: {
              text,
              tone: request.direction.tone,
              source: "generated",
            },
            attempts: attempt + 1,
          };
        }
      }
      return { expression: null, attempts: MAX_GENERATED_ATTEMPTS };
    },
    generate(request: SpeechRequest) {
      return this.generateWithAttemptCount?.(request).expression ?? null;
    },
  };
}
