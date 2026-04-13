export const IDLE_FPS = 8;
export const WALK_FPS = 10;
export const WALK_SPEED_PX_S = 80;
export const IDLE_DWELL_MS_MIN = 1500;
export const IDLE_DWELL_MS_MAX = 4000;
export const WALK_DWELL_MS_MIN = 1000;
export const WALK_DWELL_MS_MAX = 3000;
/** Height of the floor band from the bottom of the screen in pixels. */
export const FLOOR_BAND_PX = 64;
export const HOTKEY = "CommandOrControl+Shift+W";

export interface AssetEntry {
  name: string;
  idlePath: string;
  walkPath: string;
  idleFrames: number;
  walkFrames: number;
  frameWidth: number;
  frameHeight: number;
}

export const ASSET_MANIFEST: AssetEntry[] = [
  {
    name: "mask-dude",
    idlePath: "/assets/sprites/mask-dude/idle.png",
    walkPath: "/assets/sprites/mask-dude/walk.png",
    idleFrames: 11,
    walkFrames: 12,
    frameWidth: 32,
    frameHeight: 32,
  },
  {
    name: "ninja-frog",
    idlePath: "/assets/sprites/ninja-frog/idle.png",
    walkPath: "/assets/sprites/ninja-frog/walk.png",
    idleFrames: 11,
    walkFrames: 12,
    frameWidth: 32,
    frameHeight: 32,
  },
];
