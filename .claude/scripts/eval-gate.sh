#!/usr/bin/env bash
set -euo pipefail

# Read PreToolUse input from stdin (JSON with a "command" field)
input=$(cat)

# Only gate on git commit commands
if ! echo "$input" | grep -qE '"git commit'; then
  exit 0
fi

PROJ="$(git rev-parse --show-toplevel)"
cd "$PROJ"

echo "=== Eval Gate: pre-commit checks ==="

echo "--- 1/3 npm test"
npm test || { echo "BLOCKED: tests failed — fix before committing"; exit 1; }

echo "--- 2/3 npm run build"
npm run build || { echo "BLOCKED: build failed — fix type errors before committing"; exit 1; }

echo "--- 3/3 checking Pixi imports in pure logic files"
if rg "pixi" src/character.ts src/bubble.ts src/effect.ts 2>/dev/null; then
  echo "BLOCKED: Pixi imports found in pure logic files — move rendering behind handle interfaces"
  exit 1
fi

echo "=== Eval Gate: all checks passed — proceeding with commit ==="
