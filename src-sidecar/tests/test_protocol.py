import json

import pytest

from protocol import EventEmitter


def test_emits_bounded_open_palm_gesture_event(capsys):
    emitter = EventEmitter()

    emitter.emit_open_palm(0.87)

    emitted = json.loads(capsys.readouterr().out)
    assert emitted == {
        "event": "gesture",
        "gesture": "openPalm",
        "confidence": 0.87,
    }


@pytest.mark.parametrize("confidence", [-0.01, 1.01, float("nan")])
def test_rejects_non_finite_or_out_of_range_confidence(confidence):
    emitter = EventEmitter()

    with pytest.raises(ValueError):
        emitter.emit_open_palm(confidence)
