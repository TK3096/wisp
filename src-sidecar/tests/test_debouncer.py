"""
Debouncer unit tests using a synthetic frame sequence and injectable fake clock.
All tests use label "Open_Palm" as the target gesture.
"""
import pytest
from debouncer import Debouncer

LABEL = "Open_Palm"
CONF = 0.9  # above 0.6 floor
LOW_CONF = 0.3  # below floor → treated as no observation


def make_debouncer(**kwargs):
    t = [0.0]
    def clock():
        return t[0]
    def advance(secs):
        t[0] += secs
    d = Debouncer(clock=clock, **kwargs)
    return d, advance


# ── 1. Fire exactly at hold threshold ─────────────────────────────────────────

def test_fires_at_hold_threshold():
    d, _ = make_debouncer(hold_frames=4, cooldown_secs=1.0, rearm_frames=2)
    results = [d.observe(LABEL, CONF) for _ in range(4)]
    assert results == [False, False, False, True]


# ── 2. Does not fire one frame short ─────────────────────────────────────────

def test_does_not_fire_before_threshold():
    d, _ = make_debouncer(hold_frames=4, cooldown_secs=1.0, rearm_frames=2)
    results = [d.observe(LABEL, CONF) for _ in range(3)]
    assert all(r is False for r in results)


# ── 3. Cooldown blocks re-fire ────────────────────────────────────────────────

def test_cooldown_blocks_refire():
    d, advance = make_debouncer(hold_frames=2, cooldown_secs=2.0, rearm_frames=1)
    # First fire
    d.observe(LABEL, CONF)
    first = d.observe(LABEL, CONF)
    assert first is True

    # Rearm: one non-matching frame
    d.observe("", 0.0)

    # Attempt before cooldown expires
    advance(1.0)
    d.observe(LABEL, CONF)
    blocked = d.observe(LABEL, CONF)
    assert blocked is False

    # After cooldown — hold counter carried over from blocked frames, so fires immediately
    advance(2.0)
    second = d.observe(LABEL, CONF)
    assert second is True


# ── 4. Rearm requirement blocks if too few non-matching frames ────────────────

def test_rearm_requirement_enforced():
    d, advance = make_debouncer(hold_frames=2, cooldown_secs=0.0, rearm_frames=5)
    # First fire
    d.observe(LABEL, CONF)
    d.observe(LABEL, CONF)

    # Only 2 non-matching frames (need 5)
    d.observe("", 0.0)
    d.observe("", 0.0)

    advance(10.0)  # cooldown long past
    d.observe(LABEL, CONF)
    blocked = d.observe(LABEL, CONF)
    assert blocked is False


# ── 5. Rearm unlocks after enough non-matching frames ────────────────────────

def test_rearm_unlocks_after_enough_frames():
    d, advance = make_debouncer(hold_frames=2, cooldown_secs=0.0, rearm_frames=3)
    d.observe(LABEL, CONF)
    d.observe(LABEL, CONF)  # fired

    for _ in range(3):
        d.observe("", 0.0)  # rearm complete

    advance(1.0)
    d.observe(LABEL, CONF)
    second = d.observe(LABEL, CONF)
    assert second is True


# ── 6. Hold counter resets on mid-hold dropout ───────────────────────────────

def test_mid_hold_dropout_resets_counter():
    d, _ = make_debouncer(hold_frames=4, cooldown_secs=0.0, rearm_frames=1)
    d.observe(LABEL, CONF)
    d.observe(LABEL, CONF)
    d.observe(LABEL, CONF)
    d.observe("", 0.0)   # dropout — resets hold count
    results = [d.observe(LABEL, CONF) for _ in range(4)]
    assert results[-1] is True and not any(results[:-1])


# ── 7. Confidence below floor treated as empty ───────────────────────────────

def test_confidence_below_floor_is_ignored():
    d, _ = make_debouncer(hold_frames=3, cooldown_secs=0.0, rearm_frames=1)
    results = [d.observe(LABEL, LOW_CONF) for _ in range(10)]
    assert all(r is False for r in results)


# ── 8. Transition between gestures resets hold ───────────────────────────────

def test_gesture_transition_resets_hold():
    d, _ = make_debouncer(hold_frames=3, cooldown_secs=0.0, rearm_frames=1)
    d.observe(LABEL, CONF)
    d.observe(LABEL, CONF)
    d.observe("Closed_Fist", CONF)  # different label → resets
    results = [d.observe(LABEL, CONF) for _ in range(3)]
    assert results == [False, False, True]


# ── 9. Simultaneous cooldown expiry and rearm works correctly ─────────────────

def test_simultaneous_cooldown_and_rearm_expiry():
    d, advance = make_debouncer(hold_frames=2, cooldown_secs=1.0, rearm_frames=3)
    d.observe(LABEL, CONF)
    d.observe(LABEL, CONF)  # first fire

    for _ in range(3):
        d.observe("", 0.0)  # hits rearm threshold exactly

    advance(1.0)  # hits cooldown expiry exactly

    d.observe(LABEL, CONF)
    second = d.observe(LABEL, CONF)
    assert second is True
