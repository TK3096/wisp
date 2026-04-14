# Wisp

A desktop overlay app where pixel-art characters wander around on your screen and occasionally pipe up with speech bubbles. Built with **Tauri 2.x** (Rust) + **Pixi.js v8** (TypeScript).

## Features

- Transparent, click-through overlay window — characters live on top of whatever you're working on.
- Spawn / despawn characters via the system tray menu or the `Cmd+Shift+W` hotkey.
  - Tray **Despawn** submenu lists every live character by name and ID for targeted removal.
- Random character selection from a manifest (Mask Dude, Ninja Frog, Pink Man, Virtual Guy).
- Wander behavior: idle dwell → pick a random target → walk to it → repeat.
- **Jump system:** characters periodically leap using a parabolic arc, switching between jump / fall sprites mid-air.
- Speech bubbles:
  - Greeting bubble fires immediately on spawn.
  - Random idle lines roll per-character every 10–50s, rate-limited by a global 3s cooldown.
  - Typing animation reveals text at `TYPING_SPEED_CPS`, then lingers for `LINGER_S`.
  - Emoji supported — bubbles render through Pixi `Text` using the system font.

## Getting Started

```bash
npm install
npm run tauri dev   # launch the overlay
npm test            # run the Vitest suite
```

## Customizing

Everything tunable lives in `src/config.ts`:

- **`ASSET_MANIFEST`** — add more characters. Each entry needs:
  - `name` (internal key), `displayName` (shown in the tray menu)
  - `idlePath` / `walkPath` / `jumpPath` / `fallPath` (relative to `public/`)
  - `idleFrames` / `walkFrames`, `frameWidth` / `frameHeight`
  - Drop the four spritesheets under `public/assets/sprites/<name>/`.
- **`GREETINGS` / `IDLE_LINES`** — strings the characters say. Emoji are fine; the typing animation is code-point safe.
- **`BUBBLE`** — timing knobs:
  - `TYPING_SPEED_CPS` — chars per second during the typing reveal.
  - `LINGER_S` — seconds the fully-typed bubble stays on screen.
  - `MAX_DURATION_S` — hard lifetime cap.
  - `GLOBAL_COOLDOWN_S` — minimum gap between any two idle bubbles across all characters.
  - `PER_CHAR_AVG_INTERVAL_S` / `PER_CHAR_JITTER_S` — how often each character rolls for an idle line.
- **`JUMP`** — jump system knobs:
  - `PEAK_HEIGHT_PX` — pixels above the floor at the arc peak.
  - `DURATION_S` — total airtime in seconds.
  - `RISE_FRACTION` — fraction of airtime using the jump pose (rest uses fall pose).
  - `PER_CHAR_AVG_INTERVAL_S` / `PER_CHAR_JITTER_S` — how often each character rolls for a jump.

## Architecture

The simulation layer (`src/character.ts`, `src/characterRegistry.ts`, `src/bubble.ts`) is pure logic with no Pixi imports — rendering is injected through `CharacterHandle` / `BubbleHandle` interfaces. That keeps the unit tests fast and WebGL-free. The Pixi-specific factories (`defaultCreateHandle`, `defaultCreateBubbleHandle`) live in `characterRegistry.ts` and are only wired up from `src/main.ts`.

**Key files**

- `src/config.ts` — tunables, asset manifest, greeting / idle line pools, `BUBBLE` and `JUMP` config.
- `src/character.ts` — character state machine (idle ↔ walk), jump arc (`tickAirborne`), bubble ownership.
- `src/characterRegistry.ts` — spawn/despawn, idle-bubble scheduler, jump scheduler, `onChange` callback for tray sync, Pixi factories.
- `src/bubble.ts` — pure-logic speech bubble (typing, lifetime).
- `src/spriteLoader.ts` — spritesheet slicing.
- `src-tauri/src/lib.rs` — tray menu (with per-character Despawn submenu), hotkey, window config.

## Testing

```bash
npm test
```

Vitest runs the deep modules (`Character`, `CharacterRegistry`, `Bubble`) with fake RNG, fake clock, and mock handles — no WebGL or Tauri bridge required.
