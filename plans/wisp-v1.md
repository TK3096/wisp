# Plan: Wisp v1 — manual spawn/despawn desktop overlay

> Source PRD: https://github.com/TK3096/wisp/issues/1

## Architectural decisions

Durable decisions that apply across all phases:

- **Stack:** Tauri 2.x (Rust) + Vanilla TypeScript + Pixi.js v8. Scaffolded in-place via `npm create tauri-app@latest .` with the `vanilla-ts` template and `npm`.
- **Overlay window:** a single fullscreen window with `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `resizable: false`, `skipTaskbar: true`. At startup the app queries the primary monitor's work area and sets the window size and position to match, then calls `set_ignore_cursor_events(true)` so all input passes through. Single monitor only in v1.
- **Tauri → frontend events:** `spawn` and `despawn-all`. Both the tray menu and the global hotkey funnel into the same `spawn` event so there is one code path on the frontend.
- **Asset manifest:** `mask-dude` and `ninja-frog`, each with `idle.png` (11-frame horizontal strip) and `walk.png` (12-frame horizontal strip), 32×32, transparent background, authored facing right. Left-facing is achieved by horizontal flip at render time.
- **Config module:** a single TypeScript file holds all tunable feel constants — `IDLE_FPS`, `WALK_FPS`, `WALK_SPEED_PX_S`, `IDLE_DWELL_MS_MIN`, `IDLE_DWELL_MS_MAX`, `WALK_DWELL_MS_MIN`, `WALK_DWELL_MS_MAX`, `FLOOR_BAND_PX`, `HOTKEY`, and the asset manifest.
- **Deep modules (unit-tested):** `Character` (state machine, Pixi-independent logic core) and `CharacterRegistry` (collection on top of Character, stage-injected). Everything else is platform glue and is verified by running the app.
- **Test runner:** Vitest. Tests use fake clock, fake RNG, and a fake stage so they never touch WebGL or Tauri.
- **Lifecycle:** foreground app only. No autostart, no persistence, no session watcher, no bubbles. Starts each launch with zero characters on screen. Tray `Quit` exits the process.
- **TDD scope:** phases that introduce the deep modules (**Phase 3** and **Phase 4**) are built test-first in a red → green → refactor loop driven by the behavior list in the PRD's "Testing Decisions" section. Phases 1, 2, and 5 are platform glue with no pure logic worth isolating; they are verified by launching the app and exercising the behavior by hand.

---

## Phase 1: Scaffold and transparent click-through overlay

**User stories**: 11, 12, 13, 14, 17

### What to build

Scaffold the Tauri + Vanilla TS project in place in the repository root (alongside the existing `assets/`, `plans/`, and `CLAUDE.md`). Add Pixi.js v8. Configure the overlay window with all of the flags from the architectural decisions, query the primary monitor's work area at startup and size the window to cover it, and enable click-through. Mount a Pixi application on a full-window canvas with a transparent clear color and run its ticker. No characters are rendered in this phase — the screen should look untouched while the app is running.

### Acceptance criteria

- [x] `npm run tauri dev` launches the app with no errors.
- [x] The overlay window has no decorations, no taskbar/dock entry beyond the (not-yet-built) tray, and stays above other windows.
- [x] The overlay covers the full primary monitor work area.
- [x] Mouse clicks, scrolling, drags, and keyboard input pass through the overlay to the window underneath everywhere on the screen.
- [x] The Pixi stage is running its ticker (verifiable via devtools or a temporary frame counter) at ~60 fps.
- [x] Killing the process from outside fully exits the app (tray `Quit` comes in Phase 3).

---

## Phase 2: Single hardcoded idle character

**User stories**: 7 (idle half), 8 (default facing), 17

### What to build

Introduce the `Config` module with initial constants and the asset manifest. Build the sprite loader so it can load a single character's `idle.png` and slice it into 11 textures. Build the minimal `Character` module with an idle-only state: it holds a position, a facing, and an animation frame index that advances at `IDLE_FPS` and wraps at the frame count. On app boot, hardcode one character spawn at a fixed x on the floor band using one of the two assets. This phase proves the full render pipeline end-to-end on one asset before any registry, tray, or walk logic exists.

### Acceptance criteria

- [ ] Launching the app shows exactly one character idling at the bottom of the primary monitor.
- [ ] The character's idle animation loops smoothly (no visible seam between frame 10 and frame 0).
- [ ] The character is positioned within the configured floor band.
- [ ] Click-through from Phase 1 still works — the character does not absorb any input.
- [ ] Changing `IDLE_FPS` in the config module measurably changes the animation speed after a restart.

---

## Phase 3: Tray menu, character registry, and random asset pick (TDD)

**User stories**: 1, 2, 4, 5, 6, 10, 15, 16, 19

### What to build

Build the `CharacterRegistry` deep module test-first against a fake stage and fake RNG, covering spawn accumulation, random asset pick from the manifest, random x within the floor band, despawn-all clearing every character and detaching every sprite, and `tick(dt)` fanning updates out to every live character. Once the tests are green, wire a Tauri system tray icon with `Spawn`, `Despawn All`, and `Quit` entries. Tray handlers emit `spawn` and `despawn-all` to the frontend; the frontend listens and calls the registry. Remove the hardcoded boot spawn from Phase 2 so the app starts empty. Each spawn adds exactly one character, chosen uniformly at random from the asset manifest, at a random x on the floor band.

### Acceptance criteria

- [ ] Vitest spec for `CharacterRegistry` is green and covers: fresh registry has zero characters; `spawn()` adds exactly one; multiple `spawn()` calls accumulate independently; random pick draws uniformly from the asset manifest given the injected RNG; `despawnAll()` removes every character and detaches every sprite from the injected stage; `tick(dt)` advances every live character.
- [ ] The system tray icon appears on launch with `Spawn`, `Despawn All`, and `Quit` entries.
- [ ] On launch the screen is empty — no character until the user spawns one.
- [ ] Clicking `Spawn` N times produces N idling characters at random x positions along the floor band, with the asset randomly selected.
- [ ] Clicking `Despawn All` instantly clears every character from the screen.
- [ ] Clicking `Quit` exits the process cleanly.

---

## Phase 4: Wander behavior (TDD)

**User stories**: 7, 8, 9, 18

### What to build

Extend the `Character` deep module test-first to add the walk state and the idle ↔ walk cycle. Behaviors to drive the tests: a new character starts idle; after its idle dwell elapses the character picks a new random target x within the floor-band bounds and transitions to walk; walking advances the x position toward the target at `WALK_SPEED_PX_S` and never crosses bounds; facing flips to left when the target is to the left and to right when the target is to the right; on reaching the target the character returns to idle and resets its dwell timer with a fresh random duration in the configured range; the animation frame index advances at `IDLE_FPS` or `WALK_FPS` as appropriate and wraps at 11 or 12. Once the tests are green, load `walk.png` via the sprite loader, wire the walk-state rendering path, and apply horizontal flip on the sprite when facing left.

### Acceptance criteria

- [ ] Vitest spec for `Character` is green and covers all behaviors listed above.
- [ ] Characters visibly alternate between idling and walking in-app.
- [ ] Walking characters face the direction they are moving; the flip is clean and does not jitter at direction changes.
- [ ] Characters never leave the floor band horizontally and never appear outside it vertically.
- [ ] Changing `WALK_SPEED_PX_S`, dwell ranges, or `FLOOR_BAND_PX` in config measurably changes behavior after a restart.

---

## Phase 5: Global hotkey

**User stories**: 3

### What to build

Add the Tauri global-shortcut plugin to the Rust side and register `Cmd/Ctrl+Shift+W` (from `Config.HOTKEY`) at startup. The hotkey handler emits the same `spawn` event the tray already emits, so no new frontend logic is required.

### Acceptance criteria

- [ ] Pressing `Cmd/Ctrl+Shift+W` anywhere on the OS spawns exactly one character, identically to clicking `Spawn` in the tray.
- [ ] The hotkey works while other applications have focus.
- [ ] The hotkey is released on app quit so it does not leak into the next session.
