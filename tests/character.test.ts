import { describe, it, expect, vi } from "vitest";
import { Character, CharacterHandle } from "../src/character";

function makeHandle(): CharacterHandle {
  return {
    setAnimation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    setFlip: vi.fn(),
    destroy: vi.fn(),
  };
}

const IDLE_FRAME_COUNT = 11;
const WALK_FRAME_COUNT = 12;

// Config constants (must match src/config.ts)
const IDLE_FPS = 8;           // 125ms per frame
const WALK_FPS = 10;          // 100ms per frame
const WALK_SPEED_PX_S = 80;
const IDLE_DWELL_MS_MIN = 1500;
const IDLE_DWELL_MS_MAX = 4000;
const WALK_DWELL_MS_MIN = 1000;
const WALK_DWELL_MS_MAX = 3000;
const FLOOR_LEFT = 0;
const FLOOR_RIGHT = 1920;

function makeCharacter(
  handle: CharacterHandle,
  rng: () => number = () => 0.5,
  x = 500
): Character {
  return new Character(
    { x, y: 1016, facing: "right", handle },
    IDLE_FRAME_COUNT,
    WALK_FRAME_COUNT,
    {
      idleDwellMsMin: IDLE_DWELL_MS_MIN,
      idleDwellMsMax: IDLE_DWELL_MS_MAX,
      walkDwellMsMin: WALK_DWELL_MS_MIN,
      walkDwellMsMax: WALK_DWELL_MS_MAX,
      walkSpeedPxS: WALK_SPEED_PX_S,
      floorLeft: FLOOR_LEFT,
      floorRight: FLOOR_RIGHT,
      idleFps: IDLE_FPS,
      walkFps: WALK_FPS,
      rng,
    }
  );
}

describe("Character", () => {
  it("starts in idle state", () => {
    const h = makeHandle();
    const c = makeCharacter(h);
    expect(c.state).toBe("idle");
  });

  it("idle animation frame advances at IDLE_FPS and wraps at idleFrameCount", () => {
    const h = makeHandle();
    const c = makeCharacter(h);

    // Advance 11 full frames worth — should wrap back to 0
    const frameDuration = 1 / IDLE_FPS;
    for (let i = 0; i < IDLE_FRAME_COUNT; i++) {
      c.tick(frameDuration);
    }

    // After 11 frames we're back at 0; check the texture call
    const calls = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls;
    const lastFrame = calls[calls.length - 1][0] as number;
    expect(lastFrame).toBe(0);
  });

  it("transitions from idle to walk after idle dwell elapses", () => {
    const h = makeHandle();
    // rng() = 0.5 → dwell = min + 0.5*(max-min) = 1500 + 0.5*2500 = 2750 ms = 2.75 s
    const c = makeCharacter(h, () => 0.5);
    expect(c.state).toBe("idle");

    // Tick just under dwell — should stay idle
    c.tick(2.74);
    expect(c.state).toBe("idle");

    // Tick past dwell — should switch to walk
    c.tick(0.02);
    expect(c.state).toBe("walk");
  });

  it("picks a random walk target within floor bounds", () => {
    const h = makeHandle();
    // rng() first used for idle dwell (skip), then for walk target x
    // We can test that after transition the x is in [FLOOR_LEFT, FLOOR_RIGHT]
    let callCount = 0;
    const rng = () => {
      callCount++;
      return 0.5;
    };
    const c = makeCharacter(h, rng, 500);

    // Advance past idle dwell (2.75s for rng=0.5)
    c.tick(2.76);
    expect(c.state).toBe("walk");
    // x should be heading toward a valid target
    // Just verify position is still within bounds
    expect(c.x).toBeGreaterThanOrEqual(FLOOR_LEFT);
    expect(c.x).toBeLessThanOrEqual(FLOOR_RIGHT);
  });

  it("walking advances x toward the target at WALK_SPEED_PX_S", () => {
    const h = makeHandle();
    // rng = 0.5 → dwell 2.75s; walk target = 0.5 * 1920 = 960 (when starting at x=500, target is to the right)
    const c = makeCharacter(h, () => 0.5, 500);

    // Trigger walk transition
    c.tick(2.76);
    expect(c.state).toBe("walk");
    const xAfterTransition = c.x;

    // Walk for 1 second → should move ~80px toward target
    c.tick(1.0);
    const dx = c.x - xAfterTransition;
    // Target (960) is to the right of start (500), so dx should be positive ~80
    expect(Math.abs(dx)).toBeCloseTo(WALK_SPEED_PX_S, 0);
  });

  it("facing flips left when target is to the left, right when to the right", () => {
    const h = makeHandle();
    // rng=0.5 → target x = 960. Start at x=1500 (target is to the left)
    const c = makeCharacter(h, () => 0.5, 1500);

    c.tick(2.76); // trigger walk
    expect(c.state).toBe("walk");
    expect(c.facing).toBe("left");

    const flipCalls = (h.setFlip as ReturnType<typeof vi.fn>).mock.calls;
    const lastFlip = flipCalls[flipCalls.length - 1][0] as boolean;
    expect(lastFlip).toBe(true); // facingLeft = true
  });

  it("facing is right when target is to the right", () => {
    const h = makeHandle();
    // rng=0.5 → target x=960. Start at x=100 (target to the right)
    const c = makeCharacter(h, () => 0.5, 100);

    c.tick(2.76); // trigger walk
    expect(c.state).toBe("walk");
    expect(c.facing).toBe("right");
  });

  it("x never crosses bounds while walking", () => {
    const h = makeHandle();
    // rng=0 → target x=0 (left edge). Start near left edge
    const rng = vi.fn()
      .mockReturnValueOnce(0) // idle dwell → min
      .mockReturnValue(0);    // walk target → floor_left
    const c = makeCharacter(h, rng, 50);

    c.tick(IDLE_DWELL_MS_MIN / 1000 + 0.01); // trigger walk
    // Walk for a long time — should clamp at 0
    for (let i = 0; i < 100; i++) c.tick(0.1);
    expect(c.x).toBeGreaterThanOrEqual(FLOOR_LEFT);
  });

  it("returns to idle and resets dwell timer after reaching target", () => {
    const h = makeHandle();
    // rng=0.5 → idle dwell 2.75s, walk target=960
    const c = makeCharacter(h, () => 0.5, 959);

    c.tick(2.76); // → walk; target ~960, only 1px away
    expect(c.state).toBe("walk");

    // Walk 1 tick to reach/pass target (1px at 80px/s takes 0.0125s)
    c.tick(0.1);
    expect(c.state).toBe("idle");
  });

  it("walk animation advances at WALK_FPS", () => {
    const h = makeHandle();
    const c = makeCharacter(h, () => 0.5, 500);

    c.tick(2.76); // trigger walk
    expect(c.state).toBe("walk");

    const callsBefore = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls.length;
    // Advance 1 walk frame worth (100ms)
    c.tick(1 / WALK_FPS);
    const callsAfter = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("walk frame wraps at walkFrameCount", () => {
    const h = makeHandle();
    const c = makeCharacter(h, () => 0.5, 0);

    c.tick(2.76); // trigger walk; target=960, walking right
    // Advance 12 full walk frames
    for (let i = 0; i < WALK_FRAME_COUNT; i++) {
      c.tick(1 / WALK_FPS);
    }
    const calls = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls;
    const lastFrame = calls[calls.length - 1][0] as number;
    expect(lastFrame).toBe(0); // wrapped back to 0
  });
});
