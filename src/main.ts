import { Application, Sprite } from "pixi.js";
import { ASSET_MANIFEST, FLOOR_BAND_PX } from "./config";
import { loadAsset } from "./spriteLoader";
import { Character, CharacterHandle } from "./character";

const SPRITE_SCALE = 2;

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

  // --- Phase 2: single hardcoded idle character ---
  const entry = ASSET_MANIFEST[0]; // mask-dude
  const loaded = await loadAsset(entry);

  const sprite = new Sprite(loaded.idleTextures[0]);
  sprite.scale.set(SPRITE_SCALE);
  sprite.anchor.set(0.5, 1);
  app.stage.addChild(sprite);

  const handle: CharacterHandle = {
    setTexture(frameIndex) {
      sprite.texture = loaded.idleTextures[frameIndex];
    },
    setPosition(x, y) {
      sprite.x = x;
      sprite.y = y;
    },
    setFlip(facingLeft) {
      sprite.scale.x = facingLeft ? -SPRITE_SCALE : SPRITE_SCALE;
    },
    destroy() {
      sprite.destroy();
    },
  };

  const floorY = window.innerHeight - FLOOR_BAND_PX;
  const character = new Character(
    { x: 200, y: floorY, facing: "right", handle },
    entry.idleFrames
  );

  app.ticker.add((ticker) => {
    character.tick(ticker.deltaMS / 1000);
  });
}

init();
