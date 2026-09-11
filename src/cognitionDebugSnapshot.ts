import {
  Affect,
  BehaviorBias,
  BehaviorSignal,
  Stimulus,
} from "./cognition";

export interface CognitionDebugReaction {
  kind: BehaviorSignal["reaction"]["kind"];
  score: number;
  remainingS: number;
}

export interface CognitionDebugStimulus {
  observedAtS: number;
  stimulus: Stimulus;
}

export interface CognitionDebugSnapshot {
  registryId: number;
  characterId: string;
  archetype: string;
  label: string;
  reaction: CognitionDebugReaction | null;
  affect: Affect | null;
  behaviorBias: BehaviorBias | null;
  latestStimulus: CognitionDebugStimulus | null;
  cadenceLagS: number;
}

export interface CognitionDebugProjectionInput {
  registryId: number;
  characterId: string;
  archetype: string;
  label: string;
  signal: BehaviorSignal | null;
  latestStimulus: CognitionDebugStimulus | null;
  cadenceLagS: number;
}

/**
 * Copy the bounded inspection surface without retaining substrate internals.
 * The debug overlay must never receive the opaque Cognition State.
 */
export function projectCognitionDebugSnapshot(
  input: CognitionDebugProjectionInput,
): CognitionDebugSnapshot {
  const { signal } = input;
  return {
    registryId: input.registryId,
    characterId: input.characterId,
    archetype: input.archetype,
    label: input.label,
    reaction: signal
      ? {
          kind: signal.reaction.kind,
          score: signal.reaction.score,
          remainingS: signal.reaction.remainingS,
        }
      : null,
    affect: signal ? { ...signal.affect } : null,
    behaviorBias: signal ? { ...signal.behaviorBias } : null,
    latestStimulus: input.latestStimulus && {
      observedAtS: input.latestStimulus.observedAtS,
      stimulus: { ...input.latestStimulus.stimulus },
    },
    cadenceLagS: input.cadenceLagS,
  };
}
