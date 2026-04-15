/**
 * EffectHandle — test seam between the pure-logic Effect class and the Pixi
 * rendering layer. No Pixi imports here; the concrete implementation lives in
 * characterRegistry.ts (or main.ts wiring).
 */
export interface EffectHandle {
  setTexture(frameIndex: number): void;
  setPosition(x: number, y: number): void;
  destroy(): void;
}

export type EffectKind = "spawn" | "despawn";

/**
 * Pure-logic one-shot animated effect. No Pixi imports — all rendering
 * delegated to EffectHandle.
 *
 * Lifecycle: advances through frameCount frames at fps. After the last frame
 * the effect is expired and the handle is destroyed.
 */
export class Effect {
  /** True once all frames have played and the handle has been destroyed. */
  expired = false;

  private readonly handle: EffectHandle;
  private readonly fps: number;
  private readonly frameCount: number;
  private frameIndex = 0;
  private frameTimer = 0;

  constructor(handle: EffectHandle, fps: number, frameCount: number) {
    this.handle = handle;
    this.fps = fps;
    this.frameCount = frameCount;
    handle.setTexture(0);
  }

  setPosition(x: number, y: number): void {
    this.handle.setPosition(x, y);
  }

  tick(dt: number): void {
    if (this.expired) return;

    this.frameTimer += dt;
    const frameDuration = 1 / this.fps;

    while (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.frameIndex++;
      if (this.frameIndex >= this.frameCount) {
        this.expired = true;
        this.handle.destroy();
        return;
      }
      this.handle.setTexture(this.frameIndex);
    }
  }

  destroy(): void {
    if (!this.expired) {
      this.expired = true;
      this.handle.destroy();
    }
  }
}
