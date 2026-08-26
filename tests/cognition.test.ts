import { describe, expect, it } from "vitest";
import {
  COGNITION_SCHEMA_VERSION,
  NEUTRAL_BEHAVIOR_SIGNAL,
  createNeutralCognitionHandle,
} from "../src/cognition";

describe("neutral Cognition Handle", () => {
  it("returns a finite, bounded, neutral Behavior Signal", () => {
    expect(NEUTRAL_BEHAVIOR_SIGNAL.affect).toEqual({
      surprise: 0,
      valence: 0,
      arousal: 0,
    });
    expect(NEUTRAL_BEHAVIOR_SIGNAL.behaviorBias).toEqual({
      idleDwell: 1,
      walkSpeed: 1,
      jumpChance: 1,
      bubbleChance: 1,
      animationPace: 1,
    });
  });

  it("ticks at the fixed cadence without changing the neutral signal", () => {
    const handle = createNeutralCognitionHandle({
      schemaVersion: COGNITION_SCHEMA_VERSION,
      characterId: "character-1",
      archetype: "a",
      personalitySeed: 0,
    });

    handle.observe({ kind: "lifecycle", phase: "materialized" });

    expect(handle.tick(0.1)).toBe(NEUTRAL_BEHAVIOR_SIGNAL);
  });
});
