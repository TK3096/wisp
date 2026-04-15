import { Sprite, Container, Texture, Graphics, Text } from "pixi.js";
import { AssetEntry, BUBBLE, EFFECT, GREETINGS, IDLE_LINES, JUMP } from "./config";
import {
  Character,
  CharacterHandle,
  CharacterConfig,
  CharacterState,
} from "./character";
import { BubbleHandle, Bubble } from "./bubble";
import { Effect, EffectHandle, EffectKind } from "./effect";
import { LoadedAsset } from "./spriteLoader";

const SPRITE_SCALE = 2;
const BUBBLE_FONT_SIZE = 12;
const BUBBLE_PADDING = 5;
const BUBBLE_TAIL_H = 6;

export function defaultCreateBubbleHandle(
  stage: Container,
  text: string,
): BubbleHandle {
  const pixiText = new Text({
    text,
    style: {
      fontFamily: '"Apple Color Emoji", monospace',
      fontSize: BUBBLE_FONT_SIZE,
      fill: "#222222",
    },
  });

  const bubbleW = Math.min(
    Math.max(pixiText.width + BUBBLE_PADDING * 2, 24),
    BUBBLE.MAX_WIDTH_PX,
  );
  const bubbleH = pixiText.height + BUBBLE_PADDING * 2;

  pixiText.x = BUBBLE_PADDING;
  pixiText.y = BUBBLE_PADDING;

  const gfx = new Graphics();
  // Bubble body: crisp rect with dark 1px border (pixel-art style, no smooth corners).
  gfx
    .rect(0, 0, bubbleW, bubbleH)
    .fill({ color: 0xf5f0e8 })
    .stroke({ color: 0x222222, width: 1 });
  // Downward tail centered below bubble.
  const tailX = Math.floor(bubbleW / 2);
  gfx
    .poly([
      tailX - 4,
      bubbleH,
      tailX + 4,
      bubbleH,
      tailX,
      bubbleH + BUBBLE_TAIL_H,
    ])
    .fill({ color: 0xf5f0e8 });

  const container = new Container();
  container.addChild(gfx);
  container.addChild(pixiText);
  // Pivot at tail tip so setPosition(charX, charY) anchors the tail to the character head.
  container.pivot.set(tailX, bubbleH + BUBBLE_TAIL_H);
  stage.addChild(container);

  // Code-point-safe character array so emoji (surrogate pairs) aren't split.
  const codepoints = Array.from(text);

  return {
    setText(t: string) {
      pixiText.text = t;
    },
    setVisibleChars(n: number) {
      pixiText.text = codepoints.slice(0, n).join("");
    },
    setPosition(x: number, y: number) {
      container.x = x;
      container.y = y;
    },
    destroy() {
      stage.removeChild(container);
      container.destroy({ children: true });
    },
  };
}

export interface SpawnContext {
  entry: AssetEntry;
  loaded: LoadedAsset;
  stage: Container;
  x: number;
  floorY: number;
}

export interface RegistryOptions {
  stage: Container;
  manifest: AssetEntry[];
  loadedAssets: Map<string, LoadedAsset>;
  rng: () => number;
  screenWidth: number;
  floorY: number;
  /**
   * Factory for creating a CharacterHandle.
   * Defaults to the real Pixi.js Sprite-based handle.
   * Override in tests to inject mocks.
   */
  createHandle?: (ctx: SpawnContext) => CharacterHandle;
  /**
   * Factory for creating a BubbleHandle given the stage and text.
   * When undefined, no bubble is injected and say() is a no-op.
   * Override in tests with a fake to avoid Pixi imports.
   */
  createBubbleHandle?: (stage: Container, text: string) => BubbleHandle;
  /**
   * Called after every mutation (spawn, despawn, despawnAll) with a full
   * snapshot of the live character list. Use to sync external state (e.g.
   * the Tauri tray submenu). Omit in tests or when no external sync needed.
   */
  onChange?: (items: { id: number; label: string }[]) => void;
  /**
   * Factory for creating an EffectHandle for a given kind (spawn/despawn).
   * When undefined, no visual effect is produced on spawn or despawn.
   * Override in tests with a fake to avoid Pixi imports.
   */
  createEffectHandle?: (kind: EffectKind) => EffectHandle;
}

