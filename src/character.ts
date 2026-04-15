import {
  IDLE_FPS,
  WALK_FPS,
  WALK_SPEED_PX_S,
  IDLE_DWELL_MS_MIN,
  IDLE_DWELL_MS_MAX,
  WALK_DWELL_MS_MIN,
  WALK_DWELL_MS_MAX,
  BUBBLE,
  JUMP,
} from "./config";
import { Bubble } from "./bubble";

export type Facing = "right" | "left";
export type CharacterState = "idle" | "walk";


export interface CharacterHandle {
  setAnimation(anim: CharacterState): void;
  setTexture(frameIndex: number): void;
  setPosition(x: number, y: number): void;
  setFlip(facingLeft: boolean): void;
  /** Push an airborne sprite override. null = clear; next setTexture call from ground tick restores the ground frame. */
  setAirborneSprite(kind: "jump" | "fall" | null): void;
  destroy(): void;
}

export interface CharacterOptions {
  x: number;
  y: number;
  facing: Facing;
  handle: CharacterHandle;
}

export interface CharacterConfig {
  idleFps: number;
  walkFps: number;
  walkSpeedPxS: number;
  idleDwellMsMin: number;
  idleDwellMsMax: number;
  walkDwellMsMin: number;
  walkDwellMsMax: number;
  floorLeft: number;
  floorRight: number;
  rng: () => number;
  /** Factory for creating a Bubble. Undefined → say() is a no-op (used in tests). */
  createBubble?: (text: string) => Bubble;
}

const DEFAULT_CONFIG: CharacterConfig = {
  idleFps: IDLE_FPS,
  walkFps: WALK_FPS,
  walkSpeedPxS: WALK_SPEED_PX_S,
  idleDwellMsMin: IDLE_DWELL_MS_MIN,
  idleDwellMsMax: IDLE_DWELL_MS_MAX,
  walkDwellMsMin: WALK_DWELL_MS_MIN,
  walkDwellMsMax: WALK_DWELL_MS_MAX,
  floorLeft: 0,
  floorRight: 1920,
  rng: Math.random,
};

export class Character {
  x: number;
  y: number;
  facing: Facing;
  state: CharacterState = "idle";

  private frameIndex = 0;
  private frameTimer = 0;
  private dwellTimer: number;
  private walkTargetX = 0;
  private bubble: Bubble | null = null;

  /** Render-only Y; equals y when grounded, arcs above y while airborne. */
  private displayY: number;
  private _airborne = false;
  private airborneTimer = 0;

  private readonly handle: CharacterHandle;
  private readonly idleFrameCount: number;
  private readonly walkFrameCount: number;
  private readonly cfg: CharacterConfig;

  constructor(
    opts: CharacterOptions,
    idleFrameCount: number,
    walkFrameCount = 12,
    cfg: Partial<CharacterConfig> = {}
  ) {
    this.x = opts.x;
    this.y = opts.y;
    this.displayY = opts.y;
    this.facing = opts.facing;
    this.handle = opts.handle;
    this.idleFrameCount = idleFrameCount;
    this.walkFrameCount = walkFrameCount;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };

    this.dwellTimer = this.randomDwell("idle");

