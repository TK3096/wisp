---
type: learnings
updated: 2026-04-25
---

# Wisp Learnings

## AI Work Patterns

### What Works
- **Spawn effect — deferred construction**: `registry.spawn()` plays the spawn `Effect` first; `materializeEntry()` constructs the `Character` only after the effect expires. Never construct Character directly inside `spawn()`.
- **Handle interfaces as seams**: pure logic files (`character.ts`, `bubble.ts`, `effect.ts`) receive `CharacterHandle` / `BubbleHandle` / `EffectHandle` — they never touch Pixi objects directly. Tests inject `vi.fn()` mocks through these seams.
- **Ticker delta is seconds**: Pixi v8 passes `dt` in seconds to `app.ticker` callbacks, not milliseconds.
- **Test isolation**: tests must not import anything from Pixi or Tauri. Keep all rendering behind handle interfaces.

### What Breaks
- **Pixi imports in pure logic files**: `character.ts`, `bubble.ts`, `effect.ts` must stay WebGL-free. Any Pixi import there breaks the Vitest unit suite (no WebGL in test env).
- **Destroying before despawn effect**: calling `char.destroy()` before the despawn `Effect` plays skips the visual. The despawn flow is `despawn(id)` → `char.destroy()` → play despawn effect → `onChange`.
- **Direct Character construction in spawn**: skips the spawn effect entirely.

## Design Decisions

### Gameplay / Tuning
- (append here as decisions are made)

### Architecture
- (append here as non-obvious structural decisions are made)
