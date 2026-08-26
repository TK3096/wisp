import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { BUBBLE } from "./config";
import { CharacterHandle, CharacterState } from "./character";
import { BubbleHandle } from "./bubble";
import { SpawnContext } from "./characterRegistry";

const SPRITE_SCALE = 2;
const BUBBLE_FONT_SIZE = 12;
const BUBBLE_PADDING = 5;
const BUBBLE_TAIL_H = 6;

export function defaultCreateBubbleHandle(
  stage: unknown,
  text: string,
): BubbleHandle {
  const bubbleStage = stage as Container;
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
  bubbleStage.addChild(container);

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
      bubbleStage.removeChild(container);
      container.destroy({ children: true });
    },
  };
}

export function defaultCreateHandle({
  loaded,
  stage,
}: SpawnContext): CharacterHandle {
  const spriteStage = stage as Container;
  const sprite = loaded.idleTextures[0]
    ? new Sprite(loaded.idleTextures[0] as Texture)
    : new Sprite();

  sprite.scale.set(SPRITE_SCALE);
  sprite.anchor.set(0.5, 1);
  spriteStage.addChild(sprite);

  let currentTextures: unknown[] = loaded.idleTextures;

  return {
    setAnimation(anim: CharacterState) {
      currentTextures =
        anim === "walk" ? loaded.walkTextures : loaded.idleTextures;
    },
    setTexture(frameIndex: number) {
      const tex = currentTextures[frameIndex];
      if (tex) sprite.texture = tex as Texture;
    },
    setPosition(x: number, y: number) {
      sprite.x = x;
      sprite.y = y;
    },
    setFlip(facingLeft: boolean) {
      sprite.scale.x = facingLeft ? -SPRITE_SCALE : SPRITE_SCALE;
    },
    setAirborneSprite(kind: "jump" | "fall" | null) {
      if (kind === "jump") sprite.texture = loaded.jumpTexture as Texture;
      else if (kind === "fall") sprite.texture = loaded.fallTexture as Texture;
      // null: no-op — next setTexture call from ground tick restores the ground frame
    },
    destroy() {
      spriteStage.removeChild(sprite);
      sprite.destroy();
    },
  };
}
