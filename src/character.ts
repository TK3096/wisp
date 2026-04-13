import { IDLE_FPS } from "./config";

export type Facing = "right" | "left";
export type CharacterState = "idle";

export interface CharacterHandle {
  setTexture(frameIndex: number): void;
  setPosition(x: number, y: number): void;
  setFlip(facingLeft: boolean): void;
  destroy(): void;
}

export interface CharacterOptions {
  x: number;
  y: number;
  facing: Facing;
  handle: CharacterHandle;
}

export class Character {
  x: number;
  y: number;
  facing: Facing;
  readonly state: CharacterState = "idle";

  private frameIndex = 0;
  private frameTimer = 0;
  private readonly handle: CharacterHandle;
  private readonly idleFrameCount: number;

  constructor(opts: CharacterOptions, idleFrameCount: number) {
    this.x = opts.x;
    this.y = opts.y;
    this.facing = opts.facing;
    this.handle = opts.handle;
    this.idleFrameCount = idleFrameCount;

    this.handle.setPosition(this.x, this.y);
    this.handle.setFlip(this.facing === "left");
    this.handle.setTexture(this.frameIndex);
  }

  /** Advance animation by dt seconds. */
  tick(dt: number): void {
    this.frameTimer += dt;
    const frameDuration = 1 / IDLE_FPS;
    while (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.frameIndex = (this.frameIndex + 1) % this.idleFrameCount;
    }
    this.handle.setTexture(this.frameIndex);
  }

  destroy(): void {
    this.handle.destroy();
  }
}
