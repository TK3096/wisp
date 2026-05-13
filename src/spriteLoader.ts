import { Assets, Texture, Rectangle } from "pixi.js";
import { AssetEntry } from "./config";

// Pixi.js v8 mis-resolves paths under the tauri:// custom scheme, dropping the
// host and producing tauri://assets/... instead of tauri://localhost/assets/...
// Pre-expand every /path to an absolute URL so Pixi never needs to resolve it.
function abs(path: string): string {
  return `${window.location.origin}${path}`;
}

export interface LoadedAsset {
  idleTextures: Texture[];
  walkTextures: Texture[];
  jumpTexture: Texture;
  fallTexture: Texture;
}

/** Slice a horizontal sprite strip into individual frame textures. */
function sliceStrip(
  base: Texture,
  frameCount: number,
  frameWidth: number,
  frameHeight: number
): Texture[] {
  const textures: Texture[] = [];
  for (let i = 0; i < frameCount; i++) {
    textures.push(
      new Texture({
        source: base.source,
        frame: new Rectangle(i * frameWidth, 0, frameWidth, frameHeight),
      })
    );
  }
  return textures;
}

/** Load an effect sprite strip and slice it into individual frame textures. */
export async function loadEffect(
  path: string,
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
): Promise<Texture[]> {
  const base = await Assets.load<Texture>(abs(path));
  return sliceStrip(base, frameCount, frameWidth, frameHeight);
}

export async function loadAsset(entry: AssetEntry): Promise<LoadedAsset> {
  const [idleBase, walkBase, jumpTexture, fallTexture] = await Promise.all([
    Assets.load<Texture>(abs(entry.idlePath)),
    Assets.load<Texture>(abs(entry.walkPath)),
    Assets.load<Texture>(abs(entry.jumpPath)),
    Assets.load<Texture>(abs(entry.fallPath)),
  ]);

  return {
    idleTextures: sliceStrip(idleBase, entry.idleFrames, entry.frameWidth, entry.frameHeight),
    walkTextures: sliceStrip(walkBase, entry.walkFrames, entry.frameWidth, entry.frameHeight),
    jumpTexture,
    fallTexture,
  };
}
