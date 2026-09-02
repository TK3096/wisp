import { Application, Sprite, Texture, Assets } from "pixi.js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  ASSET_MANIFEST,
  COGNITION_LIVE_DEFAULT_ENABLED,
  EFFECT,
  FLOOR_BAND_PX,
} from "./config";
import { loadAsset, loadEffect } from "./spriteLoader";
import { CharacterRegistry } from "./characterRegistry";
import { defaultCreateBubbleHandle, defaultCreateHandle } from "./rendering";
import { EffectKind } from "./effect";
import { connectShellEvents } from "./shellBridge";
import { bindWasmCognition } from "./cognitionFacade";
import { createNeutralCognitionHandle } from "./cognition";
import {
  createNativeIdentityFactory,
  createTauriPersistence,
} from "./tauriPersistence";

async function init() {
  // WKWebView (macOS) rejects createImageBitmap on tauri:// scheme responses;
  // fall back to HTMLImageElement loading instead.
  Assets.setPreferences({ preferCreateImageBitmap: false });

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
    createHandle: defaultCreateHandle,
    createBubbleHandle: defaultCreateBubbleHandle,
    createCognitionHandle: COGNITION_LIVE_DEFAULT_ENABLED
      ? await bindWasmCognition()
      : createNeutralCognitionHandle,
    createCharacterId: createNativeIdentityFactory(),
    persistence: createTauriPersistence(),
    onPersistenceError: console.error,
    onIdentityError: console.error,
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

  // Restore before the render loop starts so cognition cadence and scheduler
  // timers begin at zero for the resumed session.
  try {
    await registry.restore();
  } catch (error) {
    console.error("Character restore failed:", error);
  }

  // Compile-time gate: Vite replaces these constants, and a normal production
  // build drops both dynamic imports. `--mode debug` is available for a debug
  // frontend bundle without making the overlay runtime-enableable in release.
  const cognitionDebug =
    import.meta.env.DEV || import.meta.env.MODE === "debug"
      ? new (
          await import("./cognitionDebug")
        ).CognitionDebugOverlay(
          (
            await import("./cognitionDebugView")
          ).createCognitionDebugView<HTMLElement>(document),
          { enabled: false },
        )
      : undefined;

  app.ticker.add((ticker) => {
    registry.tick(ticker.deltaMS / 1000);
    if (cognitionDebug?.isEnabled) {
      cognitionDebug.update(() => registry.debugSnapshots());
    }
  });

  // Tray / hotkey events — guarded so a missing Tauri bridge (e.g. running
  // under plain `vite dev`) doesn't kill the render loop.
  try {
    await connectShellEvents(
      (event, onPayload) =>
        listen(event, (shellEvent) => onPayload(shellEvent.payload)),
      registry,
      window,
      cognitionDebug,
      async () => {
        await registry.flush("shutdown");
        await invoke("exit_after_flush");
      },
    );
  } catch (err) {
    console.warn("Tauri event bridge unavailable:", err);
  }

  // Best-effort fallback when the shell closes without the handshake event.
  // Graceful shutdown gives dirty characters a final durable snapshot.
  window.addEventListener("pagehide", () => {
    void registry.flush("shutdown").catch(console.error);
  });
}

init();
