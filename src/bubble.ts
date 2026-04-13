/**
 * BubbleHandle — the test seam between the pure-logic Bubble class and
 * the Pixi rendering layer. Mirrors CharacterHandle's pattern: no Pixi
 * imports here; the concrete implementation lives in characterRegistry.ts.
 */
export interface BubbleHandle {
  setText(text: string): void;
  setVisibleChars(n: number): void;
  setPosition(x: number, y: number): void;
  destroy(): void;
}

/**
 * Pure-logic speech bubble. No Pixi imports — all rendering delegated to BubbleHandle.
 *
 * Phase 1: shows all text immediately; never expires (tick is a no-op).
 * Phase 2: tick() gains typing animation and lifetime logic.
 */
export class Bubble {
  readonly text: string;
  /** Set to true when the bubble's lifetime has elapsed and it should be removed. */
  expired = false;

  private readonly handle: BubbleHandle;

  constructor(text: string, handle: BubbleHandle) {
    this.text = text;
    this.handle = handle;
    handle.setText(text);
    handle.setVisibleChars(text.length); // Phase 1: show all chars immediately
  }

  /** Advance the bubble by dt seconds. Typing animation and lifetime added in Phase 2. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tick(_dt: number): void {
    // no-op in Phase 1 — typing animation implemented in Phase 2
  }

  setPosition(x: number, y: number): void {
    this.handle.setPosition(x, y);
  }

  destroy(): void {
    if (!this.expired) {
      this.expired = true;
      this.handle.destroy();
    }
  }
}
