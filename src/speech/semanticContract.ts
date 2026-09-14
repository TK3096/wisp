import rawLexicon from "./lexicon.json";
import rawContract from "./semanticContract.json";
import type { PersonalityDimensions } from "../cognition";
import type {
  BubbleTone,
  ExpressionIntensity,
  StanceModifier,
  UtteranceIntent,
} from "../speech";

/** The closed intensity vocabulary accepted by the semantic contract. */
export const SEMANTIC_INTENSITIES = [
  "quiet",
  "neutral",
  "charged",
] as const satisfies readonly ExpressionIntensity[];

const INTENTS = [
  "greet",
  "idle",
  "startle",
  "excite",
  "investigate",
  "bored",
] as const satisfies readonly UtteranceIntent[];

const TONES = ["cheerful", "curious", "grumpy"] as const;
const PERSONALITY_DIMENSIONS = [
  "energy",
  "curiosity",
  "boldness",
  "sociability",
] as const;

type LexiconCategory = "noun" | "verb" | "adjective" | "adverb" | "function";

interface LexiconEntry {
  readonly lemma: string;
  readonly category: LexiconCategory;
  readonly tones: readonly BubbleTone[];
}

interface SemanticSlotData {
  readonly name: string;
  readonly definition: string;
  readonly selection: keyof PersonalityDimensions;
  readonly words: readonly string[];
  readonly stanceWords: Partial<Record<StanceModifier, readonly string[]>>;
}

export interface SemanticSkeletonData {
  readonly template: string;
  readonly slots: readonly string[];
  readonly intensities: readonly ExpressionIntensity[];
}

export interface SemanticVoiceData {
  readonly archetype: string;
  readonly terminal: string;
  readonly preferredWords: Record<string, readonly string[]>;
  readonly skeletons: Record<UtteranceIntent, readonly SemanticSkeletonData[]>;
}

export interface SemanticContractData {
  readonly schemaVersion: number;
  readonly contractVersion: string;
  readonly slots: readonly SemanticSlotData[];
  readonly voices: readonly SemanticVoiceData[];
}

export interface SemanticVoiceProfile {
  readonly archetype: string;
  readonly terminal: string;
  readonly preferredWords: ReadonlyMap<string, ReadonlySet<string>>;
  readonly skeletons: {
    readonly [Intent in UtteranceIntent]: readonly SemanticSkeletonData[];
  };
}

const contract = rawContract as unknown as SemanticContractData;
const lexicon = rawLexicon as unknown as {
  readonly schemaVersion: number;
  readonly extractionContract: number;
  readonly entries: readonly LexiconEntry[];
};

/**
 * Validate a candidate against the exact contract shape and the packaged
 * source inventory. Any malformed authored word, slot, skeleton, or coverage
 * gap throws during module initialization, making the generator fail closed.
 */
