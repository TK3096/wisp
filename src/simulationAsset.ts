/**
 * Rendering-agnostic asset shape consumed by behavior orchestration.
 *
 * Concrete textures are deliberately opaque: only rendering factories need to
 * understand renderer-specific types.
 */
export interface LoadedAsset {
  idleTextures: unknown[];
  walkTextures: unknown[];
  jumpTexture: unknown;
  fallTexture: unknown;
}
