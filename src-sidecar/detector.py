import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from debouncer import Debouncer
from protocol import EventEmitter

_MODEL_PATH = Path(__file__).parent / "gesture_recognizer.task"
_EMPTY_FRAME_LIMIT = 30
_TARGET_GESTURE = "Open_Palm"


class Detector:
    def __init__(self, emitter: EventEmitter, debug: bool = False) -> None:
        self._emitter = emitter
        self._debug = debug
        self._debouncer = Debouncer()

    def run(self) -> None:
        # Load model
        if not _MODEL_PATH.exists():
            self._emitter.emit_error(
                "model_load_failed",
                f"gesture_recognizer.task not found at {_MODEL_PATH}. "
                "Download from https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer",
            )
            sys.exit(1)

        try:
            base_options = mp_python.BaseOptions(model_asset_path=str(_MODEL_PATH))
            options = mp_vision.GestureRecognizerOptions(base_options=base_options)
            recognizer = mp_vision.GestureRecognizer.create_from_options(options)
        except Exception as exc:
            self._emitter.emit_error("model_load_failed", str(exc))
            sys.exit(1)

        # Open camera
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            self._emitter.emit_error("camera_unavailable", "cv2.VideoCapture(0) failed to open")
            sys.exit(1)

        self._emitter.emit_ready()

        empty_streak = 0

        try:
            while True:
                ret, frame = cap.read()
                if not ret or frame is None:
                    empty_streak += 1
                    if empty_streak >= _EMPTY_FRAME_LIMIT:
                        self._emitter.emit_error(
                            "camera_lost",
                            f"{_EMPTY_FRAME_LIMIT} consecutive empty frames — camera may have disconnected",
                        )
                        sys.exit(1)
                    time.sleep(0.033)
                    continue

                empty_streak = 0

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = recognizer.recognize(mp_image)

                label = ""
                confidence = 0.0
                if result.gestures:
                    top = result.gestures[0][0]
                    label = top.category_name
                    confidence = top.score

                fired = self._debouncer.observe(
                    label if label == _TARGET_GESTURE else "", confidence
                )

                if self._debug:
                    print(
                        f"[debug] label={label!r} conf={confidence:.2f} fired={fired}",
                        file=sys.stderr,
                        flush=True,
                    )

                if fired:
                    self._emitter.emit_spawn()

        finally:
            cap.release()
            recognizer.close()
