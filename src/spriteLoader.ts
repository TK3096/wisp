import { Assets, Texture, Rectangle } from "pixi.js";
import { AssetEntry } from "./config";

export interface LoadedAsset {
  idleTextures: Texture[];
  walkTextures: Texture[];
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

export async function loadAsset(entry: AssetEntry): Promise<LoadedAsset> {
  const [idleBase, walkBase] = await Promise.all([
    Assets.load<Texture>(entry.idlePath),
    Assets.load<Texture>(entry.walkPath),
  ]);

  return {
    idleTextures: sliceStrip(idleBase, entry.idleFrames, entry.frameWidth, entry.frameHeight),
    walkTextures: sliceStrip(walkBase, entry.walkFrames, entry.frameWidth, entry.frameHeight),
  };
}
