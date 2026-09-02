import { COGNITION_CADENCE_S, SocialInfluence, SocialProjection } from "./cognition";

/** The accepted modelless Social Projection width and canonical positions. */
export const SOCIAL_PROJECTION_DIMENSIONS = 8;
export const SOCIAL_PROJECTION_INDEX = Object.freeze({
  energy: 0,
  curiosity: 1,
  boldness: 2,
  sociability: 3,
  surprise: 4,
  valence: 5,
  arousal: 6,
  socialPositivity: 7,
});
/** One low-rate pass for every five accepted Cognition Cadence steps. */
export const COGNITION_STEPS_PER_POPULATION_PASS = 5;
export const POPULATION_COGNITION_CADENCE_S =
  COGNITION_STEPS_PER_POPULATION_PASS * COGNITION_CADENCE_S;
/** Match the accepted one-second bounded Cognition catch-up window. */
export const MAX_POPULATION_CATCHUP_PASSES = Math.max(
  1,
  Math.floor(10 / COGNITION_STEPS_PER_POPULATION_PASS),
);
/** Frozen dense peer-attention parameters; no learned projection is used. */
export const POPULATION_ATTENTION = Object.freeze({
  BETA: 1,
  GAMMA: 0.12,
  RECEIVER_GAIN: 0.2,
});

export interface SocialParticipant {
  characterId: string;
  sociability: number;
  projection: SocialProjection;
}

export type PopulationCognitionSkipReason =
  | "disabled"
  | "insufficient_eligible";

export interface PopulationSignalSummary {
  characterId: string;
  socialPositivity: number;
}

export interface PopulationPassSummary {
  atS: number;
  cadenceS: number;
  enabled: boolean;
  eligibleCount: number;
  membershipDigest: string | null;
  influenceNorm: number | null;
  strongestContribution: SocialInfluence | null;
  skipReason: PopulationCognitionSkipReason | null;
  postIntegrationSignals: PopulationSignalSummary[];
}

export interface PopulationPassContext {
  atS: number;
  enabled: boolean;
  participants: readonly SocialParticipant[];
  /** Apply through Cognition and return its bounded post-integration signal. */
  applyInfluence: (influence: SocialInfluence) => number;
}

/**
 * Execute one modelless identity-projection Population Cognition Pass.
 *
 * Membership is sorted by Character Identity code units before gathering.
 * Every query excludes itself, all values are finite and bounded, and the
 * facade emits only per-receiver influence and a bounded canonical summary.
 */
