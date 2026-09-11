import rawLexicon from "./lexicon.json";
import type { PersonalityDimensions } from "../cognition";
import {
  GENERATED_SPEECH_VOICE_PROFILE_VERSION,
  MAX_GENERATED_ATTEMPTS,
  SpeechHandle,
  SpeechHandleInit,
  SpeechRequest,
  isValidGeneratedSpeechExpression,
} from "../speech";
import type {
  BubbleTone,
  ExpressionIntensity,
  UtteranceIntent,
} from "../speech";

type LexiconCategory =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "function";

interface LexiconEntry {
  readonly lemma: string;
  readonly category: LexiconCategory;
  readonly tones: readonly BubbleTone[];
}

interface LexiconFile {
  readonly schemaVersion: number;
  readonly extractionContract: number;
  readonly entries: readonly LexiconEntry[];
}

interface VoiceProfile {
  readonly skeletons: Record<UtteranceIntent, readonly string[]>;
  readonly terminal: string;
}

const lexicon = rawLexicon as unknown as LexiconFile;

/** Validate the packaged bank once so malformed packaging fails closed. */
function assertUsableLexicon(): void {
  if (
    lexicon.schemaVersion !== 1 ||
    lexicon.extractionContract !== 1 ||
    lexicon.entries.length === 0
  ) {
    throw new Error("Speech lexicon bank is not usable");
  }
}

assertUsableLexicon();

const LEXICON_CATEGORIES: readonly LexiconCategory[] = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "function",
];

/** Pre-partitioned category/tone pools keep one expression under the p95 gate. */
const WORD_POOLS = new Map<string, readonly LexiconEntry[]>();
for (const category of LEXICON_CATEGORIES) {
  for (const tone of ["cheerful", "curious", "grumpy"] as const) {
    WORD_POOLS.set(
      `${category}:${tone}`,
      lexicon.entries.filter((entry) =>
        entry.category === category && entry.tones.includes(tone),
      ),
    );
  }
}

const MASK_DUDE: VoiceProfile = {
  terminal: ".",
  skeletons: {
    greet: ["hello, {adjective} {noun}", "{function} {noun} can {verb}"],
    idle: ["the {noun} feels {adjective}", "{adjective} path here"],
    startle: ["oh, the {noun} may {verb}", "{adjective} {noun} moved"],
    excite: ["look, the {noun} can {verb}!", "{adjective} turn!"],
    investigate: ["what makes the {noun} {verb}?", "where is the {noun}?"],
    bored: ["the {noun} rests {adverb}", "{adjective} {noun} rests"],
  },
};

const NINJA_FROG: VoiceProfile = {
  terminal: ".",
  skeletons: {
    greet: ["{noun} check", "{adjective}, no trouble"],
    idle: ["{noun} mode", "{adverb} still"],
    startle: ["{noun} moved", "too {adjective}"],
    excite: ["that {noun} can {verb}!", "good, {adjective}!"],
    investigate: ["track the {noun}", "{adjective} trace"],
    bored: ["no {noun}", "same {noun}"],
  },
};

const PINK_MAN: VoiceProfile = {
  terminal: "!",
  skeletons: {
    greet: ["hi hi, {adjective} {noun}!", "hello, {adjective} {noun}!"],
    idle: ["{adjective} {noun} time!", "{adjective} {noun} again!"],
    startle: ["wah, the {noun} can {verb}!", "{adjective} pop!"],
    excite: ["{adjective} {noun}, yes yes!", "{function} {noun} booms!"],
    investigate: ["why can the {noun} {verb}?", "a tiny {noun} mystery?"],
    bored: ["the {noun} went quiet", "hm, no {noun}"],
  },
};

const VIRTUAL_GUY: VoiceProfile = {
  terminal: ".",
  skeletons: {
    greet: ["contact: {adjective} {noun}", "zone reads {adjective}"],
    idle: ["scanning the {adjective} {noun}", "routine {noun}"],
    startle: ["alert: {noun} may {verb}", "unverified {noun}"],
    excite: ["useful {noun}: it can {verb}", "pattern reads {adjective}"],
    investigate: ["sample the {noun}, then {verb}", "why is the {noun} {adjective}?"],
    bored: ["all quiet", "holding {adverb}"],
  },
};

