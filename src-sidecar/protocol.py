import json
import sys


class EventEmitter:
    def emit_ready(self) -> None:
        self._emit({"event": "ready"})

    def emit_spawn(self) -> None:
        self._emit({"event": "spawn"})

    def emit_error(self, kind: str, message: str) -> None:
        self._emit({"event": "error", "kind": kind, "message": message})

    def _emit(self, payload: dict) -> None:
        print(json.dumps(payload), flush=True)