function defaultCreateHandle({ loaded, stage }: SpawnContext): CharacterHandle {
  const sprite = loaded.idleTextures[0]
    ? new Sprite(loaded.idleTextures[0] as unknown as Texture)
    : new Sprite();

  sprite.scale.set(SPRITE_SCALE);
  sprite.anchor.set(0.5, 1);
  stage.addChild(sprite);

  let currentTextures: (Texture | null)[] = loaded.idleTextures;

  return {
    setAnimation(anim: CharacterState) {
      currentTextures =
        anim === "walk" ? loaded.walkTextures : loaded.idleTextures;
    },
    setTexture(frameIndex: number) {
      const tex = currentTextures[frameIndex];
      if (tex) sprite.texture = tex as unknown as Texture;
    },
    setPosition(x: number, y: number) {
      sprite.x = x;
      sprite.y = y;
    },
    setFlip(facingLeft: boolean) {
      sprite.scale.x = facingLeft ? -SPRITE_SCALE : SPRITE_SCALE;
    },
    setAirborneSprite(kind: "jump" | "fall" | null) {
      if (kind === "jump") sprite.texture = loaded.jumpTexture as unknown as Texture;
      else if (kind === "fall") sprite.texture = loaded.fallTexture as unknown as Texture;
      // null: no-op — next setTexture call from ground tick restores the ground frame
    },
    destroy() {
      stage.removeChild(sprite);
      sprite.destroy();
    },
  };
}

type ResolvedOptions = RegistryOptions & {
  createHandle: (ctx: SpawnContext) => CharacterHandle;
};

interface CharEntry {
  char: Character;
  id: number;
  displayName: string;
  /** Seconds until this character's next idle-line roll. */
  rollTimer: number;
  /** Seconds until this character's next jump roll. */
  jumpRollTimer: number;
}

interface PendingSpawn {
  entry: AssetEntry;
  loaded: LoadedAsset;
  x: number;
  effect: Effect;
}

export class CharacterRegistry {
  private readonly entries: CharEntry[] = [];
  private readonly effects: Effect[] = [];
  private readonly pending: PendingSpawn[] = [];
  private readonly opts: ResolvedOptions;
  /** Total elapsed seconds since the registry was created. */
  private elapsed = 0;
  /** Elapsed time at which the last bubble was emitted (idle rolls only). */
  private lastBubbleAt = -Infinity;
  /** Monotonically increasing ID counter; never resets within a session. */
  private nextId = 1;

  constructor(opts: RegistryOptions) {
    this.opts = { createHandle: defaultCreateHandle, ...opts };
  }

  get count(): number {
    return this.entries.length;
  }

  /** Returns the current live character list in insertion order. */
  snapshot(): { id: number; label: string }[] {
    return this.entries.map((e) => ({
      id: e.id,
      label: `${e.displayName} #${e.id}`,
    }));
  }

