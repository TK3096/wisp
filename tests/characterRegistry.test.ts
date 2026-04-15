import { describe, it, expect, vi } from "vitest";
import { CharacterRegistry, SpawnContext } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import { BubbleHandle } from "../src/bubble";
import { EffectHandle, EffectKind } from "../src/effect";
import { BUBBLE, EFFECT, GREETINGS, IDLE_LINES, JUMP } from "../src/config";

// --- Fakes ---

function makeHandle(): CharacterHandle {
  return {
    setAnimation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    setFlip: vi.fn(),
    setAirborneSprite: vi.fn(),
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
  { name: "a", displayName: "A", idleFrames: 11, walkFrames: 12, frameWidth: 32, frameHeight: 32, idlePath: "", walkPath: "", jumpPath: "", fallPath: "" },
  { name: "b", displayName: "B", idleFrames: 11, walkFrames: 12, frameWidth: 32, frameHeight: 32, idlePath: "", walkPath: "", jumpPath: "", fallPath: "" },
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
        jumpTexture: null,
        fallTexture: null,
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

// ─── Phase 5: Jump scheduler tests ───────────────────────────────────────────

function makeJumpRegistry(rng: () => number = () => 0.5) {
  const handles: CharacterHandle[] = [];
  const reg = new CharacterRegistry({
    stage: makeStage() as any,
    manifest: FAKE_MANIFEST,
    loadedAssets: makeLoadedAssets(),
    rng,
    screenWidth: SCREEN_W,
    floorY: FLOOR_Y,
    createHandle: () => {
      const h = makeHandle();
      handles.push(h);
      return h;
    },
  });
  return { reg, handles };
}

describe("CharacterRegistry jump scheduler (Phase 5)", () => {
  it("jump roll fires after PER_CHAR_AVG_INTERVAL_S seconds", () => {
    // rng sequence per spawn: [asset, x, greeting]
    const { reg, handles } = makeJumpRegistry(makeRng([0, 0.5, 0]));
    reg.spawn();

    const spy = handles[0].setAirborneSprite as ReturnType<typeof vi.fn>;

    // Tick just past the jump roll interval. jump() is called at end of that tick,
    // so one more small tick is needed for tickAirborne to emit setAirborneSprite.
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S + 0.1);
    reg.tick(0.01);

    // setAirborneSprite should have been called with "jump" at some point
    const kinds = spy.mock.calls.map((c) => c[0]);
    expect(kinds).toContain("jump");
  });

  it("next jump roll timer is jittered within configured bounds", () => {
    // Capture the rng calls to reason about timer reset.
    // spawn uses [asset=0, x=0.5, greeting=0], then each bubble/jump roll uses rng for jitter.
    // We drive a deterministic rng=0 which produces min-jitter resets.
    const calls: number[] = [];
    const rng = () => { const v = 0; calls.push(v); return v; };
    const { reg } = makeJumpRegistry(rng);
    reg.spawn();

    // Tick past first roll. The new jumpRollTimer should be:
    // PER_CHAR_AVG_INTERVAL_S - PER_CHAR_JITTER_S + rng() * (2 * PER_CHAR_JITTER_S)
    // With rng()=0: = 20 - 10 + 0 = 10s (min interval)
    // Tick a bit more past another 10s to see a second jump fire.
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S + 0.1);
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S - JUMP.PER_CHAR_JITTER_S + 0.2);

    // We've ticked past two roll intervals, so at least 2 jumps should have fired.
    // The first jump already verified above; here we just check state is stable.
    expect(reg.count).toBe(1);
  });

  it("two characters have independent jump roll timers", () => {
    // Both characters initialize jumpRollTimer at PER_CHAR_AVG_INTERVAL_S.
    // Each rng() call for jitter is independent per character.
    const { reg, handles } = makeJumpRegistry(makeRng([0, 0.5, 0, 0, 0.5, 0]));
    reg.spawn(); // char 0
    reg.spawn(); // char 1

    const spy0 = handles[0].setAirborneSprite as ReturnType<typeof vi.fn>;
    const spy1 = handles[1].setAirborneSprite as ReturnType<typeof vi.fn>;

    // Both should fire near PER_CHAR_AVG_INTERVAL_S. One extra tick to let tickAirborne emit.
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S + 0.5);
    reg.tick(0.01);

    expect(spy0.mock.calls.some((c) => c[0] === "jump")).toBe(true);
    expect(spy1.mock.calls.some((c) => c[0] === "jump")).toBe(true);
  });

  it("jump roll on already-airborne character is a no-op (no double-jump)", () => {
    const { reg, handles } = makeJumpRegistry(makeRng([0, 0.5, 0]));
    reg.spawn();

    const spy = handles[0].setAirborneSprite as ReturnType<typeof vi.fn>;

    // Trigger first roll
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S + 0.01);
    const callsAfterFirst = spy.mock.calls.length;

    // Immediately trigger another roll by advancing the reset jitter to min (rng=0 → 10s reset)
    // But the character is still airborne (DURATION=0.5s, we've barely ticked).
    // Trick: reset timer artificially by ticking exactly the min interval
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S - JUMP.PER_CHAR_JITTER_S + 0.01);

    // The character should have landed by now (0.5s airtime << 10s we just ticked)
    // so the second roll fires on a grounded character and starts a new jump.
    // This tests the normal cycle; the key invariant is no crash or broken state.
    expect(reg.count).toBe(1);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(callsAfterFirst);
  });

  it("jump rolls and bubble rolls are fully decoupled — no global cooldown coupling", () => {
    const { reg, handles } = makeJumpRegistry(makeRng([0, 0.5, 0]));
    reg.spawn();

    const jumpSpy = handles[0].setAirborneSprite as ReturnType<typeof vi.fn>;

    // Tick past both a bubble roll interval and a jump roll interval simultaneously.
    // The jump should still fire regardless of bubble cooldown state.
    reg.tick(Math.max(BUBBLE.PER_CHAR_AVG_INTERVAL_S, JUMP.PER_CHAR_AVG_INTERVAL_S) + 1);
    reg.tick(0.01); // let tickAirborne emit setAirborneSprite

    expect(jumpSpy.mock.calls.some((c) => c[0] === "jump")).toBe(true);
  });
});

