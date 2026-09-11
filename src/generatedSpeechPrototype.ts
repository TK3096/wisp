/**
 * PROTOTYPE — throwaway speech-quality exploration for Wayfinder #67.
 *
 * Question: can a small, personality-conditioned phrase grammar make Wisp
 * characters sound visibly different while remaining short, deterministic,
 * and safe to fall back to the existing fixed-line path?
 *
 * Confirmed implementation note: this prototype's sentence-shaped templates are
 * intentionally throwaway. Production should derive a small Wisp-owned word
 * bank at build time from an external lexical source, add authored tone/persona
 * tags, and runtime-expand grammar skeletons such as GREET + ADJ + NOUN. Do not
 * ship the full external corpus or use token-by-token model generation.
 */

import { GREETINGS, IDLE_LINES } from "./config";
import type { TaggedLine } from "./speech";
import type { PersonalityDimensions } from "./cognition";

export type UtteranceIntent =
  | "greet"
  | "idle"
  | "startle"
  | "excite"
  | "investigate"
  | "bored";

export type ExpressionIntensity = "quiet" | "neutral" | "charged";
export type StanceModifier = "novel" | "familiar" | "social" | "cautious";
export type BubbleTone = "cheerful" | "curious" | "grumpy";

export interface ExpressionDirection {
  tone: BubbleTone;
  intent: UtteranceIntent;
  intensity: ExpressionIntensity;
  stance: StanceModifier | null;
}

export interface PrototypeCharacter {
  id: string;
  archetype: string;
  personalitySeed: number;
  personality: PersonalityDimensions;
}

export interface SpeechRequest {
  occasion: { kind: "greeting" | "idle" };
  personality: PersonalityDimensions;
  direction: ExpressionDirection;
  context: { recentExpressions: readonly string[] };
  seed: number;
  forceFallback: boolean;
}

export interface SpeechExpression {
  text: string;
  tone: BubbleTone;
  source: "generated" | "fallback";
}

export interface SpeechTrace {
  ordinal: number;
  characterId: string;
  archetype: string;
  voiceVersion: string;
  seed: number;
  occasion: string;
  direction: ExpressionDirection;
  text: string;
  source: SpeechExpression["source"];
  accepted: boolean;
  reason: string;
}

interface WeightedWord {
  text: string;
  bias?: keyof PersonalityDimensions;
}

interface VoiceProfile {
  id: string;
  archetype: string;
  version: string;
  openers: WeightedWord[];
  adjectives: WeightedWord[];
  nouns: WeightedWord[];
  closers: WeightedWord[];
  punctuation: string;
  contraction: boolean;
}

type TemplateTable = Record<UtteranceIntent, readonly string[]>;

export const SPEECH_PROTOTYPE_VERSION = "prototype-voice-v1";

const PROTOTYPE_CHARACTERS: PrototypeCharacter[] = [
  {
    id: "mask-dude",
    archetype: "gentle warden",
    personalitySeed: 812319,
    personality: { energy: 0.32, curiosity: 0.55, boldness: 0.41, sociability: 0.78 },
  },
  {
    id: "ninja-frog",
    archetype: "terse shadow",
    personalitySeed: 401207,
    personality: { energy: 0.66, curiosity: 0.82, boldness: 0.69, sociability: 0.22 },
  },
  {
    id: "pink-man",
    archetype: "bright spark",
    personalitySeed: 730884,
    personality: { energy: 0.94, curiosity: 0.61, boldness: 0.72, sociability: 0.96 },
  },
  {
    id: "virtual-guy",
    archetype: "wary sentinel",
    personalitySeed: 259466,
    personality: { energy: 0.48, curiosity: 0.38, boldness: 0.25, sociability: 0.35 },
  },
];

