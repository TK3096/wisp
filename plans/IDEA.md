# Wisp

## Project overview

A standalone desktop overlay app built with **Tauri** (Rust backend) + **Vanilla JS + Pixi.js** (frontend) that spawns pixel art characters on screen. Characters can be spawned manually or automatically triggered by Claude Code CLI session activity.

## Core features

1. **Manual spawn** — user can spawn/despawn characters via system tray icon or global hotkey
2. **Claude Code session watcher** — auto-spawns a character when a Claude Code CLI session is detected; despawns when the session ends (future improve)
3. **Bubble text** — characters spawned from session watching display speech bubbles showing session status (working, done, error, etc.)
4. **Transparent always-on-top overlay** — characters float above all windows; clicks pass through to apps underneath

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Desktop runtime | Tauri 2.x (Rust) | Lightweight, native OS APIs, ~5MB binary |
| Frontend renderer | Pixi.js v8 (WebGL) | 60fps sprite animation, low CPU |
| Frontend language | Vanilla JS (ES modules) | No framework overhead, minimal RAM |
| Process watching | `sysinfo` crate | Cross-platform process list polling |
| File watching | `notify` crate | inotify/FSEvents/ReadDirectoryChanges |
| Pixel art / sprites | Aseprite spritesheet (PNG + JSON) | Standard format, Pixi.js native support |

## More Ideas
- [X] speech bubble (greething when spawn and random after spawned)
- [ ] more action (jump)
- [ ] despawn one character
- [ ] despawn effect
- [ ] more character
- [ ] select spawn character
- [ ] naming chracter
