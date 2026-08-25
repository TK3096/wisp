export type ReactionKind = "curiosity" | "startle" | "boredom" | "excitement";
export type Reaction = ReactionKind | "none";
export type StimulusKind = "strongGesture" | "weakGesture" | "appFocus" | "appBlur";
export type ProfileName = "balanced" | "cautious" | "social";

export interface PersonalityDimensions {
  energy: number;
  curiosity: number;
  boldness: number;
  sociability: number;
}

export interface Affect {
  surprise: number;
  valence: number;
  arousal: number;
}

export interface ActiveReaction {
  kind: ReactionKind;
  score: number;
  remainingS: number;
}

export interface Candidate {
  kind: ReactionKind;
  score: number;
  threshold: number;
  eligible: boolean;
}

export interface CognitionState {
  clockS: number;
  profile: ProfileName;
  personality: PersonalityDimensions;
  pending: StimulusKind[];
  fast: [number, number, number, number];
  slow: [number, number, number, number];
  derivative: [number, number, number, number];
  belief: [number, number, number, number];
  stimulusCount: number;
  lastStimulus: StimulusKind | null;
  lastStimulusAtS: number | null;
  affect: Affect;
  boredom: number;
  reaction: ActiveReaction | null;
  reactionLockS: number;
  nextEligibleS: Record<ReactionKind, number>;
  history: string[];
}

export interface BehaviorState {
  mode: "idle" | "walk";
  modeTimerS: number;
  airborneS: number | null;
  jumpRollS: number;
  bubbleRollS: number;
  bubbleCooldownS: number;
  activeBubbleS: number;
  lastExpression: string;
  lastBubble: string;
}

export interface ReactionBias {
  idleDwell: number;
  walkSpeed: number;
  jumpChance: number;
  bubbleChance: number;
  animationPace: number;
}

export const PROFILE_ORDER: ProfileName[] = ["balanced", "cautious", "social"];

export const PROFILES: Record<ProfileName, PersonalityDimensions> = {
  balanced: { energy: 0.55, curiosity: 0.6, boldness: 0.5, sociability: 0.55 },
  cautious: { energy: 0.35, curiosity: 0.45, boldness: 0.2, sociability: 0.4 },
  social: { energy: 0.8, curiosity: 0.7, boldness: 0.75, sociability: 0.85 },
};

export const COGNITION_DT_S = 0.1;

export const CONFIG = {
  derivative: {
    alphaFast: 0.3,
    alphaSlow: 0.03,
    beta: 4,
  },
  belief: {
    learningRate: 0.25,
    maxDelta: 0.2,
    decayTauS: 60,
  },
  affect: {
    surpriseDecayTauS: 0.65,
    arousalRiseTauS: 0.35,
    arousalDecayTauS: 3,
    valenceTauS: 4.5,
  },
  boredom: {
    buildS: 12,
    recoverS: 2.5,
    threshold: 0.75,
  },
  reaction: {
    durationS: { curiosity: 3, startle: 0.8, boredom: 4, excitement: 2 },
    gapS: { curiosity: 3, startle: 4, boredom: 12, excitement: 5 },
    lockS: 0.6,
    threshold: { curiosity: 0.35, startle: 0.58, boredom: 0.75, excitement: 0.62 },
  },
};

const REACTION_BIAS: Record<ReactionKind, ReactionBias> = {
  curiosity: { idleDwell: 0.65, walkSpeed: 1.15, jumpChance: 1.25, bubbleChance: 1.4, animationPace: 1.08 },
  startle: { idleDwell: 1.15, walkSpeed: 0.85, jumpChance: 2.2, bubbleChance: 1.3, animationPace: 1.18 },
  boredom: { idleDwell: 0.75, walkSpeed: 0.9, jumpChance: 0.55, bubbleChance: 1.2, animationPace: 0.88 },
  excitement: { idleDwell: 0.5, walkSpeed: 1.25, jumpChance: 1.8, bubbleChance: 1.5, animationPace: 1.2 },
};

