import { Application, Sprite, Texture } from "pixi.js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ASSET_MANIFEST, EFFECT, FLOOR_BAND_PX } from "./config";
import { loadAsset, loadEffect } from "./spriteLoader";
import { CharacterRegistry, defaultCreateBubbleHandle } from "./characterRegistry";
import { EffectKind } from "./effect";

async function init() {
  const app = new Application();

  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundAlpha: 0,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  document.body.appendChild(app.canvas);

  window.addEventListener("resize", () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });

  // Pre-load all assets (characters + effects)
  const [loadedAssets, spawnTextures, despawnTextures] = await Promise.all([
    Promise.all(
      ASSET_MANIFEST.map(async (entry) => {
        const loaded = await loadAsset(entry);
        return [entry.name, loaded] as const;
      })
    ).then((pairs) => new Map(pairs)),
    loadEffect(EFFECT.SPAWN_PATH, EFFECT.FRAME_COUNT, EFFECT.FRAME_WIDTH, EFFECT.FRAME_HEIGHT),
    loadEffect(EFFECT.DESPAWN_PATH, EFFECT.FRAME_COUNT, EFFECT.FRAME_WIDTH, EFFECT.FRAME_HEIGHT),
  ]);

  const registry = new CharacterRegistry({
    stage: app.stage,
    manifest: ASSET_MANIFEST,
    loadedAssets,
    rng: Math.random,
    screenWidth: window.innerWidth,
    floorY: window.innerHeight - FLOOR_BAND_PX,
    createBubbleHandle: defaultCreateBubbleHandle,
    createEffectHandle: (kind: EffectKind) => {
      const textures = kind === "spawn" ? spawnTextures : despawnTextures;
      const sprite = new Sprite(textures[0] as unknown as Texture);
      sprite.anchor.set(0.5, 1);
      app.stage.addChild(sprite);
      return {
        setTexture(i: number) {
          const tex = textures[i];
          if (tex) sprite.texture = tex as unknown as Texture;
        },
        setPosition(x: number, y: number) {
          sprite.x = x;
          sprite.y = y;
        },
        destroy() {
          app.stage.removeChild(sprite);
          sprite.destroy();
        },
      };
    },
    onChange: (items) => {
      invoke("update_character_list", { items }).catch(console.error);
    },
  });

  app.ticker.add((ticker) => {
    registry.tick(ticker.deltaMS / 1000);
  });

  // Tray / hotkey events — guarded so a missing Tauri bridge (e.g. running
  // under plain `vite dev`) doesn't kill the render loop.
  try {
    await listen("spawn", () => registry.spawn());
    await listen("despawn-all", () => registry.despawnAll());
    await listen<number>("despawn-one", (event) => registry.despawn(event.payload));
  } catch (err) {
    console.warn("Tauri event bridge unavailable:", err);
  }
}

init();
