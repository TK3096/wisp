import { describe, it, expect, vi } from "vitest";
import { Bubble, BubbleHandle } from "../src/bubble";
import { Character, CharacterHandle } from "../src/character";

// --- Fake BubbleHandle ---

function makeBubbleHandle(): BubbleHandle {
  return {
    setText: vi.fn(),
    setVisibleChars: vi.fn(),
    setPosition: vi.fn(),
    destroy: vi.fn(),
  };
}

// --- Fake CharacterHandle (mirrors character.test.ts) ---

function makeCharHandle(): CharacterHandle {
  return {
    setAnimation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    setFlip: vi.fn(),
    destroy: vi.fn(),
  };
}

// --- Bubble constructor helper ---

const TYPING_CPS = 25;    // 25 chars/sec → 40ms/char
const LINGER_S = 1.5;
const MAX_S = 5;

function makeBubble(text: string, handle: BubbleHandle): Bubble {
  return new Bubble(text, handle, TYPING_CPS, LINGER_S, MAX_S);
}

// --- Character helper ---

function makeCharacter(
  createBubble: ((text: string) => Bubble) | undefined = undefined,
): Character {
  return new Character(
    { x: 500, y: 1016, facing: "right", handle: makeCharHandle() },
    11,
    12,
    {
      idleFps: 8,
      walkFps: 10,
      walkSpeedPxS: 80,
      idleDwellMsMin: 1500,
      idleDwellMsMax: 4000,
      walkDwellMsMin: 1000,
      walkDwellMsMax: 3000,
      floorLeft: 0,
      floorRight: 1920,
      rng: () => 0.5,
      createBubble,
    },
  );
}

// ─── Bubble unit tests ───────────────────────────────────────────────────────

