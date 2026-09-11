import { describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import {
  BehaviorSignal,
  CognitionHandle,
  NEUTRAL_BEHAVIOR_SIGNAL,
  PersonalityDimensions,
  Stimulus,
} from "../src/cognition";

let testIdentityCounter = 0;
const nextTestId = () =>
  `0195c8f2-70aa-7cc2-99df-f2d3ba54c${(++testIdentityCounter).toString(16).padStart(3, "0")}`;

function makeRegistry(personality: PersonalityDimensions) {
  const state = {
    clockS: 0,
    rewardCue: null as null | "delight" | "dismiss",
    drift: { energy: 0, sociability: 0 },
  };
  const signal = (): BehaviorSignal => ({
    ...NEUTRAL_BEHAVIOR_SIGNAL,
    personality: {
      ...personality,
      energy: Math.max(0, Math.min(1, personality.energy + state.drift.energy)),
      sociability: Math.max(
        0,
        Math.min(1, personality.sociability + state.drift.sociability),
      ),
    },
    behaviorBias: { ...NEUTRAL_BEHAVIOR_SIGNAL.behaviorBias, bubbleChance: 1.2 },
  });
  const cognition: CognitionHandle = {
    observe: vi.fn((stimulus: Stimulus) => {
      if (stimulus.kind === "feedback") state.rewardCue = stimulus.feedback;
    }),
    toneSeed: () => {
      const current = signal();
      return { personality: current.personality, affect: current.affect };
    },
    tick: vi.fn((dt: number) => {
      state.clockS += dt;
      if (state.rewardCue && state.clockS > 2) state.rewardCue = null;
      return signal();
    }),
    noteExpression: vi.fn(() => {
      if (!state.rewardCue) return;
      const direction = state.rewardCue === "delight" ? 1 : -1;
      state.drift.energy = Math.max(
        -0.08,
        Math.min(0.08, state.drift.energy + direction * 0.04),
      );
      state.drift.sociability = Math.max(
        -0.08,
        Math.min(0.08, state.drift.sociability + direction * 0.04),
      );
      state.rewardCue = null;
    }),
    snapshot: () => ({ schemaVersion: 2, characterId: "x", cognition: null }),
    restore: () => {},
  };
  const registry = new CharacterRegistry({
    stage: null,
    manifest: [
      {
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
      },
    ],
    loadedAssets: new Map([
      ["test", { idleTextures: [null], walkTextures: [null], jumpTexture: null, fallTexture: null }],
    ]),
    rng: () => 0,
    schedulerRng: () => 0.1,
    screenWidth: 100,
    floorY: 100,
    createBubbleHandle: () => ({
      setText() {},
      setVisibleChars() {},
      setPosition() {},
      destroy() {},
    }),
    createHandle: (): CharacterHandle => ({
      setAnimation() {},
      setTexture() {},
      setPosition() {},
      setFlip() {},
      setAirborneSprite() {},
      destroy() {},
    }),
    createCognitionHandle: () => cognition,
    createCharacterId: nextTestId,
  });
  return { registry, cognition, state };
}

function runToFirstIdleRoll(registry: CharacterRegistry): void {
  // The first fixed roll timer is 30s; stop before its jittered successor.
  for (let elapsed = 0; elapsed <= 30.2; elapsed += 0.1) registry.tick(0.1);
}

describe("explicit feedback expression credit", () => {
  it("credits one expression inside the accepted feedback window", () => {
    const { registry, cognition, state } = makeRegistry({
      energy: 0.5,
      curiosity: 0.5,
      boldness: 0.5,
      sociability: 0.5,
    });
    registry.spawn();
    const characterId = registry.characterIdFor(1)!;
    state.drift.energy = 0;
    state.drift.sociability = 0;
    vi.mocked(cognition.noteExpression).mockClear();

    registry.dispatch({
      target: { characterId },
      stimulus: { kind: "feedback", feedback: "delight" },
    });
    runToFirstIdleRoll(registry);

    expect(cognition.observe).toHaveBeenCalledWith({
      kind: "feedback",
      feedback: "delight",
    });
    expect(cognition.noteExpression).toHaveBeenCalledTimes(1);
  });

  it("does not reward an expression after the window expires", () => {
    const { registry, state } = makeRegistry({
      energy: 0.5,
      curiosity: 0.5,
      boldness: 0.5,
      sociability: 0.5,
    });
    registry.spawn();
    state.drift.energy = 0;
    state.drift.sociability = 0;
    registry.dispatch({
      target: { characterId: registry.characterIdFor(1)! },
      stimulus: { kind: "feedback", feedback: "delight" },
    });
    for (let elapsed = 0; elapsed <= 2.1; elapsed += 0.1) registry.tick(0.1);
    runToFirstIdleRoll(registry);

    expect(state.drift).toEqual({ energy: 0, sociability: 0 });
  });

  it("does not establish reward without explicit feedback", () => {
    const { registry, state } = makeRegistry({
      energy: 0.5,
      curiosity: 0.5,
      boldness: 0.5,
      sociability: 0.5,
    });
    registry.spawn();
    state.drift.energy = 0;
    state.drift.sociability = 0;
    runToFirstIdleRoll(registry);

    expect(state.drift).toEqual({ energy: 0, sociability: 0 });
  });
});
