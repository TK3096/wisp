---
type: eval
updated: 2026-04-25
---

# Pre-Commit Eval Gate

Run these checks in order before every commit. Fix failures before proceeding.

## Checks

- [ ] `npm test` — all Vitest unit tests pass
- [ ] `npm run build` — tsc + vite build, zero type errors
- [ ] No Pixi imports in pure logic files: `rg "pixi" src/character.ts src/bubble.ts src/effect.ts` must return no matches
- [ ] Handle interfaces used at seams — logic files receive handles, never construct Pixi objects directly
- [ ] New character: only 4 spritesheets under `public/assets/sprites/<name>/` + 1 `AssetEntry` in `ASSET_MANIFEST` (no other files needed)

- [ ] Sidecar Python tests: `cd src-sidecar && .venv/bin/pytest` passes
- [ ] Debouncer stays pure: `rg "import cv2|import mediapipe" src-sidecar/debouncer.py` returns no matches

## On Failure

- Fix the root cause — do not skip with `--no-verify`
- If a test reveals a real bug, fix the bug and append the pattern to `learnings.md`