export function validateSemanticContract(
  candidate: SemanticContractData,
  inventory: { entries: readonly LexiconEntry[] },
): void {
  if (candidate.schemaVersion !== 1) {
    throw new Error("semantic contract schemaVersion must be 1");
  }
  if (!/^speech-semantic-coherence-v\d+$/.test(candidate.contractVersion)) {
    throw new Error("semantic contractVersion is malformed");
  }
  const inventoryByLemma = new Map(
    inventory.entries.map((entry) => [entry.lemma, entry]),
  );
  const slotNames = new Set<string>();
  const inventoryUses = new Map<string, string>();

  if (candidate.slots.length === 0) {
    throw new Error("semantic contract has no slots");
  }
  for (const [index, slot] of candidate.slots.entries()) {
    const path = `slots[${index}]`;
    if (!/^[a-z][a-z-]*$/.test(slot.name) || slotNames.has(slot.name)) {
      throw new Error(`${path} has an invalid or duplicate name`);
    }
    if (slot.definition.trim().length === 0) {
      throw new Error(`${path}.definition is empty`);
    }
    if (
      !PERSONALITY_DIMENSIONS.includes(
        slot.selection as typeof PERSONALITY_DIMENSIONS[number],
      ) ||
      slot.words.length === 0
    ) {
      throw new Error(`${path} has an invalid selection or empty word set`);
    }
    slotNames.add(slot.name);
    for (const [stance, words] of Object.entries(slot.stanceWords ?? {})) {
      if (
        !["novel", "familiar", "social", "cautious"].includes(stance) ||
        words.some((word) => !slot.words.includes(word))
      ) {
        throw new Error(`${path}.stanceWords is invalid`);
      }
    }
    for (const word of slot.words) {
      if (!/^[a-z]+$/.test(word)) {
        throw new Error(`${path}.words contains a malformed word`);
      }
      if (inventoryUses.has(word)) {
        throw new Error(`${word} is assigned to more than one semantic slot`);
      }
      const entry = inventoryByLemma.get(word);
      if (!entry) {
        throw new Error(`${word} is absent from the packaged lexicon inventory`);
      }
      if (!TONES.some((tone) => entry.tones.includes(tone))) {
        throw new Error(`${word} has no accepted tone in the inventory`);
      }
      inventoryUses.set(word, slot.name);
    }
  }

  if (candidate.voices.length === 0) {
    throw new Error("semantic contract has no voices");
  }
  const archetypes = new Set<string>();
  for (const [voiceIndex, voice] of candidate.voices.entries()) {
    const path = `voices[${voiceIndex}]`;
    if (!voice.archetype || archetypes.has(voice.archetype)) {
      throw new Error(`${path} has an invalid or duplicate archetype`);
    }
    archetypes.add(voice.archetype);
    if (!/^[.!]$/.test(voice.terminal)) {
      throw new Error(`${path}.terminal must be one period or exclamation mark`);
    }

    for (const [slotName, words] of Object.entries(voice.preferredWords)) {
      const slot = candidate.slots.find((item) => item.name === slotName);
      if (!slot || words.length === 0) {
        throw new Error(`${path}.preferredWords.${slotName} is not a valid slot`);
      }
      for (const word of words) {
        if (!slot.words.includes(word)) {
          throw new Error(
            `${path} prefers ${word} outside the ${slotName} approved set`,
          );
        }
      }
    }

    for (const intent of INTENTS) {
      const skeletons: readonly SemanticSkeletonData[] = voice.skeletons[intent];
      if (!Array.isArray(skeletons) || skeletons.length === 0) {
        throw new Error(`${path}.skeletons.${intent} is empty`);
      }
      if (Object.keys(voice.skeletons).length !== INTENTS.length) {
        throw new Error(`${path}.skeletons has unknown intents`);
      }
      for (const [
        skeletonIndex,
        skeleton,
      ] of skeletons.entries()) {
        const skeletonPath = `${path}.skeletons.${intent}[${skeletonIndex}]`;
        const slots: readonly string[] = skeleton.slots;
        const intensities: readonly ExpressionIntensity[] = skeleton.intensities;
        const placeholders = [...skeleton.template.matchAll(/\{([a-z-]+)\}/g)]
          .map((match) => match[1]);
        if (/[{}]/.test(skeleton.template.replace(/\{[a-z-]+\}/g, ""))) {
          throw new Error(`${skeletonPath} has an unbalanced placeholder`);
        }
        if (
          placeholders.length !== skeleton.slots.length ||
          placeholders.some((slot, position) => slot !== slots[position])
        ) {
          throw new Error(`${skeletonPath} does not declare its exact slots`);
        }
        if (
          slots.some((slot) => !slotNames.has(slot)) ||
          new Set(slots).size !== slots.length
        ) {
          throw new Error(`${skeletonPath} has an invalid or duplicate slot`);
        }
        if (
          intensities.length === 0 ||
          intensities.some(
            (intensity) => !SEMANTIC_INTENSITIES.includes(intensity),
          ) ||
          new Set(intensities).size !== intensities.length
        ) {
          throw new Error(`${skeletonPath} has invalid intensity compatibility`);
        }
        if (
          intensities.includes("quiet") &&
          /!$/.test(skeleton.template)
        ) {
          throw new Error(`${skeletonPath} is incompatible with quiet output`);
        }
        if (
          (intent === "startle" || intent === "excite") &&
          intensities.includes("charged") &&
          !skeleton.template.endsWith("!")
        ) {
          throw new Error(`${skeletonPath} lacks charged punctuation`);
        }

        const longestWords = slots.map((slotName: string) => {
          const slot = candidate.slots.find((item) => item.name === slotName)!;
          return slot.words.reduce((longest, word) =>
            word.length > longest.length ? word : longest,
          );
        });
        const projected = skeleton.template.replace(
          /\{[a-z-]+\}/g,
          () => longestWords.shift() ?? "",
        );
        if ([...projected].length > 48) {
          throw new Error(`${skeletonPath} can exceed the speech length bound`);
        }
      }

      for (const intensity of SEMANTIC_INTENSITIES) {
        if (
          !skeletons.some((skeleton) =>
            skeleton.intensities.includes(intensity),
          )
        ) {
          throw new Error(
            `${path}.skeletons.${intent} has no ${intensity} skeleton`,
          );
        }
      }
    }
  }
}

