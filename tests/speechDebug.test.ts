import { describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import { BubbleHandle } from "../src/bubble";
import { CognitionHandle, NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import {
  SpeechDebugOverlay,
  SpeechDebugView,
  formatSpeechDebugSnapshot,
} from "../src/speechDebug";
import { projectSpeechDebugSnapshot } from "../src/speechDebugSnapshot";
import type { SpeechDebugProjectionInput } from "../src/speechDebugSnapshot";
import { createSpeechDebugView } from "../src/speechDebugView";
import {
  ExpressionDirection,
  SpeechHandle,
  SpeechHandleInit,
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

const DIRECTION: ExpressionDirection = {
  tone: "curious",
  intent: "investigate",
  intensity: "charged",
  stance: "novel",
};

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

function makeRegistry(
  createSpeechHandle: (init: SpeechHandleInit) => SpeechHandle,
): CharacterRegistry {
  return new CharacterRegistry({
    stage: null,
    manifest: [ASSET],
    loadedAssets: LOADED_ASSETS,
    rng: () => 0,
    schedulerRng: vi.fn().mockReturnValueOnce(0.5).mockReturnValue(0.1),
    screenWidth: 100,
    floorY: 100,
    createHandle: () => makeCharacterHandle(),
    createBubbleHandle: () => makeBubbleHandle(),
    createCognitionHandle: (): CognitionHandle => ({
      observe() {},
      toneSeed: () => ({
        personality: {
          energy: 0.5,
          curiosity: 0.5,
          boldness: 0.5,
          sociability: 0.5,
        },
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
}

function makeSnapshot(
  overrides: Partial<SpeechDebugProjectionInput> = {},
) {
  return projectSpeechDebugSnapshot({
    registryId: overrides.registryId ?? 1,
    characterId: "character-1",
    archetype: "mask-dude",
    label: "Mask Dude #1",
    requestedAtS: 1.24,
    occasion: "idle",
    expressionOrdinal: 4,
    voiceProfileVersion: "generated-speech-v1",
    direction: DIRECTION,
    status: "generated",
    attempts: 2,
    generationCostMs: 0.021,
    text: "what makes the path turn?",
    ...overrides,
  });
}

function makeView(): SpeechDebugView {
  return {
    setVisible: vi.fn(),
    setLines: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("Speech Debug Snapshot", () => {
  it("projects only the bounded final-expression surface", () => {
    const snapshot = makeSnapshot();

    expect(snapshot.direction).toEqual(DIRECTION);
    expect(snapshot.outcome).toEqual({
      status: "generated",
      attempts: 2,
      generationCostMs: 0.021,
      text: "what makes the path turn?",
    });
    expect(Object.keys(snapshot)).toEqual([
      "registryId",
      "characterId",
      "archetype",
      "label",
      "requestedAtS",
      "occasion",
      "expressionOrdinal",
      "voiceProfileVersion",
      "direction",
      "outcome",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("recentExpressions");
    expect(JSON.stringify(snapshot)).not.toContain("personality");
    expect(JSON.stringify(snapshot)).not.toContain("candidates");
  });

  it("formats the compact accepted overlay fields", () => {
    expect(formatSpeechDebugSnapshot(makeSnapshot())).toEqual([
      "Mask Dude #1",
      "voice generated-speech-v1",
      "occasion idle #4 @ 1.24s",
      "direction curious/investigate charged · novel",
      "outcome generated · 2 attempts · 0.021ms",
      "what makes the path turn?",
    ]);
  });
});

describe("Speech Debug Overlay", () => {
  it("does not project while disabled and measures enabled projection/render", () => {
    const view = makeView();
    const provider = vi.fn(() => [makeSnapshot()]);
    const disabled = new SpeechDebugOverlay(view, {
      now: () => 0,
      enabled: false,
    });

    expect(disabled.update(provider)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(view.setVisible).toHaveBeenCalledWith(false);

    const now = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(10.075);
    const enabled = new SpeechDebugOverlay(view, { now, enabled: false });
    enabled.setEnabled(true);
    expect(enabled.update(provider)).toBe(provider.mock.results[0].value[0]);
    expect(enabled.lastFrameCostMs).toBeCloseTo(0.075, 6);
    expect(enabled.withinFrameBudget).toBe(true);
  });

  it("keeps selection stable and reports the accepted p95 budget", () => {
    const view = makeView();
    const first = makeSnapshot();
    const projectedSecond = makeSnapshot({
      registryId: 2,
      label: "Ninja Frog #2",
    });
    const overlay = new SpeechDebugOverlay(view, {
      now: () => 0,
      enabled: true,
    });

    overlay.update([first, projectedSecond]);
    overlay.selectNext([first, projectedSecond]);
    expect(overlay.update([first, projectedSecond])).toBe(projectedSecond);

    for (let index = 0; index < 20; index += 1) {
      overlay.update([first]);
    }
    expect(overlay.frameCount).toBe(22);
    expect(overlay.p95FrameCostMs).toBe(0);
    expect(overlay.withinFrameBudget).toBe(true);
  });

  it("creates the dynamically imported DOM view", () => {
    const container = {
      style: {},
      textContent: null,
      appendChild: vi.fn(),
      remove: vi.fn(),
    };
    const text = {
      style: {},
      textContent: null,
      appendChild: vi.fn(),
      remove: vi.fn(),
    };
    const document = {
      createElement: vi.fn((tagName: "div" | "pre") =>
        tagName === "div" ? container : text,
      ),
      body: { appendChild: vi.fn() },
    };
    const view = createSpeechDebugView(document as any);

    view.setLines(["Test #1"]);
    view.setVisible(true);
    expect(text.textContent).toBe("Test #1");
    expect(container.style.left).toBe("12px");
    expect(container.style.display).toBe("block");
    view.destroy();
    expect(container.remove).toHaveBeenCalled();
  });
});

describe("Character Registry Speech Debug projection", () => {
  it("records bounded neutral attempt accounting without exposing context", () => {
    const generate = vi.fn(() => null);
    const registry = makeRegistry(() => ({ generate }));

    registry.spawn();
    const [snapshot] = registry.speechDebugSnapshots();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      registryId: 1,
      occasion: "greeting",
      expressionOrdinal: 1,
      voiceProfileVersion: "neutral-speech-v1",
      outcome: {
        status: "substituted",
        attempts: 1,
      },
    });
    expect(snapshot.outcome.generationCostMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.outcome.text.length).toBeGreaterThan(0);
    expect(JSON.stringify(registry.speechDebugSnapshots())).not.toContain(
      "recentExpressions",
    );
  });

  it("records bounded generator attempt counts from the optional seam", () => {
    const generateWithAttemptCount = vi.fn(() => ({
      expression: null,
      attempts: 4,
    }));
    const registry = makeRegistry(() => ({
      generate: () => null,
      generateWithAttemptCount,
    }));

    registry.spawn();
    const [snapshot] = registry.speechDebugSnapshots();

    expect(generateWithAttemptCount).toHaveBeenCalledTimes(1);
    console.log(JSON.stringify(generateWithAttemptCount.mock.results, null, 2));
    expect(snapshot.outcome).toMatchObject({
      status: "substituted",
      attempts: 4,
    });
  });
});