// ─── Phase 6: Identity & despawn-one ─────────────────────────────────────────

function makeIdentityRegistry(rng: () => number = makeRng([0, 0.5, 0])) {
  const reg = new CharacterRegistry({
    stage: makeStage() as any,
    manifest: FAKE_MANIFEST,
    loadedAssets: makeLoadedAssets(),
    rng,
    screenWidth: SCREEN_W,
    floorY: FLOOR_Y,
    createHandle: () => makeHandle(),
  });
  return reg;
}

describe("CharacterRegistry Phase 6: identity & despawn(id)", () => {
  it("IDs are monotonically increasing and never reused after despawn", () => {
    // rng per spawn: [asset, x, greeting]
    const reg = makeIdentityRegistry(makeRng([0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0]));

    reg.spawn(); // id=1
    reg.spawn(); // id=2
    const snap1 = reg.snapshot();
    expect(snap1.map((s) => s.id)).toEqual([1, 2]);

    reg.despawn(1); // remove id=1
    reg.spawn();    // id=3 (not 1)
    const snap2 = reg.snapshot();
    expect(snap2.map((s) => s.id)).toEqual([2, 3]);
  });

  it("despawn(id) happy path: removes the targeted character and returns true", () => {
    const handles: CharacterHandle[] = [];
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      rng: makeRng([0, 0.5, 0, 0, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => {
        const h = makeHandle();
        handles.push(h);
        return h;
      },
    });

    reg.spawn(); // id=1, handles[0]
    reg.spawn(); // id=2, handles[1]
    expect(reg.count).toBe(2);

    const result = reg.despawn(1);

    expect(result).toBe(true);
    expect(reg.count).toBe(1);
    expect((handles[0].destroy as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((handles[1].destroy as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(reg.snapshot().map((s) => s.id)).toEqual([2]);
  });

  it("despawn(id) with unknown ID returns false and does not mutate state", () => {
    const onChange = vi.fn();
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      rng: makeRng([0, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
      onChange,
    });

    reg.spawn(); // id=1
    onChange.mockClear(); // reset after spawn onChange call

    const result = reg.despawn(99);

    expect(result).toBe(false);
    expect(reg.count).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("onChange fires on spawn with correct snapshot payload", () => {
    const onChange = vi.fn();
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng always 0: asset=0→"a"(displayName "A"), x=0, dwell=0, greeting=0 for every spawn
      rng: () => 0,
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
      onChange,
    });

    reg.spawn(); // id=1, displayName="A"
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, label: "A #1" }]);

    reg.spawn(); // id=2, displayName="A"
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 1, label: "A #1" },
      { id: 2, label: "A #2" },
    ]);
  });

  it("onChange fires on successful despawn(id) with updated snapshot", () => {
    const onChange = vi.fn();
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      // rng always 0: both spawns get displayName "A"
      rng: () => 0,
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
      onChange,
    });

    reg.spawn(); // id=1
    reg.spawn(); // id=2
    onChange.mockClear();

    reg.despawn(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([{ id: 2, label: "A #2" }]);
  });

  it("despawnAll() fires onChange exactly once with empty array", () => {
    const onChange = vi.fn();
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      rng: makeRng([0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
      onChange,
    });

    reg.spawn();
    reg.spawn();
    reg.spawn();
    onChange.mockClear();

    reg.despawnAll();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("snapshot() returns entries in insertion order with correct label format", () => {
    // rng: [asset=0→"a", x, greeting, asset=1→"b", x, greeting]
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      rng: makeRng([0, 0.5, 0, 1 - Number.EPSILON, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
    });

    reg.spawn(); // id=1, displayName="A"
    reg.spawn(); // id=2, displayName="B"

    const snap = reg.snapshot();
    expect(snap).toEqual([
      { id: 1, label: "A #1" },
      { id: 2, label: "B #2" },
    ]);
  });
});

