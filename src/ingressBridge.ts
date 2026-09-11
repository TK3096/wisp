import {
  FeedbackKind,
  StimulusEnvelope,
  isEnvironmentChange,
  validateStimulusEnvelope,
} from "./cognition";

export interface GestureIngressPayload {
  gesture: "openPalm";
  confidence: number;
}

type Dispatch = (envelope: StimulusEnvelope) => void;

export class IngressBridge {
  constructor(private readonly dispatchEnvelope: Dispatch) {}

  receiveGesture(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;

    const { gesture, confidence } = payload as Partial<GestureIngressPayload>;
    if (
      gesture !== "openPalm" ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence)
    ) {
      return false;
    }

    const envelope: StimulusEnvelope = {
      target: "all",
      stimulus: { kind: "gesture", gesture, confidence },
    };
    return this.dispatchIfValid(envelope);
  }

  receiveEnvironment(change: unknown): boolean {
    if (!isEnvironmentChange(change)) return false;

    const envelope: StimulusEnvelope = {
      target: "all",
      stimulus: { kind: "environment", change },
    };
    return this.dispatchIfValid(envelope);
  }

  receiveFeedback(feedback: FeedbackKind, targetId: unknown): boolean {
    if (typeof targetId !== "string" || targetId === "") return false;

    return this.dispatchIfValid({
      target: { characterId: targetId },
      stimulus: { kind: "feedback", feedback },
    });
  }

  private dispatchIfValid(envelope: StimulusEnvelope): boolean {
    try {
      validateStimulusEnvelope(envelope);
    } catch {
      return false;
    }
    this.dispatchEnvelope(envelope);
    return true;
  }
}
