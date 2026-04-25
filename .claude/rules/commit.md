---
type: commit-rules
updated: 2026-04-25
---

# Commit Rules

## Commit Message

Write a clear, concise commit message using this format:

```
<type>(<scope>): <short summary>

<optional body — explain WHY, not what>
```

**Types:** `feat` · `fix` · `refactor` · `test` · `chore` · `docs`
**Scope** (optional): affected area, e.g. `character`, `registry`, `effect`, `bubble`, `config`, `tauri`

Examples:
- `feat(effect): serial spawn via deferred construction`
- `fix(bubble): cap lifetime when linger overlaps global cooldown`
- `refactor(registry): extract materializeEntry from tick loop`

## GitHub Issue (second-brain devlog)

After every commit, open an issue on **TK3096/second-brain** using `gh`.

### Labels

Always include: `devlog`, `side_projects`, `wisp`
Add based on commit type:
- `feat` / `refactor` / `test` / `chore` / `docs` → add `feature`
- `fix` → add `hotfix`

Create any missing label before opening the issue:
```bash
gh label create <name> --repo TK3096/second-brain --color <hex>
```

### Issue Title

```
[wisp] <what this commit is about>
```

### Issue Body

```markdown
- **Repo:** `<owner>/<repo>`
- **Branch:** `<branch>`
- **Commit:** `<short-sha>`
- **Author:** <git user>
- **Date:** <YYYY-MM-DD>

## Message

<full commit message>

## Files Changed

```
A <added file>
M <modified file>
D <removed file>

```