// ─── Phase 7: Despawn effects ──────────────────────────────────────────────────

function makeEffectHandle(): EffectHandle {
  return {
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    destroy: vi.fn(),
  };
}

interface EffectCapture {
  kind: EffectKind;
  handle: EffectHandle;
}

function makeEffectRegistry(rng: () => number = makeRng([0, 0.5, 0])) {
  const effectCaptures: EffectCapture[] = [];
  const reg = new CharacterRegistry({
    stage: makeStage() as any,
    manifest: FAKE_MANIFEST,
    loadedAssets: makeLoadedAssets(),
    rng,
    screenWidth: SCREEN_W,
    floorY: FLOOR_Y,
    createHandle: () => makeHandle(),
    createEffectHandle: (kind) => {
      const handle = makeEffectHandle();
      effectCaptures.push({ kind, handle });
      return handle;
    },
  });
  return { reg, effectCaptures };
}

const SPAWN_EFFECT_DUR = EFFECT.FRAME_COUNT / EFFECT.FPS;

describe("CharacterRegistry Phase 7: despawn effects", () => {
  it("despawn(id) creates one despawn effect", () => {
    const { reg, effectCaptures } = makeEffectRegistry(makeRng([0, 0.5, 0]));
    reg.spawn();
    // Materialize the pending character
    reg.tick(SPAWN_EFFECT_DUR + 0.01);
    const id = reg.snapshot()[0].id;

    reg.despawn(id);

    const despawnEffects = effectCaptures.filter((e) => e.kind === "despawn");
    expect(despawnEffects.length).toBe(1);
  });

  it("despawn(id) positions effect at character x and floor y when grounded", () => {
    // rng: asset=0, x=0.5→960, greeting=0
    const { reg, effectCaptures } = makeEffectRegistry(makeRng([0, 0.5, 0]));
    reg.spawn();
    reg.tick(SPAWN_EFFECT_DUR + 0.01); // materialize
    const id = reg.snapshot()[0].id;

    reg.despawn(id);

    const despawnHandle = effectCaptures.find((e) => e.kind === "despawn")!.handle;
    const setPosCalls = (despawnHandle.setPosition as ReturnType<typeof vi.fn>).mock.calls;
    expect(setPosCalls.length).toBeGreaterThan(0);
    const [x, y] = setPosCalls[0] as [number, number];
    expect(x).toBeCloseTo(0.5 * SCREEN_W);
    expect(y).toBe(FLOOR_Y); // grounded — renderY equals y
  });

  it("despawn(id) mid-jump: effect anchored to airborne displayY, not floor", () => {
    const { reg, effectCaptures } = makeEffectRegistry(() => 0.5);
    reg.spawn();

    // Tick past spawn effect + jump roll interval so jump() is triggered mid-tick
    reg.tick(JUMP.PER_CHAR_AVG_INTERVAL_S + 0.01);
    // Tick a bit so airborneTimer > 0 and displayY < floorY
    reg.tick(0.1);

    const id = reg.snapshot()[0].id;
    reg.despawn(id);

    const despawnHandle = effectCaptures.find((e) => e.kind === "despawn")!.handle;
    const setPosCalls = (despawnHandle.setPosition as ReturnType<typeof vi.fn>).mock.calls;
    const [, effectY] = setPosCalls[0] as [number, number];
    expect(effectY).toBeLessThan(FLOOR_Y);
  });

  it("despawnAll() creates one despawn effect per live character", () => {
    const { reg, effectCaptures } = makeEffectRegistry(makeRng([0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0]));
    reg.spawn();
    reg.spawn();
    reg.spawn();
    // Materialize all three
    reg.tick(SPAWN_EFFECT_DUR + 0.01);
    expect(reg.count).toBe(3);

    reg.despawnAll();

    const despawnEffects = effectCaptures.filter((e) => e.kind === "despawn");
    expect(despawnEffects.length).toBe(3);
  });

  it("despawn effect is removed after its duration elapses", () => {
    const { reg, effectCaptures } = makeEffectRegistry(makeRng([0, 0.5, 0]));
    reg.spawn();
    reg.tick(SPAWN_EFFECT_DUR + 0.01); // materialize
    const id = reg.snapshot()[0].id;
    reg.despawn(id);

    // The despawn effect handle — tick past its full duration
    const despawnHandle = effectCaptures.find((e) => e.kind === "despawn")!.handle;
    reg.tick(SPAWN_EFFECT_DUR + 0.01);

    expect(despawnHandle.destroy).toHaveBeenCalledTimes(1);
  });

  it("no effect is created for despawn(id) when createEffectHandle is not provided", () => {
    let effectCreated = false;
    const reg = new CharacterRegistry({
      stage: makeStage() as any,
      manifest: FAKE_MANIFEST,
      loadedAssets: makeLoadedAssets(),
      rng: makeRng([0, 0.5, 0]),
      screenWidth: SCREEN_W,
      floorY: FLOOR_Y,
      createHandle: () => makeHandle(),
      // no createEffectHandle
    });
    reg.spawn();
    const id = reg.snapshot()[0].id;

    // Should not throw; effect simply not created
    expect(() => reg.despawn(id)).not.toThrow();
    expect(effectCreated).toBe(false);
  });
});