const NEUTRAL_BIAS: ReactionBias = {
  idleDwell: 1,
  walkSpeed: 1,
  jumpChance: 1,
  bubbleChance: 1,
  animationPace: 1,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function decay(value: number, dtS: number, tauS: number): number {
  return value * Math.exp(-dtS / tauS);
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

export function createState(profile: ProfileName = "balanced"): CognitionState {
  return {
    clockS: 0,
    profile,
    personality: { ...PROFILES[profile] },
    pending: [],
    fast: [0, 0, 0, 0],
    slow: [0, 0, 0, 0],
    derivative: [0, 0, 0, 0],
    belief: [0, 0, 0, 0],
    stimulusCount: 0,
    lastStimulus: null,
    lastStimulusAtS: null,
    affect: { surprise: 0, valence: 0, arousal: 0 },
    boredom: 0,
    reaction: null,
    reactionLockS: 0,
    nextEligibleS: { curiosity: 0, startle: 0, boredom: 0, excitement: 0 },
    history: ["materialized"],
  };
}

export function createBehavior(): BehaviorState {
  return {
    mode: "idle",
    modeTimerS: 1.5,
    airborneS: null,
    jumpRollS: 1.8,
    bubbleRollS: 2.5,
    bubbleCooldownS: 0,
    activeBubbleS: 0,
    lastExpression: "idle",
    lastBubble: "none",
  };
}

export function observe(state: CognitionState, stimulus: StimulusKind): void {
  state.pending.push(stimulus);
}

function stimulusFeature(stimulus: StimulusKind, previousCount: number): [number, number, number, number] {
  switch (stimulus) {
    case "strongGesture": {
      const habit = clamp(previousCount / 3);
      const novelty = 0.8 * (1 - habit) ** 2;
      return [novelty, 0.22 + 0.58 * habit, 0.04 * habit, 0.06 * (1 - habit)];
    }
    case "weakGesture":
      return [0.68, 0.28, 0.08, 0.28];
    case "appFocus":
      return [0.16, 0.08, 0.7, 0];
    case "appBlur":
      return [0.45, 0, 0.1, 0.85];
  }
}

function observeDerivative(state: CognitionState, feature: readonly number[]): void {
  const { alphaFast, alphaSlow } = CONFIG.derivative;
  for (let i = 0; i < feature.length; i++) {
    state.fast[i] = (1 - alphaFast) * state.fast[i] + alphaFast * feature[i];
    state.slow[i] = (1 - alphaSlow) * state.slow[i] + alphaSlow * feature[i];
    state.derivative[i] = state.fast[i] - state.slow[i];
  }
}

function leakyStep(state: CognitionState, input: readonly number[]): void {
  const total = input.reduce((sum, value) => sum + value, 0);
  if (total < 1e-8) return;

  const { learningRate, maxDelta } = CONFIG.belief;
  const scale = (learningRate * Math.min(total, 1)) / total;
  const halfTotal = 0.5 * total;
  for (let i = 0; i < state.belief.length; i++) {
    const delta = clamp(scale * (input[i] - halfTotal), -maxDelta, maxDelta);
    state.belief[i] = clamp(state.belief[i] + delta, -1, 1);
  }
}

export function derivativeNorm(state: CognitionState): number {
  const sumSquares = state.derivative.reduce((sum, value) => sum + value * value, 0);
  return Math.sqrt(sumSquares);
}

export function surpriseGate(state: CognitionState): number {
  return sigmoid(CONFIG.derivative.beta * derivativeNorm(state));
}

/** Map the sigmoid gate's neutral 0.5 resting value to zero affect. */
export function surpriseEnergy(state: CognitionState): number {
  return clamp((surpriseGate(state) - 0.5) * 2.6);
}

export interface BeliefProjection {
  novelty: number;
  familiarity: number;
  social: number;
  caution: number;
}

export function projectBelief(state: CognitionState): BeliefProjection {
  const [change, social, habit, caution] = state.belief;
  return {
    novelty: clamp(change),
    familiarity: clamp(habit + 0.7 * social - 0.35 * change),
    social: clamp(social),
    caution: clamp(caution),
  };
}

function affectTarget(state: CognitionState, surprise: number): { valence: number; arousal: number } {
  const belief = projectBelief(state);
  return {
    valence: clamp(0.55 * belief.social + 0.25 * belief.familiarity - 0.7 * belief.caution - 0.08 * belief.novelty, -1, 1),
    arousal: clamp(Math.max(surprise, 0.65 * belief.social, 0.75 * belief.caution, 0.25 * belief.novelty)),
  };
}

export function candidates(state: CognitionState): Candidate[] {
  const belief = projectBelief(state);
  const p = state.personality;
  const scores: Record<ReactionKind, number> = {
    startle: clamp(0.8 * state.affect.surprise + 0.5 * belief.caution + 0.1 * (1 - p.boldness) - 0.28 * belief.familiarity),
    excitement: clamp(0.55 * belief.social + 0.25 * belief.familiarity + 0.35 * state.affect.surprise + 0.15 * p.energy + 0.2 * Math.max(state.affect.valence, 0)),
    curiosity: clamp(0.45 * state.affect.surprise + 0.5 * belief.novelty + 0.15 * p.curiosity - 0.2 * belief.familiarity),
    boredom: clamp(state.boredom * 0.8 + 0.1 * belief.familiarity + 0.1 * (1 - state.affect.arousal) - 0.35 * state.affect.surprise),
  };
  return (Object.keys(scores) as ReactionKind[]).map((kind) => ({
    kind,
    score: scores[kind],
    threshold: CONFIG.reaction.threshold[kind],
    eligible:
      state.clockS >= state.nextEligibleS[kind] &&
      scores[kind] >= CONFIG.reaction.threshold[kind],
  }));
}

function pushHistory(state: CognitionState, entry: string): void {
  state.history.push(entry);
  if (state.history.length > 5) state.history.shift();
}

function selectReaction(state: CognitionState, hadStimulus: boolean): void {
  if (state.reaction !== null || state.reactionLockS > 0) return;

  const eligible = candidates(state)
    .filter((candidate) => candidate.eligible)
    .filter((candidate) => (candidate.kind === "boredom" ? !hadStimulus : hadStimulus));

  const priority: ReactionKind[] = ["startle", "excitement", "curiosity", "boredom"];
  const winner = priority
    .map((kind) => eligible.find((candidate) => candidate.kind === kind))
    .find((candidate): candidate is Candidate => candidate !== undefined);
  if (!winner) return;

  const duration = CONFIG.reaction.durationS[winner.kind];
  state.reaction = {
    kind: winner.kind,
    score: winner.score,
    remainingS: duration,
  };
  state.nextEligibleS[winner.kind] = state.clockS + duration + CONFIG.reaction.gapS[winner.kind];
  if (winner.kind === "boredom") state.boredom = 0.2;
  pushHistory(state, `${winner.kind} ${winner.score.toFixed(2)}`);
}

export function tick(state: CognitionState): void {
  const dt = COGNITION_DT_S;
  state.clockS += dt;
  state.reactionLockS = Math.max(0, state.reactionLockS - dt);

  const stimulus = state.pending.shift() ?? null;
  const hadStimulus = stimulus !== null;
  const feature = stimulus === null ? [0, 0, 0, 0] : stimulusFeature(stimulus, state.stimulusCount);

  observeDerivative(state, feature);
  if (hadStimulus) {
    leakyStep(state, feature);
    state.stimulusCount += 1;
    state.lastStimulus = stimulus;
    state.lastStimulusAtS = state.clockS;
    pushHistory(state, `observe ${stimulus}`);
  }

  const beliefDecay = Math.exp(-dt / CONFIG.belief.decayTauS);
  for (let i = 0; i < state.belief.length; i++) state.belief[i] *= beliefDecay;

  const surprise = surpriseEnergy(state);
  state.affect.surprise = Math.max(decay(state.affect.surprise, dt, CONFIG.affect.surpriseDecayTauS), surprise);

  const target = affectTarget(state, surprise);
  const valenceTowards = 1 - Math.exp(-dt / CONFIG.affect.valenceTauS);
  state.affect.valence += (target.valence - state.affect.valence) * valenceTowards;
  state.affect.arousal = target.arousal > state.affect.arousal
    ? state.affect.arousal + (target.arousal - state.affect.arousal) * (1 - Math.exp(-dt / CONFIG.affect.arousalRiseTauS))
    : decay(state.affect.arousal, dt, CONFIG.affect.arousalDecayTauS);

  const quiet = !hadStimulus && surprise < 0.1 && state.affect.arousal < 0.25;
  if (quiet) {
    state.boredom = clamp(state.boredom + dt / CONFIG.boredom.buildS);
  } else {
    state.boredom = clamp(state.boredom - dt / CONFIG.boredom.recoverS);
  }

  if (state.reaction !== null) {
    state.reaction.remainingS -= dt;
    if (state.reaction.remainingS <= 0) {
      state.reactionLockS = CONFIG.reaction.lockS;
      state.reaction = null;
    }
  } else {
    selectReaction(state, hadStimulus);
  }
}

export function activeReaction(state: CognitionState): Reaction {
  return state.reaction?.kind ?? "none";
}

export function behaviorBias(state: CognitionState): ReactionBias {
  return state.reaction === null ? NEUTRAL_BIAS : REACTION_BIAS[state.reaction.kind];
}

function reactionBubble(kind: Reaction): string {
  switch (kind) {
    case "curiosity":
      return "hmm?";
    case "startle":
      return "!";
    case "boredom":
      return "...";
    case "excitement":
      return "!!";
    case "none":
      return "hi";
  }
}

export function tickBehavior(
  state: CognitionState,
  behavior: BehaviorState,
  rng: () => number,
): void {
  const dt = COGNITION_DT_S;
  const bias = behaviorBias(state);

  behavior.modeTimerS -= dt;
  if (behavior.modeTimerS <= 0) {
    if (behavior.mode === "idle") {
      behavior.mode = "walk";
      behavior.modeTimerS = 1.2 + rng() * 0.8;
      behavior.lastExpression = "walk";
    } else {
      behavior.mode = "idle";
      behavior.modeTimerS = (1.2 + rng() * 0.8) * bias.idleDwell;
    }
  }

  behavior.jumpRollS -= dt;
  if (behavior.jumpRollS <= 0) {
    behavior.jumpRollS = 1.6 + rng() * 0.8;
    if (behavior.airborneS === null && rng() < 0.12 * bias.jumpChance) {
      behavior.airborneS = 0.5;
      behavior.lastExpression = "jump";
    }
  }

  if (behavior.airborneS !== null) {
    behavior.airborneS -= dt;
    if (behavior.airborneS <= 0) behavior.airborneS = null;
  }

  behavior.bubbleCooldownS = Math.max(0, behavior.bubbleCooldownS - dt);
  if (behavior.activeBubbleS > 0) behavior.activeBubbleS -= dt;
  behavior.bubbleRollS -= dt;
  if (behavior.bubbleRollS <= 0) {
    behavior.bubbleRollS = 2.2 + rng() * 0.8;
    if (behavior.bubbleCooldownS === 0 && behavior.activeBubbleS === 0 && rng() < 0.25 * bias.bubbleChance) {
      behavior.lastBubble = reactionBubble(activeReaction(state));
      behavior.activeBubbleS = 1.8;
      behavior.bubbleCooldownS = 3;
      behavior.lastExpression = "bubble";
    }
  }
}

export function behaviorRng(seed: number): () => number {
  return mulberry32(seed);
}
