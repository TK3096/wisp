import { Sprite, Container, Texture } from "pixi.js";
import { AssetEntry } from "./config";
import { Character, CharacterHandle, CharacterConfig, CharacterState } from "./character";
import { LoadedAsset } from "./spriteLoader";

const SPRITE_SCALE = 2;

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
      currentTextures = anim === "walk" ? loaded.walkTextures : loaded.idleTextures;
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

export class CharacterRegistry {
  private readonly characters: Character[] = [];
  private readonly opts: Required<RegistryOptions>;

  constructor(opts: RegistryOptions) {
    this.opts = { createHandle: defaultCreateHandle, ...opts };
  }

  get count(): number {
    return this.characters.length;
  }

  spawn(): void {
    const { manifest, loadedAssets, rng, stage, screenWidth, floorY, createHandle } = this.opts;

    const entry = manifest[Math.floor(rng() * manifest.length)];
    const loaded = loadedAssets.get(entry.name)!;
    const x = rng() * screenWidth;

    const handle = createHandle({ entry, loaded, stage, x, floorY });

    const cfg: Partial<CharacterConfig> = {
      rng,
      floorLeft: 0,
      floorRight: screenWidth,
    };

    const character = new Character(
      { x, y: floorY, facing: "right", handle },
      entry.idleFrames,
      entry.walkFrames,
      cfg
    );

    this.characters.push(character);
  }

  despawnAll(): void {
    for (const character of this.characters) {
      character.destroy();
    }
    this.characters.length = 0;
  }

  tick(dt: number): void {
    for (const character of this.characters) {
      character.tick(dt);
    }
  }
}
