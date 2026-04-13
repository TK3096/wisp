import { describe, it, expect, vi } from "vitest";
import { CharacterRegistry, SpawnContext } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import { BubbleHandle } from "../src/bubble";
import { BUBBLE, GREETINGS, IDLE_LINES } from "../src/config";

// --- Fakes ---

function makeHandle(): CharacterHandle {
  return {
    setAnimation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    setFlip: vi.fn(),
    destroy: vi.fn(),
  };
}

interface FakeStage {
  children: unknown[];
  addChild: ReturnType<typeof vi.fn>;
  removeChild: ReturnType<typeof vi.fn>;
}

function makeStage(): FakeStage {
  const children: unknown[] = [];
  return {
    children,
    addChild: vi.fn((child) => { children.push(child); return child; }),
    removeChild: vi.fn((child) => {
      const i = children.indexOf(child);
      if (i !== -1) children.splice(i, 1);
      return child;
    }),
  };
}

const FAKE_MANIFEST = [
  { name: "a", idleFrames: 11, walkFrames: 12, frameWidth: 32, frameHeight: 32, idlePath: "", walkPath: "" },
  { name: "b", idleFrames: 11, walkFrames: 12, frameWidth: 32, frameHeight: 32, idlePath: "", walkPath: "" },
];

function makeRng(sequence: number[]): () => number {
  let i = 0;
  return () => sequence[i++ % sequence.length];
}

function makeLoadedAssets() {
  return new Map(
    FAKE_MANIFEST.map((entry) => [
      entry.name,
      {
        idleTextures: Array(11).fill(null),
        walkTextures: Array(12).fill(null),
      },
    ])
  );
}

const SCREEN_W = 1920;
const FLOOR_Y = 1016;

