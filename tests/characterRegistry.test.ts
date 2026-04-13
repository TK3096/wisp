import { describe, it, expect, vi } from "vitest";
import { CharacterRegistry, SpawnContext } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";

// --- Fakes ---

function makeHandle(): CharacterHandle {
  return {
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
      rng: makeRng([0, 0.5]),
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
      rng: makeRng([0, 0.1, 0, 0.5, 0, 0.9]),
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
      // each spawn: first rng() call selects asset, second selects x
      rng: makeRng([0.0, 0.5, 1 - Number.EPSILON, 0.5]),
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
      rng: makeRng([0, 0, 0, 0.25, 0, 0.5, 0, 0.75, 0, 1 - Number.EPSILON]),
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
      rng: makeRng([0, 0.3, 0, 0.7]),
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
      rng: makeRng([0, 0.5]),
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
