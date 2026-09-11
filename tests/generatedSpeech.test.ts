import { describe, expect, it } from "vitest";
import { GENERATED_SPEECH_ENABLED, GREETINGS, IDLE_LINES } from "../src/config";
import { NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import {
  BASELINE_SCENARIO,
  formatScenarioTraceNdjson,
  runScenario,
  scenarioBehaviorDecisions,
  scenarioExpressionRecords,
} from "../src/scenarioHarness";
import {
  GENERATED_REPETITION_WINDOW,
  GENERATED_SPEECH_VOICE_PROFILE_VERSION,
  MAX_SPEECH_TEXT_LENGTH,
  createNeutralSpeechHandle,
  isValidGeneratedSpeechExpression,
} from "../src/speech";
import type {
  ExpressionDirection,
  SpeechHandleInit,
  SpeechRequest,
} from "../src/speech";
import { createGeneratedSpeechHandle } from "../src/speech/generator";

const init: SpeechHandleInit = {
  characterId: "generator-character",
  archetype: "mask-dude",
  personalitySeed: 17,
};

const personality = NEUTRAL_BEHAVIOR_SIGNAL.personality;

function request(
  seed: number,
  direction: ExpressionDirection,
  recentExpressions: readonly string[] = [],
): SpeechRequest {
  return {
    occasion: { kind: "idle" },
    personality,
    direction,
    context: { recentExpressions },
    seed,
  };
}

function direction(overrides: Partial<ExpressionDirection> = {}): ExpressionDirection {
  return {
    tone: "curious",
    intent: "idle",
    intensity: "neutral",
    stance: null,
    ...overrides,
  };
}

describe("production Speech generator harness gates", () => {
  it("keeps generated speech default-off on the fixed-line baseline", () => {
    expect(GENERATED_SPEECH_ENABLED).toBe(false);
    expect(createNeutralSpeechHandle().generate(
      request(1, direction()),
    )).toBeNull();

    const result = runScenario(BASELINE_SCENARIO, 60);
    expect(scenarioExpressionRecords(result)).toMatchObject([
      {
        status: "substituted",
        text: GREETINGS[0].text,
        voiceProfileVersion: "neutral-speech-v1",
      },
      {
        status: "substituted",
        text: IDLE_LINES[3].text,
        voiceProfileVersion: "neutral-speech-v1",
      },
    ]);
  });

  it("accepts generated expressions on the synchronous success path", () => {
    const result = runScenario(BASELINE_SCENARIO, 60, {
      createSpeechHandle: createGeneratedSpeechHandle,
    });
    const records = scenarioExpressionRecords(result);
    const bubbles = result.trace
      .filter((record) => record.type === "bubble_started")
      .map((record) => record.text);

    expect(records).toHaveLength(2);
    expect(records).toMatchObject([
      {
        occasion: { kind: "greeting" },
        expressionOrdinal: 1,
        status: "generated",
        voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
      },
      {
        occasion: { kind: "idle" },
        expressionOrdinal: 2,
        status: "generated",
        voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
      },
    ]);
    for (const record of records) {
      expect(record.text.length).toBeGreaterThan(0);
      expect([...record.text].length).toBeLessThanOrEqual(MAX_SPEECH_TEXT_LENGTH);
      expect(bubbles).toContain(record.text);
    }
  });

  it("fails closed immediately when generated output is invalid", () => {
    const wrapped = createGeneratedSpeechHandle(init);
    const result = runScenario(BASELINE_SCENARIO, 60, {
      createSpeechHandle: () => ({
        voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
        generate: (candidate) => {
          const generated = wrapped.generate(candidate);
          return generated === null ? null : {
            ...generated,
            text: "bad\noutput",
          };
        },
      }),
    });

    expect(scenarioExpressionRecords(result)).toMatchObject([
      {
        status: "substituted",
        text: GREETINGS[0].text,
        voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
      },
      {
        status: "substituted",
        text: IDLE_LINES[3].text,
        voiceProfileVersion: GENERATED_SPEECH_VOICE_PROFILE_VERSION,
      },
    ]);
    expect(isValidGeneratedSpeechExpression(
      { text: `x`.repeat(MAX_SPEECH_TEXT_LENGTH + 1), tone: "curious", source: "generated" },
      direction(),
    )).toBe(false);
    expect(isValidGeneratedSpeechExpression(
      { text: "bad\noutput", tone: "curious", source: "generated" },
      direction(),
    )).toBe(false);
    expect(isValidGeneratedSpeechExpression(
      { text: "see https://example.com", tone: "curious", source: "generated" },
      direction(),
    )).toBe(false);
    expect(isValidGeneratedSpeechExpression(
      { text: "mail me@example.com", tone: "curious", source: "generated" },
      direction(),
    )).toBe(false);
    expect(isValidGeneratedSpeechExpression(
      { text: "<script>danger</script>", tone: "curious", source: "generated" },
      direction(),
    )).toBe(false);
    expect(isValidGeneratedSpeechExpression(
      { text: "control\u0007char", tone: "curious", source: "generated" },
      direction(),
    )).toBe(false);
    expect(isValidGeneratedSpeechExpression(
      { text: "hello", tone: "curious", source: "generated" },
      direction(),
      ["HELLO!"],
    )).toBe(false);
    expect(GENERATED_REPETITION_WINDOW).toBe(3);
  });

  it("is byte-identical per frame rate and equivalent across 30, 60, and 120 fps", () => {
    const options = { createSpeechHandle: createGeneratedSpeechHandle };
    const first = runScenario(BASELINE_SCENARIO, 60, options);
    const second = runScenario(BASELINE_SCENARIO, 60, options);
    const projected = [30, 60, 120].map((fps) =>
      scenarioExpressionRecords(runScenario(BASELINE_SCENARIO, fps, options)),
    );
    const decisions = [30, 60, 120].map((fps) =>
      scenarioBehaviorDecisions(runScenario(BASELINE_SCENARIO, fps, options)),
    );

    expect(formatScenarioTraceNdjson(first)).toBe(formatScenarioTraceNdjson(second));
    expect(projected[1]).toEqual(projected[0]);
    expect(projected[2]).toEqual(projected[0]);
    expect(decisions[1]).toEqual(decisions[0]);
    expect(decisions[2]).toEqual(decisions[0]);
  });

  it("bounds repetition while preserving voice distinctiveness", () => {
    const archetypeSeeds: [string, number][] = [
      ["mask-dude", 11],
      ["ninja-frog", 23],
      ["pink-man", 37],
      ["virtual-guy", 53],
    ];
    const accepted = archetypeSeeds.map(([archetype, personalitySeed]) => {
      const handle = createGeneratedSpeechHandle({
        characterId: `${archetype}-character`,
        archetype,
        personalitySeed,
      });
      const recent: string[] = [];
      for (let ordinal = 0; ordinal < 20; ordinal++) {
        const expression = handle.generate(request(ordinal + 1, direction(), recent));
        expect(expression).not.toBeNull();
        expect(expression?.source).toBe("generated");
        if (expression) recent.push(expression.text);
        recent.splice(0, Math.max(0, recent.length - 8));
        const repetitionWindow = recent.slice(-GENERATED_REPETITION_WINDOW - 1, -1);
        expect(repetitionWindow).not.toContain(expression?.text);
      }
      return recent;
    });

    for (const voice of accepted) {
      const unique = new Set(voice);
      expect(unique.size / voice.length).toBeGreaterThanOrEqual(0.6);
    }
    const firstVoice = new Set(accepted[0]);
    const exactOverlaps = accepted.slice(1).reduce(
      (count, voice) => count + voice.filter((text) => firstVoice.has(text)).length,
      0,
    );
    expect(exactOverlaps / (accepted.length - 1) / accepted[0].length).toBeLessThanOrEqual(0.2);
  });
});
