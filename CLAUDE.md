## Project

Desktop overlay app — pixel art characters wander on screen. Built with Tauri 2.x (Rust) + Pixi.js v8 (TypeScript). Spawn/despawn via system tray or `Cmd+Shift+W`.

**Key files:** `src/config.ts` · `src/character.ts` · `src/characterRegistry.ts` · `src/bubble.ts` · `src/spriteLoader.ts` · `src-tauri/src/lib.rs`

**Commands:** `npm run tauri dev` · `npm test`

**Testing:** Vitest. Deep modules (`Character`, `CharacterRegistry`) are unit-tested with fake RNG, clock, and stage — no WebGL or Tauri in tests.

---

## Commit Rules

Summarize commit message with clearly. For each commit, you must create github issue on TK3096/second-brain with devlog, side_projects and wisp labels, use gh for create issue. If the commit is about fix/hotfix/fixbug append "hotfix" label, other wise append "feature" label. If labels does not exist on github, create them first.

## Issue Tempalte

use this issue template for second-brain

- **Repo:** `${REPO_NAME}`
- **Branch:** `${BRANCH}`
- **Commit:** `${COMMIT_SHORT}`
- **Author:** ${AUTHOR}
- **Date:** ${DATE}

## Message

${COMMIT_MSG}

## Files Changed

```
${FILES_CHANGED}
```
