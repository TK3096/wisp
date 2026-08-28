export const COGNITION_SCHEMA_VERSION = 2;
/** Cognition advances at 10 Hz, independently of the render ticker. */
export const COGNITION_CADENCE_S = 0.1;
/** A single render tick may catch up at most one second of cognition. */
export const MAX_COGNITION_CATCHUP_STEPS = 10;
/** Absorbs render-frame floating-point drift without shifting the cadence. */
export const COGNITION_CADENCE_EPSILON_S = 1e-9;

export interface CognitionInit {
  schemaVersion: typeof COGNITION_SCHEMA_VERSION;
  characterId: string;
  archetype: string;
  personalitySeed: number;
}

export type GestureName = "openPalm";
export type LifecyclePhase = "materialized" | "vanishing";
export type EnvironmentChange = "appFocus" | "appBlur";

export type Stimulus =
  | { kind: "gesture"; gesture: GestureName; confidence: number }
  | { kind: "lifecycle"; phase: LifecyclePhase }
  | { kind: "environment"; change: EnvironmentChange };

export type StimulusTarget = "all" | { characterId: string };

const ENVIRONMENT_CHANGES = new Set<EnvironmentChange>(["appFocus", "appBlur"]);

export function isEnvironmentChange(change: unknown): change is EnvironmentChange {
  return typeof change === "string" && ENVIRONMENT_CHANGES.has(change as EnvironmentChange);
}

export interface StimulusEnvelope {
  target: StimulusTarget;
  stimulus: Stimulus;
}

export interface Affect {
  surprise: number;
  valence: number;
  arousal: number;
}

/** Bounded Temporal Derivative summary emitted by every Cognition step. */
export interface TemporalSurprise {
  /** L2 norm of the current fast/slow observation difference. */
  derivativeNorm: number;
  /** Raw sigmoid gate in [0, 1]; rests at 0.5 during inactivity. */
  gate: number;
  /** Recentred gate in [0, 1]; exactly zero for neutral inactivity. */
  centeredEnergy: number;
}

/** Slow, bounded LeakyIntegrator projections emitted by every Cognition step. */
export interface MicroBeliefProjection {
  novelty: number;
  familiarity: number;
  socialPositivity: number;
  caution: number;
}

export type ReactionKind = "curiosity" | "startle" | "excitement" | "boredom";
export type Reaction = ReactionKind | "none";

export interface ReactionCandidate {
  kind: ReactionKind;
  score: number;
  threshold: number;
  eligible: boolean;
  requiresStimulus: boolean;
}

export interface ReactionSignal {
  kind: Reaction;
  score: number;
  remainingS: number;
  candidates: ReactionCandidate[];
}

export interface BehaviorBias {
  idleDwell: number;
  walkSpeed: number;
  jumpChance: number;
  bubbleChance: number;
  animationPace: number;
}

export interface BehaviorSignal {
  affect: Affect;
  temporalSurprise: TemporalSurprise;
  microBelief: MicroBeliefProjection;
  reaction: ReactionSignal;
  behaviorBias: BehaviorBias;
}

export interface PersistentCognitionState {
  schemaVersion: number;
  characterId: string;
  cognition: unknown;
}

export interface CognitionHandle {
  observe(stimulus: Stimulus): void;
  tick(dt: number): BehaviorSignal;
  snapshot(): PersistentCognitionState;
  restore(state: PersistentCognitionState): void;
}

export const NEUTRAL_BEHAVIOR_SIGNAL: BehaviorSignal = Object.freeze({
  affect: Object.freeze({
    surprise: 0,
    valence: 0,
    arousal: 0,
  }),
  temporalSurprise: Object.freeze({
    derivativeNorm: 0,
    gate: 0.5,
    centeredEnergy: 0,
  }),
  microBelief: Object.freeze({
    novelty: 0,
    familiarity: 0,
    socialPositivity: 0,
    caution: 0,
  }),
  reaction: Object.freeze({
    kind: "none",
    score: 0,
    remainingS: 0,
    candidates: Object.freeze([
      Object.freeze({
        kind: "startle",
        score: 0,
        threshold: 0.58,
        eligible: false,
        requiresStimulus: true,
      }),
      Object.freeze({
        kind: "excitement",
        score: 0,
        threshold: 0.62,
        eligible: false,
        requiresStimulus: true,
      }),
      Object.freeze({
        kind: "curiosity",
        score: 0,
        threshold: 0.35,
        eligible: false,
        requiresStimulus: true,
      }),
      Object.freeze({
        kind: "boredom",
        score: 0,
        threshold: 0.75,
        eligible: false,
        requiresStimulus: false,
      }),
    ]),
  }),
  behaviorBias: Object.freeze({
    idleDwell: 1,
    walkSpeed: 1,
    jumpChance: 1,
    bubbleChance: 1,
    animationPace: 1,
  }),
}) as BehaviorSignal;

