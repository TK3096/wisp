# CLAUDE.md

> Before starting any task: read `.claude/rules/learnings.md`
> Before committing: run the checklist in `.claude/rules/eval.md`
> After discovering something non-obvious: append it to `.claude/rules/learnings.md`
> Before starting commit: read `.claude/rules/commit.md`

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wisp is a macOS desktop overlay app — pixel-art characters wander on your screen in a transparent, click-through window. Built with **Tauri 2.x** (Rust backend) + **Pixi.js v8** (TypeScript frontend).

## Commands

```bash
npm run tauri dev   # launch the full overlay app (starts vite dev server + Tauri)
npm test            # run Vitest unit suite (no WebGL or Tauri required)
npm run build       # tsc + vite production build
```

Run a single test file:
```bash
npx vitest run tests/character.test.ts
```

## Architecture

The simulation layer is **pure TypeScript with no Pixi imports** — rendering is injected through handle interfaces. This keeps unit tests fast and WebGL-free.

```
src/
  config.ts           — all tunables: ASSET_MANIFEST, BUBBLE, JUMP, EFFECT, GREETINGS, IDLE_LINES
  character.ts        — Character class: idle↔walk state machine, parabolic jump arc, bubble ownership
  characterRegistry.ts — CharacterRegistry: spawn/despawn lifecycle, idle-bubble scheduler, jump scheduler
  bubble.ts           — Bubble class: typing animation, linger, lifetime cap
  effect.ts           — Effect class: one-shot frame animation (spawn/despawn visuals)
  spriteLoader.ts     — spritesheet slicing into Pixi textures
  main.ts             — wires everything: Pixi app, asset loading, Tauri event listeners
src-tauri/
  src/lib.rs          — tray menu (per-character Despawn submenu, Gestures toggle), Cmd+Shift+W hotkey, window config
  src/sidecar.rs      — SidecarProcess: start/stop/is_running, stdout NDJSON reader, crash callback
src-sidecar/
  main.py             — entry point: argument parsing, constructs Detector
  detector.py         — frame loop: cv2 + MediaPipe → Debouncer → EventEmitter
  debouncer.py        — pure state machine (no cv2/mediapipe), injectable clock for testing
  protocol.py         — EventEmitter: NDJSON output to stdout
  tests/              — pytest suite (debouncer only, no camera deps)
```

**Handle interfaces** (`CharacterHandle`, `BubbleHandle`, `EffectHandle`) are the seams between pure logic and Pixi rendering. Concrete Pixi implementations live in `characterRegistry.ts` (`defaultCreateHandle`, `defaultCreateBubbleHandle`) and `main.ts` (`createEffectHandle`). Tests inject `vi.fn()` mocks.

**Spawn flow:** `registry.spawn()` → plays spawn `Effect` → on effect expiry `materializeEntry()` constructs the `Character` → greeting bubble fires → `onChange` syncs the tray menu.

**Despawn flow:** `registry.despawn(id)` → `char.destroy()` → plays despawn `Effect` → `onChange` updates tray.

**Tick loop:** `app.ticker` (Pixi) calls `registry.tick(dt)` every frame. The registry advances effects, promotes pending spawns, ticks each character, and runs the per-character idle-bubble and jump roll timers.

## Sidecar architecture

`src-sidecar/` is a Python gesture-detection subprocess. It communicates with the Rust backend via **NDJSON on stdout** (one JSON object per line). The Rust `SidecarProcess` module spawns it, sets `PYTHONUNBUFFERED=1` to disable buffering, and reads events in a background thread.

**One-time setup:**
```bash
python3.12 -m venv src-sidecar/.venv
src-sidecar/.venv/bin/pip install -r src-sidecar/requirements.txt
```

Download `gesture_recognizer.task` from the MediaPipe Model Hub and place it in `src-sidecar/`.

**Events:** `{"event":"ready"}` · `{"event":"spawn"}` · `{"event":"error","kind":"...","message":"..."}`

The tray "Gestures" CheckMenuItem toggles the sidecar on/off. The toggle reverts automatically if the sidecar crashes or emits an error event.

## Adding a character

1. Drop four spritesheets under `public/assets/sprites/<name>/`: `idle.png`, `walk.png`, `jump.png`, `fall.png`
2. Add an `AssetEntry` to `ASSET_MANIFEST` in `src/config.ts`

## Key config constants (`src/config.ts`)

- `BUBBLE` — typing speed, linger, max duration, global cooldown, per-character roll interval
- `JUMP` — peak height, duration, rise fraction, per-character roll interval
- `EFFECT` — fps, frame dimensions, frame count, sprite paths
- `GREETINGS` / `IDLE_LINES` — text pools; emoji are code-point safe