const VOICE_PROFILES: readonly VoiceProfile[] = [
  MASK_DUDE,
  NINJA_FROG,
  PINK_MAN,
  VIRTUAL_GUY,
];

const DEFAULT_SKELETONS: Record<UtteranceIntent, readonly string[]> = {
  greet: ["hello, {adjective} {noun}"],
  idle: ["the {noun} is {adjective}"],
  startle: ["oh, the {noun} moved"],
  excite: ["the {noun} can {verb}!"],
  investigate: ["what is the {noun}?"],
  bored: ["the {noun} rests"],
};

function hashLineage(parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
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

/** Derive one of four stable fingerprints; unknown archetypes stay deterministic. */
function profileFor(archetype: string, personalitySeed: number): VoiceProfile {
  const named = new Map<string, VoiceProfile>([
    ["mask-dude", MASK_DUDE],
    ["ninja-frog", NINJA_FROG],
    ["pink-man", PINK_MAN],
    ["virtual-guy", VIRTUAL_GUY],
  ] as const).get(archetype);
  if (named) return named;
  return VOICE_PROFILES[
    hashLineage([archetype, personalitySeed]) % VOICE_PROFILES.length
  ];
}

function pickWord(
  category: LexiconCategory,
  tone: BubbleTone,
  personality: PersonalityDimensions,
  random: number,
): string | null {
  const words = WORD_POOLS.get(`${category}:${tone}`) ?? [];
  if (words.length === 0) return null;

  const dimension =
    category === "adjective"
      ? personality.sociability
      : category === "verb"
        ? personality.energy
        : category === "adverb"
          ? personality.boldness
          : category === "function"
            ? 0.5
            : personality.curiosity;
  const bias = 0.75 + dimension * 0.5;
  const total = words.length * bias;
  let cursor = random * total;
  for (const word of words) {
    cursor -= bias;
    if (cursor < 0) return word.lemma;
  }
  return words[words.length - 1].lemma;
}

function skeletonWeight(
  skeleton: string,
  intent: UtteranceIntent,
  intensity: ExpressionIntensity,
  personality: PersonalityDimensions,
): number {
  const exclamatory = skeleton.includes("!");
  const terse = skeleton.length <= 24;
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
  profile: VoiceProfile,
  request: SpeechRequest,
  random: number,
): string {
  const skeletons =
    profile.skeletons[request.direction.intent] ??
    DEFAULT_SKELETONS[request.direction.intent];
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

function expandSkeleton(
  skeleton: string,
  request: SpeechRequest,
  terminal: string,
  random: () => number,
): string | null {
  const cache = new Map<LexiconCategory, string | null>();
  const text = skeleton.replace(
    /\{(noun|verb|adjective|adverb|function)\}/g,
    (_match, category: LexiconCategory) => {
      if (!cache.has(category)) {
        cache.set(
          category,
          pickWord(
            category,
            request.direction.tone,
            request.personality,
            random(),
          ),
        );
      }
      return cache.get(category) ?? "";
    },
  );

  const condensed = text.replace(/\s+/g, " ").trim();
  if (!/[.!?]$/.test(condensed)) {
    return `${condensed}${request.direction.intensity === "charged" ? "!" : terminal}`;
  }
  return condensed;
}

/**
 * The production generator expands curated OEWN/Wisp words through authored
 * persona skeletons. It is synchronous and pure: every choice descends from
 * the request seed and no mutable generation state survives a request.
 */
export function createGeneratedSpeechHandle(
  init: SpeechHandleInit,
): SpeechHandle {
  const profile = profileFor(init.archetype, init.personalitySeed);
  return {
    voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
    generate(request: SpeechRequest) {
      const random = mulberry32(request.seed);
      for (let attempt = 0; attempt < MAX_GENERATED_ATTEMPTS; attempt++) {
        const skeleton = pickSkeleton(profile, request, random());
        const text = expandSkeleton(
          skeleton,
          request,
          request.direction.intensity === "quiet" ? "." : profile.terminal,
          random,
        );
        if (
          text !== null &&
          isValidGeneratedSpeechExpression(
            { text, tone: request.direction.tone, source: "generated" },
            request.direction,
            request.context.recentExpressions,
          )
        ) {
          return { text, tone: request.direction.tone, source: "generated" };
        }
      }
      return null;
    },
  };
}
