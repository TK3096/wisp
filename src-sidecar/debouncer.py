import time
from typing import Callable, Optional


class Debouncer:
    """
    Pure state machine — no cv2 or mediapipe imports.

    Fires (returns True) when:
      - the same label has been observed for `hold_frames` consecutive frames, AND
      - `cooldown_secs` have elapsed since the last fire, AND
      - at least `rearm_frames` non-matching frames have elapsed since the last fire.

    Confidence below `confidence_floor` is treated as no observation (label="").
    """

    def __init__(
        self,
        hold_frames: int = 8,
        cooldown_secs: float = 1.5,
        rearm_frames: int = 5,
        confidence_floor: float = 0.6,
        clock: Optional[Callable[[], float]] = None,
    ) -> None:
        self._hold_frames = hold_frames
        self._cooldown_secs = cooldown_secs
        self._rearm_frames = rearm_frames
        self._confidence_floor = confidence_floor
        self._clock = clock or time.monotonic

        self._hold_count: int = 0
        self._rearm_count: int = 0
        self._last_fired_at: float = -cooldown_secs  # allow immediate first fire
        self._armed: bool = True
        self._current_label: str = ""

    def observe(self, label: str, confidence: float) -> bool:
        """
        Feed one frame of detection. Returns True if a spawn should fire.
        """
        effective_label = label if confidence >= self._confidence_floor else ""

        if effective_label != self._current_label:
            self._hold_count = 0
            self._current_label = effective_label

        if effective_label:
            self._hold_count += 1
            self._rearm_count = 0
        else:
            self._rearm_count += 1
            if not self._armed and self._rearm_count >= self._rearm_frames:
                self._armed = True

        if not effective_label:
            return False

        now = self._clock()
        cooldown_ok = (now - self._last_fired_at) >= self._cooldown_secs
        hold_ok = self._hold_count >= self._hold_frames

        if hold_ok and cooldown_ok and self._armed:
            self._last_fired_at = now
            self._armed = False
            self._hold_count = 0
            return True

        return False