  /**
   * Removes the character with the given ID.
   * Returns true on success, false if the ID is not found (silent no-op).
   */
  despawn(id: number): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const { char } = this.entries[idx];
    const x = char.x;
    const y = char.renderY;
    char.destroy();
    this.entries.splice(idx, 1);
    this.pushEffect("despawn", x, y);
    this.opts.onChange?.(this.snapshot());
    return true;
  }

  spawn(): void {
    const { manifest, loadedAssets, rng, screenWidth, floorY, createEffectHandle } = this.opts;

    const entry = manifest[Math.floor(rng() * manifest.length)];
    const loaded = loadedAssets.get(entry.name)!;
    const x = rng() * screenWidth;

    if (createEffectHandle) {
      // Deferred: push to pending — Character constructed on effect expiry.
      const handle = createEffectHandle("spawn");
      const effect = new Effect(handle, EFFECT.FPS, EFFECT.FRAME_COUNT);
      effect.setPosition(x, floorY);
      this.pending.push({ entry, loaded, x, effect });
      // No onChange — character is not yet visible in the tray.
    } else {
      // Immediate: construct character now (backward-compat when no effect factory).
      this.materializeEntry(entry, loaded, x);
      this.opts.onChange?.(this.snapshot());
    }
  }

  /**
   * Construct a Character from resolved asset data, push it into entries[],
   * and fire a greeting bubble. Does NOT emit onChange — callers handle that.
   */
  private materializeEntry(entry: AssetEntry, loaded: LoadedAsset, x: number): void {
    const { rng, stage, floorY, screenWidth, createHandle, createBubbleHandle } = this.opts;

    const handle = createHandle({ entry, loaded, stage, x, floorY });

    const createBubble = createBubbleHandle
      ? (text: string): Bubble =>
          new Bubble(
            text,
            createBubbleHandle(stage, text),
            BUBBLE.TYPING_SPEED_CPS,
            BUBBLE.LINGER_S,
            BUBBLE.MAX_DURATION_S,
          )
      : undefined;

    const cfg: Partial<CharacterConfig> = {
      rng,
      floorLeft: 0,
      floorRight: screenWidth,
      createBubble,
    };

    const character = new Character(
      { x, y: floorY, facing: "right", handle },
      entry.idleFrames,
      entry.walkFrames,
      cfg,
    );

    // Greeting bypasses global cooldown — spawn always produces visual feedback.
    const greeting = GREETINGS[Math.floor(rng() * GREETINGS.length)];
    character.say(greeting);

    // Fixed initial roll timers so characters don't lock-step on the first roll.
    this.entries.push({
      char: character,
      id: this.nextId++,
      displayName: entry.displayName,
      rollTimer: BUBBLE.PER_CHAR_AVG_INTERVAL_S,
      jumpRollTimer: JUMP.PER_CHAR_AVG_INTERVAL_S,
    });
  }

  despawnAll(): void {
    // Cancel any pending spawns silently — no despawn effect for un-materialized characters.
    for (const p of this.pending) p.effect.destroy();
    this.pending.length = 0;

    for (const entry of this.entries) {
      const x = entry.char.x;
      const y = entry.char.renderY;
      entry.char.destroy();
      this.pushEffect("despawn", x, y);
    }
    this.entries.length = 0;
    this.opts.onChange?.([]);
  }

  /** Trigger a jump on every live character. Already-airborne characters are unaffected (no-op). */
  jumpAll(): void {
    for (const entry of this.entries) {
      entry.char.jump();
    }
  }

  private pushEffect(kind: EffectKind, x: number, y: number): void {
    const handle = this.opts.createEffectHandle?.(kind);
    if (!handle) return;
    const effect = new Effect(handle, EFFECT.FPS, EFFECT.FRAME_COUNT);
    effect.setPosition(x, y);
    this.effects.push(effect);
  }

  tick(dt: number): void {
    this.elapsed += dt;
    const { rng } = this.opts;

    // Advance live (despawn) effects and remove expired ones.
    for (const e of this.effects) e.tick(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].expired) this.effects.splice(i, 1);
    }

    // Advance pending spawn effects; collect expired ones for promotion.
    for (const p of this.pending) p.effect.tick(dt);
    const toPromote: PendingSpawn[] = [];
    const stillPending: PendingSpawn[] = [];
    for (const p of this.pending) {
      if (p.effect.expired) toPromote.push(p);
      else stillPending.push(p);
    }
    this.pending.length = 0;
    for (const p of stillPending) this.pending.push(p);

    // Materialize promoted characters and emit a single batched onChange.
    for (const p of toPromote) this.materializeEntry(p.entry, p.loaded, p.x);
    if (toPromote.length > 0) this.opts.onChange?.(this.snapshot());

    for (const entry of this.entries) {
      entry.char.tick(dt);

      entry.rollTimer -= dt;
      if (entry.rollTimer <= 0) {
        // Always schedule the next roll, whether or not this one fires.
        entry.rollTimer =
          BUBBLE.PER_CHAR_AVG_INTERVAL_S -
          BUBBLE.PER_CHAR_JITTER_S +
          rng() * (2 * BUBBLE.PER_CHAR_JITTER_S);

        // Respect global cooldown — drop the roll if a bubble just fired.
        if (this.elapsed - this.lastBubbleAt >= BUBBLE.GLOBAL_COOLDOWN_S) {
          const line = IDLE_LINES[Math.floor(rng() * IDLE_LINES.length)];
          entry.char.say(line);
          this.lastBubbleAt = this.elapsed;
        }
      }

      entry.jumpRollTimer -= dt;
      if (entry.jumpRollTimer <= 0) {
        // Always reschedule with jitter. jump() is a no-op if already airborne — no special skip needed.
        entry.jumpRollTimer =
          JUMP.PER_CHAR_AVG_INTERVAL_S -
          JUMP.PER_CHAR_JITTER_S +
          rng() * (2 * JUMP.PER_CHAR_JITTER_S);

        entry.char.jump();
      }
    }
  }
}
