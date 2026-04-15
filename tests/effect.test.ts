import { describe, it, expect, vi } from "vitest";
import { Effect, EffectHandle } from "../src/effect";

const FPS = 10;         // 100ms per frame
const FRAME_COUNT = 7;  // 7 frames → expires after 0.7s

function makeHandle(): EffectHandle {
  return {
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    destroy: vi.fn(),
  };
}

function makeEffect(handle: EffectHandle = makeHandle()): Effect {
  return new Effect(handle, FPS, FRAME_COUNT);
}

// ─── Construction ─────────────────────────────────────────────────────────────

describe("Effect construction", () => {
  it("sets frame 0 on the handle immediately", () => {
    const h = makeHandle();
    makeEffect(h);
    expect(h.setTexture).toHaveBeenCalledWith(0);
  });

  it("is not expired on construction", () => {
    const e = makeEffect();
    expect(e.expired).toBe(false);
  });

  it("setPosition proxies to handle", () => {
    const h = makeHandle();
    const e = makeEffect(h);
    e.setPosition(100, 200);
    expect(h.setPosition).toHaveBeenCalledWith(100, 200);
  });
});

// ─── Frame progression ────────────────────────────────────────────────────────

describe("Effect frame progression", () => {
  it("advances frame after one frame duration", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.tick(1 / FPS); // exactly one frame duration

    const calls = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls;
    const lastFrame = calls[calls.length - 1][0] as number;
    expect(lastFrame).toBe(1);
    expect(e.expired).toBe(false);
  });

  it("advances multiple frames when dt spans several frame durations", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    // Use 3.5 frames worth of dt to avoid float precision issues with exact multiples
    e.tick(3.5 / FPS);

    const calls = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls;
    const lastFrame = calls[calls.length - 1][0] as number;
    expect(lastFrame).toBe(3);
    expect(e.expired).toBe(false);
  });

  it("does not call setTexture when dt is less than one frame duration", () => {
    const h = makeHandle();
    const e = makeEffect(h);
    // setTexture(0) already called on construction — record count now
    const callsBefore = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls.length;

    e.tick(0.5 / FPS); // half a frame duration — no frame advance

    const callsAfter = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore); // no new setTexture call
    expect(e.expired).toBe(false);
  });
});

// ─── Expiry ───────────────────────────────────────────────────────────────────

describe("Effect expiry", () => {
  it("expires exactly at the boundary frame (frame FRAME_COUNT)", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    // Tick to just before the last frame completes
    e.tick((FRAME_COUNT - 1) / FPS + 0.001);
    expect(e.expired).toBe(false);

    // Tick past the final frame boundary
    e.tick(1 / FPS);
    expect(e.expired).toBe(true);
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("expires when a single large dt covers all frames", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.tick(100); // way past all frames

    expect(e.expired).toBe(true);
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("expired effect ignores further tick() calls", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.tick(100);
    expect(e.expired).toBe(true);
    const destroyCalls = (h.destroy as ReturnType<typeof vi.fn>).mock.calls.length;

    e.tick(1);

    expect(h.destroy).toHaveBeenCalledTimes(destroyCalls); // no extra destroy
  });

  it("expired effect does not call setTexture after the last frame", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.tick(FRAME_COUNT / FPS + 1); // expire
    const callsAtExpiry = (h.setTexture as ReturnType<typeof vi.fn>).mock.calls.length;

    e.tick(1); // extra tick on expired effect
    expect((h.setTexture as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtExpiry);
  });
});

// ─── Manual destroy ───────────────────────────────────────────────────────────

describe("Effect.destroy()", () => {
  it("marks expired and calls handle.destroy", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.destroy();

    expect(e.expired).toBe(true);
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — handle.destroy called only once", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.destroy();
    e.destroy();

    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("already-expired effect does not re-call handle.destroy", () => {
    const h = makeHandle();
    const e = makeEffect(h);

    e.tick(100); // expire via tick
    const callsAtExpiry = (h.destroy as ReturnType<typeof vi.fn>).mock.calls.length;

    e.destroy(); // should be no-op
    expect(h.destroy).toHaveBeenCalledTimes(callsAtExpiry);
  });
});
