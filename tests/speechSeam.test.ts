import { describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import { BubbleHandle } from "../src/bubble";
import { GREETINGS, IDLE_LINES } from "../src/config";
import { CognitionHandle, NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import {
  BASELINE_SCENARIO,
  formatScenarioTraceNdjson,
  runScenario,
} from "../src/scenarioHarness";
import {
  SpeechHandle,
  SpeechHandleInit,
  SpeechRequest,
  createNeutralSpeechHandle,
  deriveExpressionDirection,
  deriveExpressionSeed,
  isValidGeneratedSpeechExpression,
} from "../src/speech";

const ASSET = {
  name: "test",
  displayName: "Test",
  idlePath: "",
  walkPath: "",
  jumpPath: "",
  fallPath: "",
  idleFrames: 1,
  walkFrames: 1,
  frameWidth: 1,
  frameHeight: 1,
};

const LOADED_ASSETS = new Map([
  [
    "test",
    {
      idleTextures: [null],
      walkTextures: [null],
      jumpTexture: null,
      fallTexture: null,
    },
  ],
]);

function makeCharacterHandle(): CharacterHandle {
  return {
    setAnimation() {},
    setTexture() {},
    setPosition() {},
    setFlip() {},
    setAirborneSprite() {},
    destroy() {},
  };
}

function makeBubbleHandle(): BubbleHandle {
  return {
    setText() {},
    setVisibleChars() {},
    setPosition() {},
    destroy() {},
  };
}

function makeRegistry(createSpeechHandle: (init: SpeechHandleInit) => SpeechHandle) {
  const bubbles: string[] = [];
  const registry = new CharacterRegistry({
    stage: null,
    manifest: [ASSET],
    loadedAssets: LOADED_ASSETS,
    rng: () => 0,
    schedulerRng: vi.fn().mockReturnValueOnce(0.5).mockReturnValue(0.1),
    screenWidth: 100,
    floorY: 100,
    createHandle: () => makeCharacterHandle(),
    createBubbleHandle: (_stage, text) => {
      bubbles.push(text);
      return makeBubbleHandle();
    },
    createCognitionHandle: (): CognitionHandle => ({
      observe() {},
      toneSeed: () => ({
        personality: { energy: 0.5, curiosity: 0.5, boldness: 0.5, sociability: 0.5 },
        affect: { surprise: 0, valence: 0, arousal: 0 },
      }),
      tick: () => NEUTRAL_BEHAVIOR_SIGNAL,
      noteExpression() {},
      snapshot: () => ({
        schemaVersion: 3,
        characterId: "test-character",
        cognition: null,
      }),
      restore: () => {},
    }),
    createSpeechHandle,
    createCharacterId: () => "0195c8f2-70aa-7cc2-99df-f2d3ba54c000",
  });
  return { bubbles, registry };
}

function runToFirstIdleRoll(registry: CharacterRegistry): void {
  for (let elapsed = 0; elapsed < 30; elapsed += 0.1) registry.tick(0.1);
  registry.tick(0.1);
}

describe("disabled production Speech Handle seam", () => {
  it("routes the Neutral Handle through fallback without changing observable text", () => {
    const generate = vi.fn(() => null);
    const inits: SpeechHandleInit[] = [];
    const requests: SpeechRequest[] = [];
    const { bubbles, registry } = makeRegistry((init) => {
      inits.push(init);
      return {
        generate(request) {
          requests.push(request);
          return generate(request);
        },
      };
    });

    registry.spawn();
    runToFirstIdleRoll(registry);

    expect(inits).toEqual([
      {
        characterId: "0195c8f2-70aa-7cc2-99df-f2d3ba54c000",
        archetype: "test",
        personalitySeed: expect.any(Number),
      },
    ]);
    expect(requests.map((request) => request.occasion)).toEqual([
      { kind: "greeting" },
      { kind: "idle" },
    ]);
    expect(requests[1].context.recentExpressions).toEqual([GREETINGS[0].text]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(bubbles).toEqual([GREETINGS[0].text, IDLE_LINES[3].text]);
  });

  it("accepts exactly one valid generated result per occasion", () => {
    const { bubbles, registry } = makeRegistry(() => ({
      generate: (request) => ({
        text: `generated ${request.occasion.kind}`,
        tone: request.direction.tone,
        source: "generated",
      }),
    }));

    registry.spawn();
    runToFirstIdleRoll(registry);

    expect(bubbles).toEqual(["generated greeting", "generated idle"]);
  });

  it("falls back immediately on invalid output and thrown generation", () => {
    const generate = vi.fn()
      .mockReturnValueOnce({ text: "invalid", tone: "curious", source: "fallback" })
      .mockImplementationOnce(() => {
        throw new Error("generator failed");
      });
    const { bubbles, registry } = makeRegistry(() => ({ generate }));

    registry.spawn();
    runToFirstIdleRoll(registry);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(bubbles).toEqual([GREETINGS[0].text, IDLE_LINES[3].text]);
  });

  it("derives stable, bounded expression lineage independently of scheduler RNG", () => {
    const signal = {
      personality: { energy: 0.5, curiosity: 0.5, boldness: 0.5, sociability: 0.5 },
      affect: { surprise: 0, valence: 0, arousal: 0 },
    } as const;
    const direction = deriveExpressionDirection(
      {
        ...signal,
        temporalSurprise: { derivativeNorm: 0, gate: 0.5, centeredEnergy: 0 },
        microBelief: { novelty: 0, familiarity: 0, socialPositivity: 0, caution: 0 },
        reaction: { kind: "none", score: 0, remainingS: 0, candidates: [] },
        behaviorBias: {
          idleDwell: 1,
          walkSpeed: 1,
          jumpChance: 1,
          bubbleChance: 1,
          animationPace: 1,
        },
      },
      "idle",
      0.25,
    );
    const init = { characterId: "character", archetype: "test", personalitySeed: 7 };

    expect(deriveExpressionSeed(init, 1, direction, [])).toBe(
      deriveExpressionSeed(init, 1, direction, []),
    );
    expect(
      deriveExpressionSeed(init, 1, direction, Array(20).fill("old")),
    ).toBe(deriveExpressionSeed(init, 1, direction, Array(8).fill("old")));
    expect(isValidGeneratedSpeechExpression(null, direction)).toBe(false);
    expect(
      isValidGeneratedSpeechExpression(
        { text: "  ", tone: direction.tone, source: "generated" },
        direction,
      ),
    ).toBe(false);
    expect(createNeutralSpeechHandle().generate({
      occasion: { kind: "idle" },
      personality: signal.personality,
      direction,
      context: { recentExpressions: [] },
      seed: 1,
    })).toBeNull();
  });

  it("replays an injected speech handle byte-identically at one frame rate", () => {
    const createSpeechHandle = () => ({
      generate: (request: SpeechRequest) => ({
        text: `deterministic ${request.occasion.kind}`,
        tone: request.direction.tone,
        source: "generated" as const,
      }),
    });

    const first = runScenario(BASELINE_SCENARIO, 60, { createSpeechHandle });
    const second = runScenario(BASELINE_SCENARIO, 60, { createSpeechHandle });
    const firstTrace = formatScenarioTraceNdjson(first);
    const secondTrace = formatScenarioTraceNdjson(second);
    const generatedBubbles = first.trace
      .filter((record) => record.type === "bubble_started")
      .map((record) => record.text);

    expect(generatedBubbles).toContain("deterministic greeting");
    expect(secondTrace).toBe(firstTrace);
  });
});
