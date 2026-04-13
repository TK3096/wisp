## Project

Desktop overlay app — pixel art characters wander on screen. Built with Tauri 2.x (Rust) + Pixi.js v8 (TypeScript). Spawn/despawn via system tray or `Cmd+Shift+W`.

**Key files:** `src/config.ts` · `src/character.ts` · `src/characterRegistry.ts` · `src/spriteLoader.ts` · `src-tauri/src/lib.rs`

**Commands:** `npm run tauri dev` · `npm test`

**Testing:** Vitest. Deep modules (`Character`, `CharacterRegistry`) are unit-tested with fake RNG, clock, and stage — no WebGL or Tauri in tests.

---

## Commit Rules

Summalize commit message with clearly. For each commit, you must create github issue on TK3096/second-brain with devlog, side_project and wisp labels, use gh for create issue. If the commit is about fix/hotfix/fixbug append "hotfix" label, other wise append "feature" label. If labels does not exist on github, create them first.

## Commit Details

  - **Repo:** <repo-name>
  - **Branch:** <branch-name>
  - **Commit:** <short-sha>
  - **Author:** <name> <email>
  - **Date:** <YYYY-MM-DD HH:MM:SS +TZ>

  ## Message

  <short summary line>

  <detailed description: what changed, why, and any relevant context.
  Split into paragraphs per logical area of change.>

  Closes #<issue>

  ## Files Changed

  M  path/to/file
  A  path/to/new-file
  D  path/to/removed-file
