---
type: learnings
updated: 2026-04-25
---

# Wisp Learnings

## AI Work Patterns

### What Works
- **Handle/seam pattern extends to Python**: `debouncer.py` is pure logic (no cv2/mediapipe), `detector.py` is the integration shell that wires cv2 + MediaPipe into the Debouncer. Tests only import `debouncer.py`, keeping them fast and dependency-free.
- **Spawn effect — deferred construction**: `registry.spawn()` plays the spawn `Effect` first; `materializeEntry()` constructs the `Character` only after the effect expires. Never construct Character directly inside `spawn()`.
- **Handle interfaces as seams**: pure logic files (`character.ts`, `bubble.ts`, `effect.ts`) receive `CharacterHandle` / `BubbleHandle` / `EffectHandle` — they never touch Pixi objects directly. Tests inject `vi.fn()` mocks through these seams.
- **Ticker delta is seconds**: Pixi v8 passes `dt` in seconds to `app.ticker` callbacks, not milliseconds.
- **Test isolation**: tests must not import anything from Pixi or Tauri. Keep all rendering behind handle interfaces.

### What Breaks
- **Pixi.js v8 + Tauri production build — two issues**:
  1. WKWebView rejects `createImageBitmap()` on data fetched via `tauri://` scheme (`InvalidStateError`). Fix: `Assets.setPreferences({ preferCreateImageBitmap: false })` before any load.
  2. Pixi.js v8's URL resolver drops the host under non-standard schemes, producing `tauri://assets/...` instead of `tauri://localhost/assets/...`. Fix: pre-expand all asset paths to absolute URLs with `window.location.origin + path` in `spriteLoader.ts`.
  Both are silent in production — `init()` has no `.catch()` and the try/catch around `listen()` swallows failures. Always verify the Despawn submenu updates after Spawn as a quick production smoke test.
- **`print()` without `flush=True` or `PYTHONUNBUFFERED=1`**: Python block-buffers stdout when writing to a pipe. Rust's `BufReader::lines()` will never see events until the buffer fills or the process exits. Always use `flush=True` in `print()` calls AND set `PYTHONUNBUFFERED=1` from the parent (Rust sets this env var before spawning).
- **Pixi imports in pure logic files**: `character.ts`, `bubble.ts`, `effect.ts` must stay WebGL-free. Any Pixi import there breaks the Vitest unit suite (no WebGL in test env).
- **Destroying before despawn effect**: calling `char.destroy()` before the despawn `Effect` plays skips the visual. The despawn flow is `despawn(id)` → `char.destroy()` → play despawn effect → `onChange`.
- **Direct Character construction in spawn**: skips the spawn effect entirely.

## Design Decisions

### Gameplay / Tuning
- (append here as decisions are made)

### Architecture
- (append here as non-obvious structural decisions are made)
