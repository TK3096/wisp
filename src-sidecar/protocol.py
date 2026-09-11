import json
import sys
import math


class EventEmitter:
    def emit_ready(self) -> None:
        self._emit({"event": "ready"})

    def emit_open_palm(self, confidence: float) -> None:
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError("gesture confidence must be finite and within [0, 1]")
        self._emit(
            {
                "event": "gesture",
                "gesture": "openPalm",
                "confidence": confidence,
            }
        )

    def emit_error(self, kind: str, message: str) -> None:
        self._emit({"event": "error", "kind": kind, "message": message})

    def _emit(self, payload: dict) -> None:
        print(json.dumps(payload), flush=True)