describe("Bubble construction", () => {
  it("wires full text into handle and starts at 0 visible chars", () => {
    const h = makeBubbleHandle();
    const b = makeBubble("hi!", h);

    expect(h.setText).toHaveBeenCalledWith("hi!");
    // Typing starts from 0
    expect(h.setVisibleChars).toHaveBeenCalledWith(0);
    expect(b.text).toBe("hi!");
    expect(b.expired).toBe(false);
  });

  it("setPosition proxies to handle", () => {
    const h = makeBubbleHandle();
    const b = makeBubble("yo", h);
    b.setPosition(100, 200);
    expect(h.setPosition).toHaveBeenCalledWith(100, 200);
  });

  it("destroy() calls handle.destroy and sets expired", () => {
    const h = makeBubbleHandle();
    const b = makeBubble("hey", h);
    b.destroy();
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(b.expired).toBe(true);
  });

  it("destroy() is idempotent — handle.destroy called only once", () => {
    const h = makeBubbleHandle();
    const b = makeBubble("hey", h);
    b.destroy();
    b.destroy();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("Bubble typing animation", () => {
  it("reveals chars proportionally to elapsed time", () => {
    const h = makeBubbleHandle();
    // "hello" = 5 chars. At 25 cps → typing takes 0.2s total.
    const b = makeBubble("hello", h);

    // After 0.08s: ceil(0.08/0.2 * 5) = ceil(2) = 2 chars
    b.tick(0.08);
    const calls = (h.setVisibleChars as ReturnType<typeof vi.fn>).mock.calls;
    const latestN = calls[calls.length - 1][0] as number;
    expect(latestN).toBe(2);
  });

  it("reaches full text length at end of typing phase", () => {
    const h = makeBubbleHandle();
    const text = "hello";
    const b = makeBubble(text, h);
    // Tick exactly to end of typing phase (5 chars / 25cps = 0.2s)
    b.tick(0.2);
    const calls = (h.setVisibleChars as ReturnType<typeof vi.fn>).mock.calls;
    const last = calls[calls.length - 1][0] as number;
    expect(last).toBe(text.length);
    // Still in linger — not expired yet
    expect(b.expired).toBe(false);
  });

  it("does not call setVisibleChars redundantly when chars haven't changed", () => {
    const h = makeBubbleHandle();
    // 4 chars at 25cps → typing = 0.16s. Each tick is 0.001s.
    const b = makeBubble("abcd", h);
    const callsBefore = (h.setVisibleChars as ReturnType<typeof vi.fn>).mock.calls.length;
    // Very small tick — should not advance past char 1 yet
    b.tick(0.001);
    b.tick(0.001);
    const callsAfter = (h.setVisibleChars as ReturnType<typeof vi.fn>).mock.calls.length;
    // At most one update fired across both ticks
    expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);
  });
});

describe("Bubble lifetime", () => {
  it("expires after typing + linger duration", () => {
    const h = makeBubbleHandle();
    const text = "hi!"; // 3 chars / 25cps = 0.12s typing
    const b = makeBubble(text, h);
    const expectedDuration = 3 / TYPING_CPS + LINGER_S; // 0.12 + 1.5 = 1.62s

    // Tick to just before expiry
    b.tick(expectedDuration - 0.01);
    expect(b.expired).toBe(false);

    // Tick past expiry
    b.tick(0.02);
    expect(b.expired).toBe(true);
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("respects MAX_DURATION_S cap for long text", () => {
    const h = makeBubbleHandle();
    // 200 chars at 25cps = 8s typing > MAX_S=5, so caps at 5s
    const text = "a".repeat(200);
    const b = makeBubble(text, h);

    b.tick(MAX_S - 0.01);
    expect(b.expired).toBe(false);

    b.tick(0.02);
    expect(b.expired).toBe(true);
  });

  it("expired bubble ignores further tick() calls", () => {
    const h = makeBubbleHandle();
    const b = makeBubble("hi", h);
    // Force expire
    b.tick(100);
    expect(b.expired).toBe(true);
    const destroyCalls = (h.destroy as ReturnType<typeof vi.fn>).mock.calls.length;
    // Extra tick should not call destroy again
    b.tick(1);
    expect(h.destroy).toHaveBeenCalledTimes(destroyCalls);
  });
});

// ─── Character.say() tests ────────────────────────────────────────────────────

describe("Character.say()", () => {
  it("no-op when createBubble is not provided", () => {
    const c = makeCharacter(undefined);
    c.say("hi"); // should not throw
  });

  it("creates a bubble via the injected factory", () => {
    const bh = makeBubbleHandle();
    let created = 0;
    const createBubble = (text: string): Bubble => {
      created++;
      return makeBubble(text, bh);
    };

    const c = makeCharacter(createBubble);
    c.say("hello!");
    expect(created).toBe(1);
  });

  it("second say() while bubble is active is a no-op (skip-while-active rule)", () => {
    const bh = makeBubbleHandle();
    let created = 0;
    const createBubble = (text: string): Bubble => {
      created++;
      return makeBubble(text, bh);
    };

    const c = makeCharacter(createBubble);
    c.say("first");
    c.say("second"); // should be skipped
    expect(created).toBe(1);
    expect(bh.setText).toHaveBeenCalledTimes(1);
    expect(bh.setText).toHaveBeenCalledWith("first");
  });

  it("bubble is cleared when it expires, allowing a new say() call", () => {
    const handles: BubbleHandle[] = [];
    const createBubble = (text: string): Bubble => {
      const bh = makeBubbleHandle();
      handles.push(bh);
      return makeBubble(text, bh);
    };

    const c = makeCharacter(createBubble);
    c.say("first");
    expect(handles.length).toBe(1);

    // Tick past bubble lifetime (typing 5chars/25cps=0.2s + linger 1.5s = 1.7s)
    for (let i = 0; i < 200; i++) c.tick(0.01); // 2.0s total
    expect(handles[0].destroy).toHaveBeenCalledTimes(1);

    // Now say() should work again
    c.say("second");
    expect(handles.length).toBe(2);
  });

  it("bubble position is set to character x with BUBBLE.OFFSET_Y_PX applied", () => {
    const bh = makeBubbleHandle();
    const createBubble = (text: string): Bubble => makeBubble(text, bh);

    const c = makeCharacter(createBubble);
    c.say("hi");

    const calls = (bh.setPosition as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0][0]).toBe(500); // x matches character x
  });

  it("destroy() on character also destroys active bubble", () => {
    const bh = makeBubbleHandle();
    const createBubble = (text: string): Bubble => makeBubble(text, bh);

    const c = makeCharacter(createBubble);
    c.say("hi");
    c.destroy();

    expect(bh.destroy).toHaveBeenCalledTimes(1);
  });
});
