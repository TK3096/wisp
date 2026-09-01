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
  displayName: string;
  idlePath: string;
  walkPath: string;
  jumpPath: string;
  fallPath: string;
  idleFrames: number;
  walkFrames: number;
  frameWidth: number;
  frameHeight: number;
}

export const JUMP = {
  /** Pixels above the floor at the arc peak. */
  PEAK_HEIGHT_PX: 24,
  /** Total airtime in seconds. */
  DURATION_S: 0.5,
  /** Fraction of airtime spent in the rise pose (remaining fraction uses fall pose). */
  RISE_FRACTION: 0.45,
  /** Average seconds between per-character jump rolls. */
  PER_CHAR_AVG_INTERVAL_S: 20,
  /** ± jitter on the per-character interval in seconds. */
  PER_CHAR_JITTER_S: 10,
};

export const BUBBLE = {
  /** Pixels above character's foot position where the bubble tail tip appears. Negative = up. */
  OFFSET_Y_PX: -72,
  MAX_WIDTH_PX: 160,
  /** Characters revealed per second during typing animation (Phase 2+). */
  TYPING_SPEED_CPS: 10,
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

/**
 * Accepted tone-selection tunables. Small opposite-polarity base weights keep
 * every tone possible; larger personality/affect coefficients make character
 * state the usual reason a tone wins.
 */
export const BUBBLE_TONE_WEIGHTS = {
  cheerful: {
    base: 0.06,
    sociability: 0.45,
    energy: 0.25,
    positiveValence: 0.35,
  },
  curious: {
    base: 0.06,
    curiosity: 0.5,
    surprise: 0.3,
    arousal: 0.15,
  },
  grumpy: {
    base: 0.05,
    negativeValence: 0.4,
    arousal: 0.25,
    lowSociability: 0.12,
  },
} as const;

/**
 * Development-only Cognition Debug Overlay gates. The frame budget is the
 * accepted trace/debug overhead budget; normal release builds do not wire it.
 */
export const COGNITION_DEBUG = {
  FRAME_BUDGET_MS: 0.2,
  /** The accepted 120-second stress replay at 60 fps. */
  METRIC_WINDOW_FRAMES: 7200,
};

import type { TaggedLine } from "./speech";

export const GREETINGS: TaggedLine[] = [
  { text: "hi!", tone: "cheerful" },
  { text: "hello!", tone: "cheerful" },
  { text: "hey!", tone: "cheerful" },
  { text: "*waves*", tone: "cheerful" },
  { text: "yo", tone: "grumpy" },
  { text: "👋", tone: "cheerful" },
  { text: "🫡", tone: "grumpy" },
  { text: "what's this?", tone: "curious" },
];

export const IDLE_LINES: TaggedLine[] = [
  { text: "zzz", tone: "grumpy" },
  { text: "hmm", tone: "curious" },
  { text: "...", tone: "grumpy" },
  { text: "😂", tone: "cheerful" },
  { text: "🤪", tone: "cheerful" },
  { text: "where am I?", tone: "curious" },
  { text: "*looks around*", tone: "curious" },
  { text: "la la la", tone: "cheerful" },
  { text: "what's up?", tone: "curious" },
  { text: "*yawns*", tone: "grumpy" },
  { text: "😱", tone: "grumpy" },
];

export const EFFECT = {
  FPS: 10,
  FRAME_WIDTH: 96,
  FRAME_HEIGHT: 96,
  FRAME_COUNT: 7,
  SPAWN_PATH: "/assets/sprites/effects/spawn.png",
  DESPAWN_PATH: "/assets/sprites/effects/despawn.png",
};

export const ASSET_MANIFEST: AssetEntry[] = [
  {
    name: "mask-dude",
    displayName: "Mask Dude",
    idlePath: "/assets/sprites/mask-dude/idle.png",
    walkPath: "/assets/sprites/mask-dude/walk.png",
    jumpPath: "/assets/sprites/mask-dude/jump.png",
    fallPath: "/assets/sprites/mask-dude/fall.png",
    idleFrames: 11,
    walkFrames: 12,
    frameWidth: 32,
    frameHeight: 32,
  },
  {
    name: "ninja-frog",
    displayName: "Ninja Frog",
    idlePath: "/assets/sprites/ninja-frog/idle.png",
    walkPath: "/assets/sprites/ninja-frog/walk.png",
    jumpPath: "/assets/sprites/ninja-frog/jump.png",
    fallPath: "/assets/sprites/ninja-frog/fall.png",
    idleFrames: 11,
    walkFrames: 12,
    frameWidth: 32,
    frameHeight: 32,
  },
  {
    name: "pink-man",
    displayName: "Pink Man",
    idlePath: "/assets/sprites/pink-man/idle.png",
    walkPath: "/assets/sprites/pink-man/walk.png",
    jumpPath: "/assets/sprites/pink-man/jump.png",
    fallPath: "/assets/sprites/pink-man/fall.png",
    idleFrames: 11,
    walkFrames: 12,
    frameWidth: 32,
    frameHeight: 32,
  },
  {
    name: "virtual-guy",
    displayName: "Virtual Guy",
    idlePath: "/assets/sprites/virtual-guy/idle.png",
    walkPath: "/assets/sprites/virtual-guy/walk.png",
    jumpPath: "/assets/sprites/virtual-guy/jump.png",
    fallPath: "/assets/sprites/virtual-guy/fall.png",
    idleFrames: 11,
    walkFrames: 12,
    frameWidth: 32,
    frameHeight: 32,
  },
];