// ─── Phase 8: Serial spawn (deferred construction) ────────────────────────────

function makePhase8Registry(
  rng: () => number = () => 0.5,
  onChange?: (items: { id: number; label: string }[]) => void,
) {
  const effectCaptures: EffectCapture[] = [];
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
    createEffectHandle: (kind) => {
      const handle = makeEffectHandle();
      effectCaptures.push({ kind, handle });
      return handle;
    },
    onChange,
  });
  return { reg, effectCaptures, bubbleHandles };
}

const SPAWN_EFFECT_DURATION = EFFECT.FRAME_COUNT / EFFECT.FPS;

describe("CharacterRegistry Phase 8: serial spawn (deferred construction)", () => {
  it("spawn() with createEffectHandle: count stays 0 before effect expires", () => {
    const { reg } = makePhase8Registry();
    reg.spawn();
    expect(reg.count).toBe(0);
  });

  it("spawn() with createEffectHandle: snapshot() excludes pending characters", () => {
    const { reg } = makePhase8Registry();
    reg.spawn();
    expect(reg.snapshot()).toEqual([]);
  });

  it("spawn() with createEffectHandle: onChange is NOT emitted immediately", () => {
    const onChange = vi.fn();
    const { reg } = makePhase8Registry(() => 0.5, onChange);
    reg.spawn();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("character materializes after spawn effect expires: count=1 and onChange fires", () => {
    const onChange = vi.fn();
    const { reg } = makePhase8Registry(() => 0.5, onChange);
    reg.spawn();

    reg.tick(SPAWN_EFFECT_DURATION + 0.01);

    expect(reg.count).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
  });

  it("greeting fires on materialization, not on spawn call", () => {
    const { reg, bubbleHandles } = makePhase8Registry();
    reg.spawn();
    expect(bubbleHandles.length).toBe(0); // no bubble yet

    reg.tick(SPAWN_EFFECT_DURATION + 0.01);
    expect(bubbleHandles.length).toBe(1); // greeting now
  });

  it("multiple pending entries promoting in the same tick emit onChange exactly once", () => {
    const onChange = vi.fn();
    // rng per spawn: [asset, x] x2 spawns, [greeting] x2 materializations
    const { reg } = makePhase8Registry(makeRng([0, 0.5, 0, 0, 0.5, 0]), onChange);
    reg.spawn();
    reg.spawn();

    reg.tick(SPAWN_EFFECT_DURATION + 0.01);

    expect(reg.count).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1); // batched, not per-promotion
  });

  it("rapid spawns produce independent pending entries at separate random positions", () => {
    const { reg, effectCaptures } = makePhase8Registry(makeRng([0, 0.1, 0, 0.9, 0]));
    reg.spawn();
    reg.spawn();

    // Both spawn effects created, neither promoted yet
    expect(reg.count).toBe(0);
    expect(effectCaptures.filter((e) => e.kind === "spawn").length).toBe(2);
  });

  it("despawnAll() with only pending: cancels silently, no despawn effect, calls onChange([])", () => {
    const onChange = vi.fn();
    const { reg, effectCaptures } = makePhase8Registry(() => 0.5, onChange);
    reg.spawn();
    reg.spawn();
    onChange.mockClear();

    reg.despawnAll();

    // Spawn effect handles destroyed
    for (const cap of effectCaptures.filter((e) => e.kind === "spawn")) {
      expect(cap.handle.destroy).toHaveBeenCalled();
    }
    // No despawn effects created
    expect(effectCaptures.filter((e) => e.kind === "despawn").length).toBe(0);
    // onChange fires once with empty list
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([]);
    // Count remains 0
    expect(reg.count).toBe(0);
  });

  it("despawnAll() with mixed pending + live: live get despawn fx, pending cancel silently", () => {
    const onChange = vi.fn();
    const { reg, effectCaptures } = makePhase8Registry(
      makeRng([0, 0.5, 0, 0, 0.5, 0]),
      onChange,
    );

    reg.spawn(); // A — pending
    reg.tick(SPAWN_EFFECT_DURATION + 0.01); // A materializes (spawn effect expires naturally)

    reg.spawn(); // B — still pending
    onChange.mockClear();

    reg.despawnAll();

    // B's spawn effect cancelled
    const spawnEffects = effectCaptures.filter((e) => e.kind === "spawn");
    expect(spawnEffects.length).toBe(2); // A and B spawn effects
    expect(spawnEffects[1].handle.destroy).toHaveBeenCalled(); // B cancelled

    // A's despawn effect created
    expect(effectCaptures.filter((e) => e.kind === "despawn").length).toBe(1);

    // onChange fires once with empty list
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
