import { Sprite, Container, Texture, Graphics, Text } from "pixi.js";
import { AssetEntry, BUBBLE, GREETINGS, IDLE_LINES } from "./config";
import {
  Character,
  CharacterHandle,
  CharacterConfig,
  CharacterState,
} from "./character";
import { BubbleHandle, Bubble } from "./bubble";
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
  /** Seconds until this character's next idle-line roll. */
  rollTimer: number;
}

export class CharacterRegistry {
  private readonly entries: CharEntry[] = [];
  private readonly opts: ResolvedOptions;
  /** Total elapsed seconds since the registry was created. */
  private elapsed = 0;
  /** Elapsed time at which the last bubble was emitted (idle rolls only). */
  private lastBubbleAt = -Infinity;

  constructor(opts: RegistryOptions) {
    this.opts = { createHandle: defaultCreateHandle, ...opts };
  }

  get count(): number {
    return this.entries.length;
  }

  spawn(): void {
    const {
      manifest,
      loadedAssets,
      rng,
      stage,
      screenWidth,
      floorY,
      createHandle,
      createBubbleHandle,
    } = this.opts;

    const entry = manifest[Math.floor(rng() * manifest.length)];
    const loaded = loadedAssets.get(entry.name)!;
    const x = rng() * screenWidth;

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

    // Fixed initial roll timer so characters don't lock-step on the first roll.
    // After the first roll fires, subsequent timers are randomized via rng().
    this.entries.push({
      char: character,
      rollTimer: BUBBLE.PER_CHAR_AVG_INTERVAL_S,
    });
  }

  despawnAll(): void {
    for (const entry of this.entries) {
      entry.char.destroy();
    }
    this.entries.length = 0;
  }

  tick(dt: number): void {
    this.elapsed += dt;
    const { rng } = this.opts;

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
    }
  }
}