export function runPopulationCognitionPass(
  context: PopulationPassContext,
): PopulationPassSummary {
  const base = {
    atS: context.atS,
    cadenceS: POPULATION_COGNITION_CADENCE_S,
    enabled: context.enabled,
    eligibleCount: context.participants.length,
  };
  if (!context.enabled) {
    return {
      ...base,
      membershipDigest: null,
      influenceNorm: null,
      strongestContribution: null as SocialInfluence | null,
      skipReason: "disabled",
      postIntegrationSignals: [],
    };
  }

  validateParticipants(context.participants);
  if (context.participants.length < 2) {
    return {
      ...base,
      membershipDigest: null,
      influenceNorm: null,
      strongestContribution: null,
      skipReason: "insufficient_eligible",
      postIntegrationSignals: [],
    };
  }

  const members = [...context.participants]
    .sort(byCharacterIdentity)
    .map((participant) => ({
      characterId: participant.characterId,
      sociability: participant.sociability,
      original: participant.projection.slice(),
      output: participant.projection.slice(),
      influence: 0,
      strongestContribution: null as SocialInfluence | null,
    }));

  for (const [receiverIndex, receiver] of members.entries()) {
    let attentionMean = 0;
    let strongestContribution: SocialInfluence | null = null;
    for (const [peerIndex, peer] of members.entries()) {
      if (peerIndex === receiverIndex) continue;
      const activation = sigmoid(
        POPULATION_ATTENTION.BETA * dot(receiver.original, peer.original),
      );
      attentionMean += activation / (members.length - 1);

      const gatedContribution = peer.original.map(
        (value) =>
          (receiver.sociability * activation * value) / (members.length - 1),
      );
      const contributionValue = clamp(mean(gatedContribution), -1, 1);
      const candidate: SocialInfluence = {
        receiverId: receiver.characterId,
        sourceId: peer.characterId,
        value: contributionValue,
      };
      if (
        strongestContribution === null ||
        Math.abs(candidate.value) > Math.abs(strongestContribution.value)
      ) {
        strongestContribution = candidate;
      }

      for (let dimension = 0; dimension < SOCIAL_PROJECTION_DIMENSIONS; dimension++) {
        receiver.output[dimension] = clamp(
          receiver.output[dimension] +
            POPULATION_ATTENTION.GAMMA * gatedContribution[dimension],
          -1,
          1,
        );
      }
    }

    receiver.influence = clamp(
      POPULATION_ATTENTION.RECEIVER_GAIN *
        receiver.sociability *
        (mean(receiver.output) - mean(receiver.original)),
      -1,
      1,
    );
    receiver.strongestContribution = strongestContribution;
  }

  const postIntegrationSignals: PopulationSignalSummary[] = [];
  for (const member of members) {
    if (member.strongestContribution) {
      const socialPositivity = context.applyInfluence({
        receiverId: member.characterId,
        sourceId: member.strongestContribution.sourceId,
        value: member.influence,
      });
      postIntegrationSignals.push({ characterId: member.characterId, socialPositivity });
    }
  }

  const strongest = members.reduce<SocialInfluence | null>((best, member) => {
    const candidate = member.strongestContribution;
    if (!candidate) return best;
    return !best || Math.abs(candidate.value) > Math.abs(best.value)
      ? candidate
      : best;
  }, null);
  const influenceNorm = clamp(
    Math.sqrt(
      members.reduce((sum, member) => sum + member.influence * member.influence, 0),
    ),
    0,
    1,
  );

  return {
    ...base,
    membershipDigest: membershipDigest(members.map((member) => member.characterId)),
    influenceNorm,
    strongestContribution: strongest,
    skipReason: null,
    postIntegrationSignals,
  };
}

function byCharacterIdentity(a: SocialParticipant, b: SocialParticipant): number {
  if (a.characterId < b.characterId) return -1;
  if (a.characterId > b.characterId) return 1;
  return 0;
}

function validateParticipants(participants: readonly SocialParticipant[]): void {
  const seen = new Set<string>();
  for (const participant of participants) {
    if (
      typeof participant.characterId !== "string" ||
      participant.characterId === "" ||
      seen.has(participant.characterId)
    ) {
      throw new Error("Social participants require unique non-empty character identities");
    }
    seen.add(participant.characterId);
    if (
      !Number.isFinite(participant.sociability) ||
      participant.sociability < 0 ||
      participant.sociability > 1
    ) {
      throw new Error("Social participant sociability must be finite and within [0, 1]");
    }
    if (
      !Array.isArray(participant.projection) ||
      participant.projection.length !== SOCIAL_PROJECTION_DIMENSIONS ||
      participant.projection.some(
        (value: number) => !Number.isFinite(value) || value < -1 || value > 1,
      )
    ) {
      throw new Error("Social Projection must contain eight finite values in [-1, 1]");
    }
  }
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, left, index) => sum + left * b[index], 0);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function membershipDigest(characterIds: readonly string[]): string {
  let digest = 0x811c9dc5;
  const encode = (value: string): void => {
    for (let index = 0; index < value.length; index++) {
      digest ^= value.charCodeAt(index);
      digest = Math.imul(digest, 0x01000193);
    }
    digest ^= 0x1f;
    digest = Math.imul(digest, 0x01000193);
  };
  characterIds.forEach(encode);
  return (digest >>> 0).toString(16).padStart(8, "0");
}
