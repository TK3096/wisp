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
 * Lifecycle: typing phase (chars revealed at TYPING_SPEED_CPS), then linger phase
 * (fully typed text held for LINGER_S), then expired = true and handle destroyed.
 * Total lifetime is capped at MAX_DURATION_S.
 *
 * Background is pre-sized to the full text at construction — only setVisibleChars
 * changes during typing, never the geometry. This keeps per-frame cost O(1).
 */
export class Bubble {
  readonly text: string;
  /** True once the bubble's lifetime has elapsed and it should be removed. */
  expired = false;

  private readonly handle: BubbleHandle;
  private elapsed = 0;
  private visibleChars = 0;
  private readonly typingDuration: number;
  private readonly totalDuration: number;

  constructor(
    text: string,
    handle: BubbleHandle,
    typingSpeedCps: number,
    lingerS: number,
    maxDurationS: number,
  ) {
    this.text = text;
    this.handle = handle;
    // Guard against zero-length text to avoid division by zero.
    this.typingDuration = text.length > 0 ? text.length / typingSpeedCps : 0;
    this.totalDuration = Math.min(this.typingDuration + lingerS, maxDurationS);
    handle.setText(text);
    handle.setVisibleChars(0); // typing starts from 0
  }

  /** Advance the bubble by dt seconds. Updates visible chars and checks lifetime. */
  tick(dt: number): void {
    if (this.expired) return;
    this.elapsed += dt;

    // Typing phase: reveal characters proportionally to elapsed time.
    if (this.typingDuration > 0) {
      const newVisible = Math.min(
        Math.ceil((this.elapsed / this.typingDuration) * this.text.length),
        this.text.length,
      );
      if (newVisible !== this.visibleChars) {
        this.visibleChars = newVisible;
        this.handle.setVisibleChars(this.visibleChars);
      }
    } else {
      // Zero-length text: show immediately.
      if (this.visibleChars === 0) {
        this.visibleChars = 0;
        this.handle.setVisibleChars(0);
      }
    }

    if (this.elapsed >= this.totalDuration) {
      this.expired = true;
      this.handle.destroy();
    }
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
