import type {
  ExpressionDirection,
  SpeechExpressionStatus,
  SpeechOccasionKind,
} from "./speech";

export interface SpeechDebugOutcome {
  status: SpeechExpressionStatus;
  attempts: number;
  generationCostMs: number;
  text: string;
}

export interface SpeechDebugSnapshot {
  registryId: number;
  characterId: string;
  archetype: string;
  label: string;
  requestedAtS: number;
  occasion: SpeechOccasionKind;
  expressionOrdinal: number;
  voiceProfileVersion: string;
  direction: ExpressionDirection;
  outcome: SpeechDebugOutcome;
}

export interface SpeechDebugProjectionInput {
  registryId: number;
  characterId: string;
  archetype: string;
  label: string;
  requestedAtS: number;
  occasion: SpeechOccasionKind;
  expressionOrdinal: number;
  voiceProfileVersion: string;
  direction: ExpressionDirection;
  status: SpeechExpressionStatus;
  attempts: number;
  generationCostMs: number;
  text: string;
}

/**
 * Copy the bounded inspection surface without retaining the Speech Request,
 * recent-expression context, or any rejected generator candidates.
 */
export function projectSpeechDebugSnapshot(
  input: SpeechDebugProjectionInput,
): SpeechDebugSnapshot {
  return {
    registryId: input.registryId,
    characterId: input.characterId,
    archetype: input.archetype,
    label: input.label,
    requestedAtS: input.requestedAtS,
    occasion: input.occasion,
    expressionOrdinal: input.expressionOrdinal,
    voiceProfileVersion: input.voiceProfileVersion,
    direction: { ...input.direction },
    outcome: {
      status: input.status,
      attempts: input.attempts,
      generationCostMs: input.generationCostMs,
      text: input.text,
    },
  };
}