describe("CharacterRegistry", () => {
  it("starts with zero characters", () => {
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      rng: Math.random,
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
    });
    expect(reg.count).toBe(0);
  });

  it("spawn() adds exactly one character", () => {
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng calls per spawn: [asset, x, greeting]
      rng: makeRng([0, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
    });
    reg.spawn();
    expect(reg.count).toBe(1);
  });

  it("multiple spawn() calls accumulate independently", () => {
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng calls per spawn: [asset, x, greeting] × 3 spawns
      rng: makeRng([0, 0.1, 0, 0, 0.5, 0, 0, 0.9, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
    });
    reg.spawn();
    reg.spawn();
    reg.spawn();
    expect(reg.count).toBe(3);
  });

  it("random asset pick selects from manifest by RNG index", () => {
    const picked: string[] = [];
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng calls per spawn: [asset, x, greeting]
      // spawn1: asset=0.0→"a", x=0.5, greeting=0
      // spawn2: asset=1-ε→"b", x=0.5, greeting=0
      rng: makeRng([0.0, 0.5, 0, 1 - Number.EPSILON, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: (ctx: SpawnContext) => {
        picked.push(ctx.entry.name);
        return makeHandle();
      },
    });
    reg.spawn(); // asset rng=0.0 → Math.floor(0 * 2) = 0 → "a"
    reg.spawn(); // asset rng≈1.0 → Math.floor(~1 * 2) = 1 → "b"
    expect(picked[0]).toBe("a");
    expect(picked[1]).toBe("b");
  });

  it("spawn x falls within [0, screenWidth]", () => {
    const xs: number[] = [];
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng calls per spawn: [asset, x, greeting] × 5 spawns
      rng: makeRng([0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0.75, 0, 0, 1 - Number.EPSILON, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: (ctx: SpawnContext) => {
        xs.push(ctx.x);
        return makeHandle();
      },
    });
    for (let i = 0; i < 5; i++) reg.spawn();
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(SCREEN_W);
    }
  });

  it("despawnAll() removes every character and calls destroy on handles", () => {
    const handles: CharacterHandle[] = [];
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng calls per spawn: [asset, x, greeting] × 2 spawns
      rng: makeRng([0, 0.3, 0, 0, 0.7, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => {
        const h = makeHandle();
        handles.push(h);
        return h;
      },
    });
    reg.spawn();
    reg.spawn();
    expect(reg.count).toBe(2);

    reg.despawnAll();
    expect(reg.count).toBe(0);
    for (const h of handles) {
      expect(h.destroy).toHaveBeenCalled();
    }
  });

  it("tick(dt) advances every live character's animation", () => {
    const handles: CharacterHandle[] = [];
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng calls per spawn: [asset, x, greeting]
      rng: makeRng([0, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => {
        const h = makeHandle();
        handles.push(h);
        return h;
      },
    });
    reg.spawn();
    const callsBefore = (handles[0].setTexture as ReturnType<typeof vi.fn>).mock.calls.length;

    // 200ms > one frame at IDLE_FPS=8 (125ms/frame)
    reg.tick(0.2);

    const callsAfter = (handles[0].setTexture as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});

// ─── Phase 4: Scheduler tests ─────────────────────────────────────────────────

function makeFakeBubbleHandle(): BubbleHandle {
  return {
    setText: vi.fn(),
    setVisibleChars: vi.fn(),
    setPosition: vi.fn(),
    destroy: vi.fn(),
  };
}

function makeSchedulerRegistry(rng: () => number = () => 0.5) {
  const bubbleHandles: BubbleHandle[] = [];
  const reg = new CharacterRegistry({
    stage: makeStage() as any,
    manifest: FAKE_MANIFEST,
    loadedAssets: makeLoadedAssets(),
    rng,
    screenWidth: SCREEN_W,
    floorY: FLOOR_Y,
    createHandle: () => makeHandle(),
    createBubbleHandle: (_stage, _text) => {
      const h = makeFakeBubbleHandle();
      bubbleHandles.push(h);
      return h;
    },
  });
  return { reg, bubbleHandles };
}

describe("CharacterRegistry scheduler (Phase 4)", () => {
  it("greeting fires on spawn regardless of prior bubble state", () => {
    const { reg, bubbleHandles } = makeSchedulerRegistry(makeRng([0, 0.5, 0]));
    expect(bubbleHandles.length).toBe(0);
    reg.spawn();
    // One greeting bubble created immediately on spawn
    expect(bubbleHandles.length).toBe(1);
    expect(bubbleHandles[0].setText).toHaveBeenCalledWith(GREETINGS[0]); // rng=0 → idx 0
  });

  it("idle roll fires after PER_CHAR_AVG_INTERVAL_S seconds", () => {
    const { reg, bubbleHandles } = makeSchedulerRegistry(makeRng([0, 0.5, 0]));
    reg.spawn(); // greeting → bubbleHandles.length=1

    // Tick just past the roll interval (30s). Greeting expired well before this.
    // Large dt: bubble from greeting expires within the same tick.
    reg.tick(BUBBLE.PER_CHAR_AVG_INTERVAL_S + 0.5);

    // One new idle bubble fired
    expect(bubbleHandles.length).toBe(2);
  });

  it("global cooldown blocks a second bubble fired within GLOBAL_COOLDOWN_S", () => {
    // rng sequences: per spawn [asset, x, greeting], then per tick roll [rollTimer, line]
    const rng = makeRng([0, 0.5, 0, 0, 0.5, 0]);
    const { reg, bubbleHandles } = makeSchedulerRegistry(rng);

    reg.spawn(); // char1, greeting
    reg.spawn(); // char2, greeting
    expect(bubbleHandles.length).toBe(2); // 2 greetings

    // Tick past both roll timers (both at 30s). Char1's roll fires first (first in entries),
    // char2's roll fires in the same tick but is blocked by 3s cooldown.
    reg.tick(BUBBLE.PER_CHAR_AVG_INTERVAL_S + 0.5);

    // Only one idle bubble should have fired
    expect(bubbleHandles.length).toBe(3); // 2 greetings + 1 idle
  });

  it("more than one idle bubble fires over multiple roll cycles with two characters", () => {
    const rng = makeRng([0, 0.5, 0, 0, 0.5, 0]);
    const { reg, bubbleHandles } = makeSchedulerRegistry(rng);

    reg.spawn();
    reg.spawn();
    const greetingCount = bubbleHandles.length; // 2 greetings

    // Run two full roll cycles (each ~30s). Over 60s both characters get multiple chances.
    reg.tick(BUBBLE.PER_CHAR_AVG_INTERVAL_S + 1);
    reg.tick(BUBBLE.PER_CHAR_AVG_INTERVAL_S + 1);

    // More than one idle bubble should have fired across the two roll cycles
    expect(bubbleHandles.length - greetingCount).toBeGreaterThan(1);
  });

  it("greeting bypasses cooldown — fires even when lastBubbleAt is recent", () => {
    const rng = makeRng([0, 0.5, 0, 0.5]);
    const { reg, bubbleHandles } = makeSchedulerRegistry(rng);

    reg.spawn(); // char1 greeting
    // Trigger an idle roll to set lastBubbleAt
    reg.tick(BUBBLE.PER_CHAR_AVG_INTERVAL_S + 0.5);
    const countAfterIdleRoll = bubbleHandles.length;

    // Spawn char2 immediately — within the cooldown window
    // Greeting must fire despite the cooldown
    reg.spawn();
    expect(bubbleHandles.length).toBeGreaterThan(countAfterIdleRoll);
  });

  it("bubble rate at max 8 characters is bounded by GLOBAL_COOLDOWN_S", () => {
    const { reg, bubbleHandles } = makeSchedulerRegistry(() => 0.5);

    // Spawn 8 characters
    for (let i = 0; i < 8; i++) reg.spawn();
    const greetingCount = bubbleHandles.length; // 8 greetings

    // Simulate 120s with small ticks (to exercise per-tick scheduler)
    const TOTAL_S = 120;
    const DT = 0.1;
    for (let t = 0; t < TOTAL_S; t += DT) {
      reg.tick(DT);
    }

    const idleBubbles = bubbleHandles.length - greetingCount;
    // Max possible idle bubbles: TOTAL_S / GLOBAL_COOLDOWN_S = 120/3 = 40
    expect(idleBubbles).toBeLessThanOrEqual(Math.ceil(TOTAL_S / BUBBLE.GLOBAL_COOLDOWN_S));
    // At least some idle bubbles should have fired
    expect(idleBubbles).toBeGreaterThan(0);
  });

  it("greetings and idle lines come from distinct pools", () => {
    // Sanity check: at least one value in GREETINGS is not in IDLE_LINES
    const greetingSet = new Set(GREETINGS);
    const idleSet = new Set(IDLE_LINES);
    const overlap = [...greetingSet].filter((x) => idleSet.has(x));
    expect(overlap.length).toBeLessThan(GREETINGS.length);
  });

  it("skipped rolls are dropped — no backlog of pending bubbles", () => {
    const rng = makeRng([0, 0.5, 0, 0, 0.5, 0]);
    const { reg, bubbleHandles } = makeSchedulerRegistry(rng);

    reg.spawn();
    reg.spawn();

    // Both roll at t=30. Char1 fires, char2 is blocked (skipped/dropped).
    reg.tick(BUBBLE.PER_CHAR_AVG_INTERVAL_S + 0.5);
    const afterBothRolls = bubbleHandles.length; // 2 greetings + 1 idle

    // Wait cooldown to expire, then a short tick (well under next roll interval).
    // No backlogged bubble should fire — only a new roll can trigger.
    reg.tick(BUBBLE.GLOBAL_COOLDOWN_S + 0.1); // short, no new roll fires yet
    // bubbleHandles should NOT have grown (rollTimers not yet expired)
    // Note: rollTimers were reset when rolls fired, so next roll is ~10s–50s away
    expect(bubbleHandles.length).toBe(afterBothRolls);
  });
});