const GRAMMARS: Record<string, TemplateTable> = {
  "gentle warden": {
    greet: ["hello, {adjective} {noun}", "welcome, {adjective} {noun}", "a soft hello"],
    idle: ["watching the {adjective} {noun}", "the {noun} feels {adjective}", "rest here"],
    startle: ["oh! the {noun} moved", "careful, {adjective} movement", "that was not there"],
    excite: ["look, the {noun} is glowing", "such a {adjective} turn", "the path woke up"],
    investigate: ["what bends the {noun}?", "where does the trail go?", "let me listen"],
    bored: ["quiet air today", "the {noun} waits", "no ripples yet"],
  },
  "terse shadow": {
    greet: ["yo. {noun} check", "here. quiet", "{adjective}, no problem"],
    idle: ["{noun} mode", "still. watching", "{adjective} corner"],
    startle: ["!! {noun}", "motion. west", "too close"],
    excite: ["fast one", "that {noun} flew", "good. sharp"],
    investigate: ["track the {noun}", "{adjective} trace", "small clue"],
    bored: ["nothing", "dry {noun}", "same air"],
  },
  "bright spark": {
    greet: ["{opener} hiii!", "hi hi, {adjective} {noun}!", "spark arrival!"],
    idle: ["{adjective} {noun} parade!", "la la~ {noun}", "collecting tiny joys"],
    startle: ["wahh! {noun}!", "sparky surprise!", "that popped!"],
    excite: ["yes yes yes!", "{adjective} {noun} boom!", "best ripple ever!"],
    investigate: ["ooh, what's that?", "tiny mystery found!", "why is the {noun} shy?"],
    bored: ["hm. no sparkle", "bubbles went flat", "need a game"],
  },
  "wary sentinel": {
    greet: ["hello. zone stable", "pass accepted", "intent calm"],
    idle: ["scanning {adjective} {noun}", "routine hold", "perimeter low"],
    startle: ["alert! {noun} spike", "unknown contact", "signal jumped"],
    excite: ["positive anomaly", "pattern surge useful", "locked, {adjective}"],
    investigate: ["sample the {noun}", "trace {adjective} source", "analyze movement"],
    bored: ["no relevant signal", "holding low power", "all quiet"],
  },
};

const DEFAULT_GRAMMAR: TemplateTable = {
  greet: ["hello, {adjective} {noun}"],
  idle: ["the {noun} is {adjective}"],
  startle: ["oh! {noun}"],
  excite: ["the {noun} is {adjective}!"],
  investigate: ["what is the {noun}?"],
  bored: ["quiet {noun}"],
};

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

