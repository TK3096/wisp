# AGNETS.md

## What this is

Wisp is a macOS desktop overlay app — pixel-art characters wander on your screen in a transparent, click-through window. Built with **Tauri 2.x** (Rust backend) + **Pixi.js v8** (TypeScript frontend).

## Commands

```bash
npm run tauri dev   # launch the full overlay app (starts vite dev server + Tauri)
npm test            # run Vitest unit suite (no WebGL or Tauri required)
npm run test:cognition # run Rust core tests and the Node-backed WASM facade test
npm run build:cognition # regenerate public/cognition (build state; never commit)
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
  cognition.ts        — pure Cognition Handle contract, fixed cadence limits, neutral implementation
  character.ts        — Character class: idle↔walk state machine, parabolic jump arc, bubble ownership
  characterRegistry.ts — CharacterRegistry: spawn/despawn lifecycle, stimulus dispatch, 10 Hz cognition cadence, idle-bubble/jump schedulers
  bubble.ts           — Bubble class: typing animation, linger, lifetime cap
  effect.ts           — Effect class: one-shot frame animation (spawn/despawn visuals)
  scenarioHarness.ts  — headless deterministic replay, canonical NDJSON traces, lossy trace writer
  simulationAsset.ts  — renderer-agnostic LoadedAsset contract
  ingressBridge.ts    — validates shell/sidecar ingress payloads and emits semantic Stimulus Envelopes
  shellBridge.ts      — transport-free shell-event wiring injected around the registry
  rendering.ts        — concrete Pixi Character/Bubble handle factories
  spriteLoader.ts     — spritesheet slicing into Pixi textures
  main.ts             — wires everything: Pixi app, asset loading, Tauri event listeners
src-tauri/
  src/lib.rs          — tray menu (per-character Despawn submenu, Gestures toggle), Cmd+Shift+W hotkey, window config
  src/sidecar.rs      — SidecarProcess: start/stop/is_running, stdout NDJSON reader, crash callback
crates/
  wisp-cognition-core/ — Wisp-owned pure Rust static Personality core (no shell, renderer, Python, DOM, or WASM dependencies)
  wisp-cognition-wasm/ — coarse-grained wasm-bindgen facade exposing only the Cognition Handle shape
src-sidecar/
  main.py             — entry point: argument parsing, constructs Detector
  detector.py         — frame loop: cv2 + MediaPipe → Debouncer → EventEmitter
  debouncer.py        — pure state machine (no cv2/mediapipe), injectable clock for testing
  protocol.py         — EventEmitter: NDJSON output to stdout
  tests/              — pytest suite (debouncer and protocol, no camera deps)
```

**Handle interfaces** (`CharacterHandle`, `BubbleHandle`, `EffectHandle`, `CognitionHandle`) are the seams between pure logic and rendering/cognition implementations. Concrete Pixi implementations live in `rendering.ts`; `main.ts` wires the effect handle. `cognition.ts` supplies the neutral default; tests inject `vi.fn()` mocks.

**Scenario Harness:** `runScenario()` advances a seeded scenario on a virtual clock, splits scheduled events across render frames, injects deterministic Character Identities and scheduler rolls, and emits canonical trace records. The same seed/scenario/contract produces byte-identical NDJSON; 30/60/120 fps runs are compared through their cognition steps and behavior decisions. `LossyTraceWriter` writes asynchronously and drops oldest queued records rather than blocking the replay.

**Spawn flow:** `registry.spawn()` → plays spawn `Effect` → on effect expiry `materializeEntry()` constructs the `Character` → greeting bubble fires → `onChange` syncs the tray menu.

**Despawn flow:** `registry.despawn(id)` → targeted Vanishing stimulus → `char.destroy()` → plays despawn `Effect` → `onChange` updates tray.

**Tick loop:** `app.ticker` (Pixi) calls `registry.tick(dt)` every frame. The registry advances effects, promotes pending spawns, steps each character's Cognition Handle at the fixed 10 Hz cadence with bounded catch-up, applies its Behavior Signal, ticks the character, and runs the per-character idle-bubble and jump roll timers.

## Sidecar architecture

`src-sidecar/` is a Python gesture-detection subprocess. It communicates with the Rust backend via **NDJSON on stdout** (one JSON object per line). The Rust `SidecarProcess` module spawns it, sets `PYTHONUNBUFFERED=1` to disable buffering, and reads events in a background thread.

**One-time setup:**
```bash
python3.12 -m venv src-sidecar/.venv
src-sidecar/.venv/bin/pip install -r src-sidecar/requirements.txt
```

Download `gesture_recognizer.task` from the MediaPipe Model Hub and place it in `src-sidecar/`.

**Events:** `{"event":"ready"}` · `{"event":"gesture","gesture":"openPalm","confidence":0.0–1.0}` · `{"event":"error","kind":"...","message":"..."}`

The tray "Gestures" CheckMenuItem toggles the sidecar on/off. Rust forwards an accepted gesture separately to the frontend `gesture` cognition event and `spawn` policy event. The toggle reverts automatically if the sidecar crashes or emits an error event.

## Adding a character

1. Drop four spritesheets under `public/assets/sprites/<name>/`: `idle.png`, `walk.png`, `jump.png`, `fall.png`
2. Add an `AssetEntry` to `ASSET_MANIFEST` in `src/config.ts`

## Key config constants (`src/config.ts`)

- `BUBBLE` — typing speed, linger, max duration, global cooldown, per-character roll interval
- `JUMP` — peak height, duration, rise fraction, per-character roll interval
- `EFFECT` — fps, frame dimensions, frame count, sprite paths
- `GREETINGS` / `IDLE_LINES` — text pools; emoji are code-point safe

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `TK3096/wisp`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage label strings verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
