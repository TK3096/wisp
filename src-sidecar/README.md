# Wisp Sidecar

Python gesture-detection process that communicates with the Rust backend via NDJSON on stdout.

## One-time setup

```bash
brew install python@3.12
python3.12 -m venv src-sidecar/.venv
src-sidecar/.venv/bin/pip install -r src-sidecar/requirements.txt
```

## Run standalone

```bash
# Stub mode (emits spawn every 1s)
.venv/bin/python main.py

# Simulate error after 2s
.venv/bin/python main.py --simulate-error

# Real gesture detection (slice 3+)
.venv/bin/python main.py --debug   # prints per-frame state to stderr
```

## Protocol

All output is NDJSON (one JSON object per line) on stdout. The process reads `PYTHONUNBUFFERED=1` from the environment (set by Rust) to prevent buffering.

| Event | Meaning |
|-------|---------|
| `{"event":"ready"}` | Sidecar initialized, camera/model loaded |
| `{"event":"spawn"}` | Open Palm gesture detected — summon a character |
| `{"event":"error","kind":"...","message":"..."}` | Fatal error, process will exit |

## Tests

```bash
cd src-sidecar
.venv/bin/pytest
```
