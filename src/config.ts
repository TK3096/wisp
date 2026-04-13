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

export const BUBBLE = {
  /** Pixels above character's foot position where the bubble tail tip appears. Negative = up. */
  OFFSET_Y_PX: -72,
  MAX_WIDTH_PX: 160,
  /** Characters revealed per second during typing animation (Phase 2+). */
  TYPING_SPEED_CPS: 25,
  /** Seconds to hold the bubble after typing finishes (Phase 2+). */
  LINGER_S: 1.5,
  /** Hard cap on total bubble lifetime in seconds (Phase 2+). */
  MAX_DURATION_S: 5,
  /** Minimum seconds between any two bubbles globally (Phase 4+). */
  GLOBAL_COOLDOWN_S: 3,
  /** Average seconds between per-character idle bubble rolls (Phase 4+). */
  PER_CHAR_AVG_INTERVAL_S: 30,
  /** ± jitter on the per-character interval in seconds (Phase 4+). */
  PER_CHAR_JITTER_S: 20,
};

export const GREETINGS = ["hi!", "hello!", "hey!", "*waves*", "yo"];

export const IDLE_LINES = [
  "zzz", "hmm", "...", "where am I?",
  "*looks around*", "la la la", "what's up?", "*yawns*",
];

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
