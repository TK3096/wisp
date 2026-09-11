import { describe, expect, it } from "vitest";
import { GREETINGS, IDLE_LINES } from "../src/config";
import { NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import {
  bubbleToneWeights,
  selectTaggedLine,
  selectBubbleTone,
} from "../src/speech";

describe("accepted speech tones", () => {
  it("gives every greeting and idle line exactly one accepted tag", () => {
    const acceptedTones = new Set(["cheerful", "curious", "grumpy"]);
    for (const line of [...GREETINGS, ...IDLE_LINES]) {
      expect(Object.keys(line)).toEqual(["text", "tone"]);
      expect(acceptedTones.has(line.tone)).toBe(true);
    }
  });

  it("selects the same tone and line from the same personality and roll", () => {
    const signal = {
      ...NEUTRAL_BEHAVIOR_SIGNAL,
      personality: { energy: 0.8, curiosity: 0.9, boldness: 0.5, sociability: 0.9 },
    };
    expect(selectBubbleTone(signal, 0.25)).toBe(selectBubbleTone(signal, 0.25));
    expect(selectTaggedLine(GREETINGS, signal, 0.25)).toBe(
      selectTaggedLine(GREETINGS, signal, 0.25),
    );
  });

  it("weights personality and affect while preserving incongruous choices", () => {
    const social = {
      personality: { energy: 0.8, curiosity: 0.5, boldness: 0.5, sociability: 1 },
      affect: { surprise: 0, valence: 0.8, arousal: 0 },
    };
    const unhappy = {
      personality: { energy: 0.2, curiosity: 0.2, boldness: 0.5, sociability: 0 },
      affect: { surprise: 0, valence: -0.8, arousal: 0 },
    };
    const curious = {
      personality: { energy: 0.2, curiosity: 1, boldness: 0.5, sociability: 0.2 },
      affect: { surprise: 0.9, valence: 0, arousal: 0.8 },
    };

    expect(bubbleToneWeights(social.personality, social.affect).cheerful).toBeGreaterThan(
      bubbleToneWeights(social.personality, social.affect).grumpy,
    );
    expect(selectBubbleTone(social, 0.25)).toBe("cheerful");
    expect(selectBubbleTone(social, 0.999999)).toBe("grumpy");
    expect(selectBubbleTone(unhappy, 0.9)).toBe("grumpy");
    expect(selectBubbleTone(curious, 0.25)).toBe("curious");
  });
});
