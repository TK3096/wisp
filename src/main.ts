import { Application } from "pixi.js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ASSET_MANIFEST, FLOOR_BAND_PX } from "./config";
import { loadAsset } from "./spriteLoader";
import { CharacterRegistry, defaultCreateBubbleHandle } from "./characterRegistry";

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

  // Pre-load all assets
  const loadedAssets = new Map(
    await Promise.all(
      ASSET_MANIFEST.map(async (entry) => {
        const loaded = await loadAsset(entry);
        return [entry.name, loaded] as const;
      })
    )
  );

  const registry = new CharacterRegistry({
    stage: app.stage,
    manifest: ASSET_MANIFEST,
    loadedAssets,
    rng: Math.random,
    screenWidth: window.innerWidth,
    floorY: window.innerHeight - FLOOR_BAND_PX,
    createBubbleHandle: defaultCreateBubbleHandle,
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
  } catch (err) {
    console.warn("Tauri event bridge unavailable:", err);
  }
}

init();