validateSemanticContract(contract, lexicon);

export const SPEECH_SEMANTIC_CONTRACT_VERSION = contract.contractVersion;

const TONE_WORD_SETS = new Map<string, ReadonlySet<string>>();
for (const slot of contract.slots) {
  for (const tone of TONES) {
    const words = slot.words.filter((word) =>
      lexicon.entries
        .filter((entry) => entry.lemma === word)
        .some((entry) => entry.tones.includes(tone)),
    );
    TONE_WORD_SETS.set(`${slot.name}:${tone}`, new Set(words));
  }
}

const SLOT_BY_NAME = new Map(contract.slots.map((slot) => [slot.name, slot]));

function voiceData(archetype: string, personalitySeed: number): SemanticVoiceData {
  const named = contract.voices.find((voice) => voice.archetype === archetype);
  if (named) return named;
  let hash = 0x811c9dc5;
  const lineage = [archetype, personalitySeed].join("\0");
  for (let index = 0; index < lineage.length; index += 1) {
    hash ^= lineage.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return contract.voices[(hash >>> 0) % contract.voices.length];
}

/**
 * Resolve a concrete, immutable voice from the shared contract. Unknown
 * archetypes receive a deterministic authored profile rather than generic
 * runtime slot generation.
 */
export function getSemanticVoiceProfile(
  archetype: string,
  personalitySeed: number,
): SemanticVoiceProfile {
  const data = voiceData(archetype, personalitySeed);
  return {
    archetype: data.archetype,
    terminal: data.terminal,
    preferredWords: new Map(
      Object.entries(data.preferredWords).map(([slot, words]) => [
        slot,
        new Set(words),
      ]),
    ),
    skeletons: data.skeletons,
  };
}

export function approvedSemanticWords(
  slotName: string,
  tone: BubbleTone,
): readonly string[] {
  return [...(TONE_WORD_SETS.get(`${slotName}:${tone}`) ?? [])].sort();
}

export function stanceSemanticWords(
  slotName: string,
  stance: StanceModifier,
): readonly string[] {
  return SLOT_BY_NAME.get(slotName)?.stanceWords[stance] ?? [];
}

export function semanticSlotSelection(
  slotName: string,
): keyof PersonalityDimensions {
  const selection = SLOT_BY_NAME.get(slotName)?.selection;
  if (!selection) throw new Error(`Unknown semantic slot: ${slotName}`);
  return selection;
}

export interface SemanticAssignmentLike {
  readonly slot: string;
  readonly word: string;
}

/**
 * Runtime membership gate for one expansion. The skeleton must be authored
 * for this exact voice/intent and every chosen word must belong to the exact
 * approved, tone-compatible slot set declared by the shared contract.
 */
export function isValidSemanticExpansion(
  profile: SemanticVoiceProfile,
  intent: UtteranceIntent,
  skeleton: SemanticSkeletonData,
  assignments: readonly SemanticAssignmentLike[],
  tone: BubbleTone,
): boolean {
  if (!profile.skeletons[intent].includes(skeleton)) return false;
  const placeholders = [...skeleton.template.matchAll(/\{([a-z-]+)\}/g)]
    .map((match) => match[1]);
  if (placeholders.length !== assignments.length) return false;

  return placeholders.every((slot, index) => {
    const assignment = assignments[index];
    return assignment !== undefined &&
      assignment.slot === slot &&
      approvedSemanticWords(slot, tone).includes(assignment.word);
  });
}

export {
  contract as SPEECH_SEMANTIC_CONTRACT,
  SLOT_BY_NAME as SEMANTIC_SLOT_BY_NAME,
};
