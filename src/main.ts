import { Application } from "pixi.js";
import { listen } from "@tauri-apps/api/event";
import { ASSET_MANIFEST, FLOOR_BAND_PX } from "./config";
import { loadAsset } from "./spriteLoader";
import { CharacterRegistry } from "./characterRegistry";

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
  });

  // Tray / hotkey events
  await listen("spawn", () => registry.spawn());
  await listen("despawn-all", () => registry.despawnAll());

  app.ticker.add((ticker) => {
    registry.tick(ticker.deltaMS / 1000);
  });
}

init();
