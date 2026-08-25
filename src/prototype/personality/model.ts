export type ArchetypeName =
  | "mask-dude"
  | "ninja-frog"
  | "pink-man"
  | "virtual-guy";

export const ARCHETYPE_ORDER: ArchetypeName[] = [
  "mask-dude",
  "ninja-frog",
  "pink-man",
  "virtual-guy",
];

export interface PersonalityDimensions {
  energy: number;
  curiosity: number;
  boldness: number;
  sociability: number;
}

export interface Affect {
  valence: number;
  arousal: number;
  surprise: number;
}

export type BubbleTone = "calm" | "curious" | "playful" | "social" | "startled";
export type ExpressionKind = "jump" | "walk" | "bubble";

export interface PersonalityState {
  archetype: ArchetypeName;
  seed: number;
  baseDimensions: PersonalityDimensions;
  drift: PersonalityDimensions;
  affect: Affect;
  baselineArousal: number;
  clock: number;
  lastExpression: ExpressionKind | null;
  lastExpressionAt: number | null;
  lastBubble: { text: string; tone: BubbleTone };
}

export interface BehaviorProjection {
  idleDwellRange: { min: number; max: number };
  walkSpeed: number;
  jumpChanceAtRoll: number;
  bubbleChanceAtRoll: number;
  animationPace: number;
  animationTone: string;
}

export interface BehaviorBiasProjection {
  idleDwell: number;
  walkSpeed: number;
  jumpChance: number;
  bubbleChance: number;
  animationPace: number;
}

export interface RewardKind {
  kind: "delight" | "dismiss";
}

const ARCHETYPE_BASES: Record<ArchetypeName, PersonalityDimensions> = {
  "mask-dude": { energy: 0.58, curiosity: 0.62, boldness: 0.55, sociability: 0.45 },
  "ninja-frog": { energy: 0.7, curiosity: 0.55, boldness: 0.75, sociability: 0.35 },
  "pink-man": { energy: 0.48, curiosity: 0.45, boldness: 0.35, sociability: 0.75 },
  "virtual-guy": { energy: 0.62, curiosity: 0.72, boldness: 0.48, sociability: 0.62 },
};

const LINES: Array<{ text: string; tone: BubbleTone }> = [
  { text: "zzz", tone: "calm" },
  { text: "*yawns*", tone: "calm" },
  { text: "hmm", tone: "curious" },
  { text: "...", tone: "curious" },
  { text: "where am I?", tone: "curious" },
  { text: "*looks around*", tone: "curious" },
  { text: "what's up?", tone: "social" },
  { text: "la la la", tone: "playful" },
  { text: "😂", tone: "playful" },
  { text: "🤪", tone: "playful" },
  { text: "hi!", tone: "social" },
  { text: "*waves*", tone: "social" },
  { text: "😱", tone: "startled" },
];

export const BASE = {
  idleDwellMin: 1.5,
  idleDwellMax: 4.0,
  walkSpeed: 80,
  idleFps: 8,
  walkFps: 10,
  rollChance: 0.45,
};