export function createNeutralCognitionHandle(
  init: CognitionInit,
): CognitionHandle {
  return {
    observe() {
      // The neutral pass intentionally preserves existing behavior.
    },
    tick(dt) {
      if (!Number.isFinite(dt) || dt < 0) {
        throw new Error("Cognition dt must be finite and non-negative");
      }
      return NEUTRAL_BEHAVIOR_SIGNAL;
    },
    snapshot() {
      return {
        schemaVersion: COGNITION_SCHEMA_VERSION,
        characterId: init.characterId,
        cognition: null,
      };
    },
    restore(state) {
      if (state.schemaVersion !== COGNITION_SCHEMA_VERSION) {
        throw new Error("Unsupported Cognition State schema version");
      }
      if (state.characterId !== init.characterId) {
        throw new Error("Cognition State belongs to a different character");
      }
    },
  };
}

/** Deterministically specialize an individual within its archetype. */
export function derivePersonalitySeed(
  characterId: string,
  archetype: string,
): number {
  const identity = `${archetype}:${characterId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function validateBehaviorSignal(signal: BehaviorSignal): void {
  const reactionKinds = new Set<Reaction>([
    "none",
    "curiosity",
    "startle",
    "excitement",
    "boredom",
  ]);
  const candidateKinds = new Set<ReactionKind>([
    "curiosity",
    "startle",
    "excitement",
    "boredom",
  ]);
  const boundedValues: { name: string; value: number; min: number; max: number }[] = [
    { name: "affect.surprise", value: signal.affect.surprise, min: 0, max: 1 },
    { name: "affect.valence", value: signal.affect.valence, min: -1, max: 1 },
    { name: "affect.arousal", value: signal.affect.arousal, min: 0, max: 1 },
    {
      name: "temporalSurprise.derivativeNorm",
      value: signal.temporalSurprise.derivativeNorm,
      min: 0,
      max: 4,
    },
    { name: "temporalSurprise.gate", value: signal.temporalSurprise.gate, min: 0, max: 1 },
    {
      name: "temporalSurprise.centeredEnergy",
      value: signal.temporalSurprise.centeredEnergy,
      min: 0,
      max: 1,
    },
    { name: "microBelief.novelty", value: signal.microBelief.novelty, min: 0, max: 1 },
    {
      name: "microBelief.familiarity",
      value: signal.microBelief.familiarity,
      min: 0,
      max: 1,
    },
    {
      name: "microBelief.socialPositivity",
      value: signal.microBelief.socialPositivity,
      min: 0,
      max: 1,
    },
    { name: "microBelief.caution", value: signal.microBelief.caution, min: 0, max: 1 },
    { name: "reaction.score", value: signal.reaction.score, min: 0, max: 1 },
    { name: "reaction.remainingS", value: signal.reaction.remainingS, min: 0, max: 4 },
    { name: "behaviorBias.idleDwell", value: signal.behaviorBias.idleDwell, min: 0, max: 2 },
    { name: "behaviorBias.walkSpeed", value: signal.behaviorBias.walkSpeed, min: 0, max: 2 },
    { name: "behaviorBias.jumpChance", value: signal.behaviorBias.jumpChance, min: 0, max: 2 },
    { name: "behaviorBias.bubbleChance", value: signal.behaviorBias.bubbleChance, min: 0, max: 2 },
    {
      name: "behaviorBias.animationPace",
      value: signal.behaviorBias.animationPace,
      min: 0.75,
      max: 1.25,
    },
  ];

  if (!reactionKinds.has(signal.reaction.kind)) {
    throw new Error("reaction.kind must be a recognized reaction");
  }
  if (signal.reaction.candidates.length !== 4) {
    throw new Error("reaction.candidates must contain exactly four scored candidates");
  }
  for (const [index, candidate] of signal.reaction.candidates.entries()) {
    if (!candidateKinds.has(candidate.kind)) {
      throw new Error(`reaction.candidates[${index}].kind is invalid`);
    }
    if (
      !Number.isFinite(candidate.score) ||
      candidate.score < 0 ||
      candidate.score > 1 ||
      !Number.isFinite(candidate.threshold) ||
      candidate.threshold <= 0 ||
      candidate.threshold > 1
    ) {
      throw new Error(
        `reaction.candidates[${index}].score and threshold must be finite and within (0, 1]`,
      );
    }
  }

  for (const { name, value, min, max } of boundedValues) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} must be finite and within [${min}, ${max}]`);
    }
  }
}

export function validateStimulusEnvelope(envelope: StimulusEnvelope): void {
  const invalid = () => new Error("Stimulus Envelope is invalid");
  if (!envelope || typeof envelope !== "object") throw invalid();

  const { target, stimulus } = envelope;
  if (
    target !== "all" &&
    (typeof target !== "object" ||
      target === null ||
      typeof target.characterId !== "string" ||
      target.characterId === "")
  ) {
    throw invalid();
  }
  if (!stimulus || typeof stimulus !== "object") throw invalid();

  switch (stimulus.kind) {
    case "gesture":
      if (
        stimulus.gesture !== "openPalm" ||
        !Number.isFinite(stimulus.confidence) ||
        stimulus.confidence < 0 ||
        stimulus.confidence > 1
      ) {
        throw invalid();
      }
      break;
    case "lifecycle":
      if (stimulus.phase !== "materialized" && stimulus.phase !== "vanishing") {
        throw invalid();
      }
      break;
    case "environment":
      if (!isEnvironmentChange(stimulus.change)) {
        throw invalid();
      }
      break;
    default:
      throw invalid();
  }
}