    this.handle.setAnimation("idle");
    this.handle.setPosition(this.x, this.displayY);
    this.handle.setFlip(this.facing === "left");
    this.handle.setTexture(this.frameIndex);
  }

  get airborne(): boolean {
    return this._airborne;
  }

  /** The rendered y position — equals y when grounded, arcs above y while airborne. */
  get renderY(): number {
    return this.displayY;
  }

  /**
   * Trigger a jump. No-op if already airborne.
   * Can be called imperatively by external systems (registry, events, etc.).
   */
  jump(): void {
    if (this._airborne) return;
    this._airborne = true;
    this.airborneTimer = 0;
  }

  /**
   * Display a speech bubble with the given text.
   * No-op if a bubble is already active (skip-while-active rule).
   * No-op if no createBubble factory was injected.
   */
  say(text: string): void {
    if (this.bubble !== null) return;
    if (!this.cfg.createBubble) return;
    this.bubble = this.cfg.createBubble(text);
    this.bubble.setPosition(this.x, this.y + BUBBLE.OFFSET_Y_PX);
  }

  tick(dt: number): void {
    if (this.state === "idle") {
      this.tickIdle(dt);
    } else {
      this.tickWalk(dt);
    }
    if (this._airborne) this.tickAirborne(dt);
    this.tickBubble(dt);
  }

  private tickAirborne(dt: number): void {
    this.airborneTimer += dt;

    if (this.airborneTimer >= JUMP.DURATION_S) {
      this._airborne = false;
      this.airborneTimer = 0;
      this.displayY = this.y;
      this.handle.setAirborneSprite(null);
      this.handle.setPosition(this.x, this.displayY);
      return;
    }

    const t = this.airborneTimer / JUMP.DURATION_S;
    this.displayY = this.y - JUMP.PEAK_HEIGHT_PX * 4 * t * (1 - t);
    this.handle.setAirborneSprite(t < JUMP.RISE_FRACTION ? "jump" : "fall");
    this.handle.setPosition(this.x, this.displayY);
  }

  private tickBubble(dt: number): void {
    if (!this.bubble) return;
    this.bubble.tick(dt);
    if (this.bubble.expired) {
      this.bubble = null;
      return;
    }
    this.bubble.setPosition(this.x, this.displayY + BUBBLE.OFFSET_Y_PX);
  }

  private tickIdle(dt: number): void {
    this.advanceFrame(dt, this.cfg.idleFps, this.idleFrameCount);
    this.dwellTimer -= dt;
    if (this.dwellTimer <= 0) {
      this.enterWalk();
    }
  }

  private tickWalk(dt: number): void {
    this.advanceFrame(dt, this.cfg.walkFps, this.walkFrameCount);

    const { walkSpeedPxS, floorLeft, floorRight } = this.cfg;
    const dir = this.walkTargetX > this.x ? 1 : -1;
    const step = walkSpeedPxS * dt;
    const remaining = Math.abs(this.walkTargetX - this.x);

    if (remaining <= step) {
      this.x = Math.max(floorLeft, Math.min(floorRight, this.walkTargetX));
      this.handle.setPosition(this.x, this.y);
      this.enterIdle();
    } else {
      this.x = Math.max(floorLeft, Math.min(floorRight, this.x + dir * step));
      this.handle.setPosition(this.x, this.y);
    }
  }

  private enterWalk(): void {
    const { floorLeft, floorRight, rng } = this.cfg;
    this.walkTargetX = floorLeft + rng() * (floorRight - floorLeft);
    this.facing = this.walkTargetX < this.x ? "left" : "right";
    this.state = "walk";
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.handle.setAnimation("walk");
    this.handle.setFlip(this.facing === "left");
  }

  private enterIdle(): void {
    this.state = "idle";
    this.dwellTimer = this.randomDwell("idle");
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.handle.setAnimation("idle");
  }

  private randomDwell(state: "idle" | "walk"): number {
    const { idleDwellMsMin, idleDwellMsMax, walkDwellMsMin, walkDwellMsMax, rng } = this.cfg;
    const [min, max] =
      state === "idle"
        ? [idleDwellMsMin, idleDwellMsMax]
        : [walkDwellMsMin, walkDwellMsMax];
    return (min + rng() * (max - min)) / 1000;
  }

  private advanceFrame(dt: number, fps: number, frameCount: number): void {
    this.frameTimer += dt;
    const frameDuration = 1 / fps;
    while (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.frameIndex = (this.frameIndex + 1) % frameCount;
    }
    this.handle.setTexture(this.frameIndex);
  }

  destroy(): void {
    this.bubble?.destroy();
    this.bubble = null;
    this.handle.destroy();
  }
}