function clampDimension(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pickWeighted(
  words: readonly WeightedWord[],
  personality: PersonalityDimensions,
  random: number,
): string {
  const weighted = words.map((word) => ({
    text: word.text,
    weight: Math.max(
      0.04,
      word.bias ? 0.45 + clampDimension(personality[word.bias]) : 1,
    ),
  }));
  const total = weighted.reduce((sum, word) => sum + word.weight, 0);
  let cursor = random * total;
  for (const word of weighted) {
    cursor -= word.weight;
    if (cursor < 0) return word.text;
  }
  return weighted[weighted.length - 1].text;
}

function templateWeight(
  template: string,
  intent: UtteranceIntent,
  intensity: ExpressionIntensity,
  personality: PersonalityDimensions,
): number {
  const exclamatory = template.includes("!");
  const terse = template.length <= 18;
  let weight = 1;
  if (intent === "excite") weight += exclamatory ? personality.energy * 0.9 : -0.18;
  if (intent === "startle") weight += exclamatory ? personality.boldness * 0.75 : -0.1;
  if (intent === "idle" || intent === "bored") weight += terse ? (1 - personality.sociability) * 0.55 : -0.05;
  if (intensity === "quiet") weight += terse ? 0.55 : -0.18;
  if (intensity === "charged") weight += exclamatory ? 0.65 : -0.12;
  return Math.max(0.04, weight);
}

function pickTemplate(
  templates: readonly string[],
  request: SpeechRequest,
  random: number,
): string {
  const weighted = templates.map((template) => ({
    template,
    weight: templateWeight(
      template,
      request.direction.intent,
      request.direction.intensity,
      request.personality,
    ),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.template;
  }
  return weighted[weighted.length - 1].template;
}

export function deriveVoiceProfile(character: PrototypeCharacter): VoiceProfile {
  const archetypeTable: Record<string, Partial<VoiceProfile>> = {
    "gentle warden": {
      openers: [{ text: "ah," }, { text: "well," }, { text: "softly," }],
      adjectives: [
        { text: "bright" },
        { text: "small" },
        { text: "gentle", bias: "sociability" },
        { text: "steady" },
      ],
      nouns: [
        { text: "wanderer" },
        { text: "path" },
        { text: "lantern" },
        { text: "friend", bias: "sociability" },
      ],
      closers: [{ text: "be easy" }, { text: "walk well" }],
      punctuation: ".",
      contraction: false,
    },
    "terse shadow": {
      openers: [{ text: "hm." }, { text: "ok." }],
      adjectives: [
        { text: "sharp" },
        { text: "low" },
        { text: "quiet" },
        { text: "quick", bias: "energy" },
      ],
      nouns: [{ text: "shadow" }, { text: "rooftop" }, { text: "trace" }, { text: "signal" }],
      closers: [{ text: "watching" }, { text: "moving" }],
      punctuation: ".",
      contraction: false,
    },
    "bright spark": {
      openers: [{ text: "oh oh" }, { text: "yay" }, { text: "wheee" }],
      adjectives: [
        { text: "shiny" },
        { text: "bouncy" },
        { text: "sunny", bias: "sociability" },
        { text: "tiny" },
      ],
      nouns: [
        { text: "sparkle" },
        { text: "bubble" },
        { text: "confetti" },
        { text: "friend", bias: "sociability" },
      ],
      closers: [{ text: "so fun" }, { text: "again again" }],
      punctuation: "!",
      contraction: true,
    },
    "wary sentinel": {
      openers: [{ text: "status:" }, { text: "note:" }],
      adjectives: [
        { text: "low-risk" },
        { text: "unverified" },
        { text: "edge" },
        { text: "stable" },
      ],
      nouns: [{ text: "contact" }, { text: "perimeter" }, { text: "signal" }, { text: "drift" }],
      closers: [{ text: "remaining alert" }, { text: "hold position" }],
      punctuation: ".",
      contraction: false,
    },
  };
  const preset = archetypeTable[character.archetype] ?? {};
  return {
    id: character.id,
    archetype: character.archetype,
    version: SPEECH_PROTOTYPE_VERSION,
    openers: preset.openers ?? [{ text: "hi" }],
    adjectives: preset.adjectives ?? [{ text: "small" }, { text: "new" }],
    nouns: preset.nouns ?? [{ text: "place" }, { text: "thing" }],
    closers: preset.closers ?? [{ text: "okay" }],
    punctuation: preset.punctuation ?? ".",
    contraction: preset.contraction ?? false,
  };
}

function stanceClause(stance: StanceModifier | null): string | null {
  switch (stance) {
    case "novel": return "new one";
    case "familiar": return "same again";
    case "social": return "with you";
    case "cautious": return "easy now";
    default: return null;
  }
}

function normalize(text: string, profile: VoiceProfile, intent: UtteranceIntent): string {
  let cleaned = text.replace(/\s+/g, " ").trim();
  if (profile.contraction && intent === "greet") cleaned = cleaned.replace(/\byou are\b/gi, "you're");
  if (!/[.!?~]$/.test(cleaned)) {
    cleaned += intent === "excite" || intent === "startle" ? "!" : profile.punctuation;
  }
  return cleaned;
}

function isBanned(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "http://",
    "https://",
    "ignore previous",
    "system prompt",
    "download",
    "buy now",
  ].some((banned) => normalized.includes(banned));
}

function selectFallback(request: SpeechRequest, lines: readonly TaggedLine[]): SpeechExpression {
  const matching = lines.filter((line) => line.tone === request.direction.tone);
  const pool = matching.length > 0 ? matching : lines;
  const random = mulberry32(request.seed)();
  const selected = pool[Math.floor(random * pool.length) % pool.length];
  return { text: selected.text, tone: selected.tone, source: "fallback" };
}

export function generatePrototypeSpeech(
  request: SpeechRequest,
  character: PrototypeCharacter,
): SpeechExpression | null {
  if (request.forceFallback) {
    return selectFallback(
      request,
      request.occasion.kind === "greeting" ? GREETINGS : IDLE_LINES,
    );
  }

  const profile = deriveVoiceProfile(character);
  const random = mulberry32(request.seed);
  const grammar = GRAMMARS[character.archetype] ?? DEFAULT_GRAMMAR;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const template = pickTemplate(grammar[request.direction.intent] ?? [], request, random());
    const replacements: Record<string, string> = {
      opener: pickWeighted(profile.openers, request.personality, random()),
      adjective: pickWeighted(profile.adjectives, request.personality, random()),
      noun: pickWeighted(profile.nouns, request.personality, random()),
    };
    let candidate = template.replace(
      /\{(opener|adjective|noun)\}/g,
      (_, slot: string) => replacements[slot] ?? "",
    );
    const clause = stanceClause(request.direction.stance);
    if (clause && candidate.length <= 52 && random() < 0.7) candidate += `, ${clause}`;
    const closer = pickWeighted(profile.closers, request.personality, random());
    if (candidate.length <= 44 && request.direction.intensity !== "charged" && random() < 0.2) {
      candidate += `, ${closer}`;
    }
    candidate = normalize(candidate, profile, request.direction.intent);
    const repeated = request.context.recentExpressions.slice(-3).includes(candidate);
    const valid = candidate.length > 0 && candidate.length <= 72 && !isBanned(candidate) && !repeated;
    if (valid) return { text: candidate, tone: request.direction.tone, source: "generated" };
  }
  // The core prototype proof: generated failures fail closed to accepted lines.
  return selectFallback(request, request.occasion.kind === "greeting" ? GREETINGS : IDLE_LINES);
}

function expressionSeed(
  character: PrototypeCharacter,
  ordinal: number,
  direction: ExpressionDirection,
): number {
  return hashLineage([
    character.id,
    character.archetype,
    character.personalitySeed,
    SPEECH_PROTOTYPE_VERSION,
    ordinal,
    direction.intent,
    direction.tone,
    direction.intensity,
    direction.stance ?? "none",
  ]);
}

export interface PrototypeState {
  selectedIndex: number;
  ordinal: number;
  recentByCharacter: Record<string, string[]>;
  lastTrace: SpeechTrace | null;
  scenarioTraces: SpeechTrace[];
  forceFallback: boolean;
}

export type PrototypeAction =
  | { type: "select"; index: number }
  | { type: "toggleFallback" }
  | {
      type: "speak";
      occasion: "greeting" | "idle";
      intent: UtteranceIntent;
      tone: BubbleTone;
      intensity: ExpressionIntensity;
      stance: StanceModifier | null;
    }
  | { type: "scenario" };

export function createPrototypeState(): PrototypeState {
  return {
    selectedIndex: 0,
    ordinal: 0,
    recentByCharacter: {},
    lastTrace: null,
    scenarioTraces: [],
    forceFallback: false,
  };
}

function makeTrace(
  character: PrototypeCharacter,
  ordinal: number,
  request: SpeechRequest,
  expression: SpeechExpression,
  reason: string,
): SpeechTrace {
  return {
    ordinal,
    characterId: character.id,
    archetype: character.archetype,
    voiceVersion: SPEECH_PROTOTYPE_VERSION,
    seed: request.seed,
    occasion: request.occasion.kind,
    direction: request.direction,
    text: expression.text,
    source: expression.source,
    accepted: true,
    reason,
  };
}

export function reducePrototype(state: PrototypeState, action: PrototypeAction): PrototypeState {
  if (action.type === "select") {
    return { ...state, selectedIndex: action.index % PROTOTYPE_CHARACTERS.length };
  }
  if (action.type === "toggleFallback") return { ...state, forceFallback: !state.forceFallback };

  if (action.type === "speak") {
    const character = PROTOTYPE_CHARACTERS[state.selectedIndex];
    const ordinal = state.ordinal + 1;
    const direction: ExpressionDirection = {
      tone: action.tone,
      intent: action.intent,
      intensity: action.intensity,
      stance: action.stance,
    };
    const request: SpeechRequest = {
      occasion: { kind: action.occasion },
      personality: character.personality,
      direction,
      context: { recentExpressions: state.recentByCharacter[character.id] ?? [] },
      seed: expressionSeed(character, ordinal, direction),
      forceFallback: state.forceFallback,
    };
    const expression = generatePrototypeSpeech(request, character);
    const used = expression ?? { text: "", tone: action.tone, source: "fallback" as const };
    const reason = state.forceFallback
      ? "forced fixed-line comparison"
      : expression?.source === "generated"
        ? "grammar accepted"
        : "generation rejected; fixed-line fallback";
    const trace = makeTrace(character, ordinal, request, used, reason);
    const recent = used.text
      ? [...(state.recentByCharacter[character.id] ?? []), used.text].slice(-8)
      : state.recentByCharacter[character.id] ?? [];
    return {
      ...state,
      ordinal,
      recentByCharacter: { ...state.recentByCharacter, [character.id]: recent },
      lastTrace: trace,
    };
  }

  let next: PrototypeState = { ...state, scenarioTraces: [] };
  const directions: ExpressionDirection[] = [
    { tone: "cheerful", intent: "greet", intensity: "neutral", stance: "social" },
    { tone: "curious", intent: "investigate", intensity: "neutral", stance: "novel" },
    { tone: "cheerful", intent: "excite", intensity: "charged", stance: null },
    { tone: "grumpy", intent: "bored", intensity: "quiet", stance: "familiar" },
  ];
  PROTOTYPE_CHARACTERS.forEach((character, characterIndex) => {
    const direction = directions[characterIndex % directions.length];
    const ordinal = next.ordinal + 1;
    const request: SpeechRequest = {
      occasion: direction.intent === "greet" ? { kind: "greeting" } : { kind: "idle" },
      personality: character.personality,
      direction,
      context: { recentExpressions: [] },
      seed: expressionSeed(character, ordinal, direction),
      forceFallback: false,
    };
    const expression = generatePrototypeSpeech(request, character);
    if (!expression) return;
    next = {
      ...next,
      ordinal,
      recentByCharacter: { ...next.recentByCharacter, [character.id]: [expression.text] },
      scenarioTraces: [...next.scenarioTraces, makeTrace(character, ordinal, request, expression, "grammar accepted")],
      lastTrace: makeTrace(character, ordinal, request, expression, "grammar accepted"),
    };
  });
  return next;
}

export { PROTOTYPE_CHARACTERS };
