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

// --- Helpers ---

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

describe("Bubble", () => {
  it("constructor wires text into the handle immediately", () => {
    const h = makeBubbleHandle();
    const b = new Bubble("hi!", h);

    expect(h.setText).toHaveBeenCalledWith("hi!");
    expect(h.setVisibleChars).toHaveBeenCalledWith(3); // all chars shown
    expect(b.text).toBe("hi!");
    expect(b.expired).toBe(false);
  });

  it("setPosition proxies to handle", () => {
    const h = makeBubbleHandle();
    const b = new Bubble("yo", h);
    b.setPosition(100, 200);
    expect(h.setPosition).toHaveBeenCalledWith(100, 200);
  });

  it("destroy calls handle.destroy and sets expired", () => {
    const h = makeBubbleHandle();
    const b = new Bubble("hey", h);
    b.destroy();
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(b.expired).toBe(true);
  });

  it("destroy is idempotent — handle.destroy called only once", () => {
    const h = makeBubbleHandle();
    const b = new Bubble("hey", h);
    b.destroy();
    b.destroy();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("tick is a no-op in Phase 1 — expired stays false", () => {
    const h = makeBubbleHandle();
    const b = new Bubble("zzz", h);
    // Tick well past any reasonable duration
    b.tick(100);
    expect(b.expired).toBe(false);
  });
});

// ─── Character.say() tests ────────────────────────────────────────────────────

describe("Character.say()", () => {
  it("no-op when createBubble is not provided", () => {
    const c = makeCharacter(undefined);
    // Should not throw
    c.say("hi");
  });

  it("creates a bubble via the injected factory", () => {
    const bh = makeBubbleHandle();
    let created = 0;
    const createBubble = (text: string): Bubble => {
      created++;
      return new Bubble(text, bh);
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
      return new Bubble(text, bh);
    };

    const c = makeCharacter(createBubble);
    c.say("first");
    c.say("second"); // should be skipped
    expect(created).toBe(1);
    // The handle text was set only for the first bubble
    expect(bh.setText).toHaveBeenCalledTimes(1);
    expect(bh.setText).toHaveBeenCalledWith("first");
  });

  it("bubble position is set to character position + BUBBLE offset on creation", () => {
    const bh = makeBubbleHandle();
    const createBubble = (text: string): Bubble => new Bubble(text, bh);

    const c = makeCharacter(createBubble);
    c.say("hi");

    // setPosition should have been called with character x=500 and y offset applied
    const calls = (bh.setPosition as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0][0]).toBe(500); // x matches character x
  });

  it("destroy() on character also destroys active bubble", () => {
    const bh = makeBubbleHandle();
    const createBubble = (text: string): Bubble => new Bubble(text, bh);

    const c = makeCharacter(createBubble);
    c.say("hi");
    c.destroy();

    expect(bh.destroy).toHaveBeenCalledTimes(1);
  });
});