export const REWARD = {
  creditWindowS: 5,
  step: 0.015,
  maxDrift: 0.15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPersonality(archetype: ArchetypeName, seed: number): PersonalityState {
  const base = ARCHETYPE_BASES[archetype];
  const random = mulberry32(seed);
  const jitter = () => clamp((random() - 0.5) * 0.24, -0.12, 0.12);
  const baseDimensions = {
    energy: clamp(base.energy + jitter(), 0, 1),
    curiosity: clamp(base.curiosity + jitter(), 0, 1),
    boldness: clamp(base.boldness + jitter(), 0, 1),
    sociability: clamp(base.sociability + jitter(), 0, 1),
  };
  const baselineArousal = 0.2 + 0.35 * baseDimensions.energy;
  const state: PersonalityState = {
    archetype,
    seed,
    baseDimensions,
    drift: { energy: 0, curiosity: 0, boldness: 0, sociability: 0 },
    affect: { valence: 0, arousal: baselineArousal, surprise: 0 },
    baselineArousal,
    clock: 0,
    lastExpression: null,
    lastExpressionAt: null,
    lastBubble: { text: "(none)", tone: "curious" },
  };
  state.lastBubble = chooseBubble(state, random);
  return state;
}

export function observeOpenPalm(state: PersonalityState, confidence: number): void {
  const bounded = clamp(confidence, 0, 1);
  const sociability = effectiveDimensions(state).sociability;
  state.affect.surprise = Math.max(state.affect.surprise, 0.4 + 0.5 * bounded);
  state.affect.valence = clamp(
    state.affect.valence + 0.12 * bounded * (0.4 + sociability),
    -1,
    1,
  );
  state.affect.arousal = clamp(state.affect.arousal + 0.18 * bounded, 0, 1);
}

export function advance(state: PersonalityState, dt: number): void {
  state.clock += clamp(dt, 0, 1);
  const decay = Math.exp(-clamp(dt, 0, 1) / 4);
  state.affect.valence *= decay;
  state.affect.surprise *= decay;
  state.affect.arousal =
    state.baselineArousal + (state.affect.arousal - state.baselineArousal) * decay;
}

export function bubbleWeights(state: PersonalityState): Array<{
  tone: BubbleTone;
  weight: number;
}> {
  const d = effectiveDimensions(state);
  const a = state.affect;
  const raw = {
    calm: 0.3 + 0.7 * (1 - d.energy) * (1 - a.arousal),
    curious: 0.3 + 0.7 * d.curiosity,
    playful: 0.25 + 0.75 * d.boldness * d.energy,
    social: 0.25 + 0.75 * d.sociability * (1 + Math.max(0, a.valence)),
    startled: 0.05 + 0.95 * a.surprise,
  };
  return (Object.keys(raw) as BubbleTone[]).map((tone) => ({ tone, weight: raw[tone] }));
}

export function chooseBubble(
  state: PersonalityState,
  random: () => number,
): { text: string; tone: BubbleTone } {
  const byTone = new Map<BubbleTone, number>();
  for (const entry of bubbleWeights(state)) byTone.set(entry.tone, entry.weight);
  const weighted = LINES.map((line) => ({ line, weight: byTone.get(line.tone) ?? 0 }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = random() * total;
  for (const entry of weighted) {
    pick -= entry.weight;
    if (pick <= 0) return entry.line;
  }
  return weighted[weighted.length - 1].line;
}

export function markExpression(state: PersonalityState, kind: ExpressionKind): void {
  state.lastExpression = kind;
  state.lastExpressionAt = state.clock;
  if (kind === "bubble") {
    state.lastBubble = chooseBubble(state, mulberry32(state.seed + Math.floor(state.affect.arousal * 1000)));
  }
}

export function applyReward(state: PersonalityState, reward: RewardKind): void {
  const positive = reward.kind === "delight";
  state.affect.valence = clamp(state.affect.valence + (positive ? 0.45 : -0.45), -1, 1);
  state.affect.arousal = clamp(state.affect.arousal + (positive ? 0.16 : 0.05), 0, 1);

  const withinCreditWindow =
    state.lastExpressionAt !== null &&
    state.clock - state.lastExpressionAt <= REWARD.creditWindowS;
  if (withinCreditWindow) {
    for (const credit of creditsFor(state)) {
      const magnitude = REWARD.step * credit.direction * (positive ? 1 : -1);
      state.drift[credit.dimension] = clamp(
        state.drift[credit.dimension] + magnitude,
        -REWARD.maxDrift,
        REWARD.maxDrift,
      );
    }
    state.baselineArousal = 0.2 + 0.35 * effectiveDimensions(state).energy;
  }
}

export function projectBehavior(state: PersonalityState): BehaviorProjection {
  const d = effectiveDimensions(state);
  const a = state.affect;
  const energyDrive = clamp(0.65 * d.energy + 0.35 * a.arousal, 0, 1);
  const idleDwell = clamp(
    1.42 - 0.68 * energyDrive - 0.18 * d.curiosity,
    0.55,
    1.5,
  );
  const walkSpeed = clamp(
    0.8 + 0.33 * d.curiosity + 0.2 * energyDrive + 0.12 * (a.arousal - 0.5),
    0.65,
    1.25,
  );
  const jumpChance = clamp(
    0.18 + 0.52 * d.boldness + 0.22 * (a.arousal - 0.5) + 0.18 * a.surprise,
    0.05,
    0.9,
  );
  const bubbleChance = clamp(
    0.18 + 0.55 * d.sociability + 0.18 * Math.max(0, a.valence) + 0.12 * a.arousal,
    0.05,
    0.9,
  );
  const animationPace = clamp(
    0.86 + 0.2 * energyDrive + 0.14 * (a.arousal - 0.5) + 0.1 * a.surprise,
    0.75,
    1.25,
  );

  return {
    idleDwellRange: {
      min: BASE.idleDwellMin * idleDwell,
      max: BASE.idleDwellMax * idleDwell,
    },
    walkSpeed: BASE.walkSpeed * walkSpeed,
    jumpChanceAtRoll: jumpChance,
    bubbleChanceAtRoll: bubbleChance,
    animationPace,
    animationTone: animationTone(state),
  };
}

export function effectiveDimensions(state: PersonalityState): PersonalityDimensions {
  const base = state.baseDimensions;
  const drift = state.drift;
  return {
    energy: clamp(base.energy + drift.energy, 0, 1),
    curiosity: clamp(base.curiosity + drift.curiosity, 0, 1),
    boldness: clamp(base.boldness + drift.boldness, 0, 1),
    sociability: clamp(base.sociability + drift.sociability, 0, 1),
  };
}

export function behaviorBias(state: PersonalityState): BehaviorBiasProjection {
  const behavior = projectBehavior(state);
  return {
    idleDwell: behavior.idleDwellRange.min / BASE.idleDwellMin,
    walkSpeed: behavior.walkSpeed / BASE.walkSpeed,
    jumpChance: behavior.jumpChanceAtRoll / BASE.rollChance,
    bubbleChance: behavior.bubbleChanceAtRoll / BASE.rollChance,
    animationPace: behavior.animationPace,
  };
}

function animationTone(state: PersonalityState): string {
  const dimensions = effectiveDimensions(state);
  if (state.affect.surprise > 0.5) return "startled";
  if (state.affect.arousal > 0.7 && dimensions.boldness > 0.6) return "spirited";
  if (dimensions.energy < 0.42) return "settled";
  if (dimensions.curiosity > 0.65) return "exploratory";
  if (dimensions.sociability > 0.7) return "friendly";
  return "neutral";
}

function creditsFor(state: PersonalityState): Array<{
  dimension: keyof PersonalityDimensions;
  direction: 1 | -1;
}> {
  if (state.lastExpression === "jump") return [{ dimension: "boldness", direction: 1 }];
  if (state.lastExpression === "walk") return [{ dimension: "curiosity", direction: 1 }];
  if (state.lastExpression !== "bubble") return [];

  switch (state.lastBubble.tone) {
    case "social":
      return [{ dimension: "sociability", direction: 1 }];
    case "curious":
      return [{ dimension: "curiosity", direction: 1 }];
    case "playful":
      return [
        { dimension: "energy", direction: 1 },
        { dimension: "boldness", direction: 1 },
      ];
    case "calm":
      return [{ dimension: "energy", direction: -1 }];
    case "startled":
      return [];
  }
}
