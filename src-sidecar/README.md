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
# Real gesture detection
.venv/bin/python main.py --debug   # prints per-frame state to stderr
```

## Protocol

All output is NDJSON (one JSON object per line) on stdout. The process reads `PYTHONUNBUFFERED=1` from the environment (set by Rust) to prevent buffering.

| Event | Meaning |
|-------|---------|
| `{"event":"ready"}` | Sidecar initialized, camera/model loaded |
| `{"event":"gesture","gesture":"openPalm","confidence":0.9}` | Open Palm detected after debouncing; Rust forwards cognition observation and spawn policy separately |
| `{"event":"error","kind":"...","message":"..."}` | Fatal error, process will exit |

## Tests

```bash
cd src-sidecar
.venv/bin/pytest
```
