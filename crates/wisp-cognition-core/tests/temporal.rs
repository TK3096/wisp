use serde_json::json;
use wisp_cognition_core::{
    BehaviorSignal, CognitionCore, CognitionInit, GestureName, PersonalityDimensions, Stimulus,
    COGNITION_SCHEMA_VERSION,
};

fn init(personality_seed: u32) -> CognitionInit {
    CognitionInit {
        schema_version: COGNITION_SCHEMA_VERSION,
        character_id: "character-1".into(),
        archetype: "ninja-frog".into(),
        personality_seed,
    }
}

fn gesture(confidence: f64) -> Stimulus {
    Stimulus::Gesture {
        gesture: GestureName::OpenPalm,
        confidence,
    }
}

fn assert_bounded(signal: &BehaviorSignal) {
    let affect = &signal.affect;
    let temporal = &signal.temporal_surprise;
    let bias = &signal.behavior_bias;

    assert!(affect.surprise.is_finite() && (0.0..=1.0).contains(&affect.surprise));
    assert!(affect.valence.is_finite() && (-1.0..=1.0).contains(&affect.valence));
    assert!(affect.arousal.is_finite() && (0.0..=1.0).contains(&affect.arousal));
    assert!(
        temporal.derivative_norm.is_finite() && (0.0..=4.0).contains(&temporal.derivative_norm)
    );
    assert!(temporal.gate.is_finite() && (0.0..=1.0).contains(&temporal.gate));
    assert!(
        temporal.centered_energy.is_finite() && (0.0..=1.0).contains(&temporal.centered_energy)
    );
    assert!(bias.idle_dwell.is_finite() && (0.0..=2.0).contains(&bias.idle_dwell));
    assert!(bias.walk_speed.is_finite() && (0.0..=2.0).contains(&bias.walk_speed));
    assert!(bias.jump_chance.is_finite() && (0.0..=2.0).contains(&bias.jump_chance));
    assert!(bias.bubble_chance.is_finite() && (0.0..=2.0).contains(&bias.bubble_chance));
    assert!(bias.animation_pace.is_finite() && (0.75..=1.25).contains(&bias.animation_pace));
}

#[test]
fn neutral_inactivity_produces_zero_centered_surprise() {
    let mut core = CognitionCore::new(init(7)).unwrap();

    for _ in 0..20 {
        let signal = core.tick(0.1).unwrap();
        assert_eq!(signal.affect.surprise, 0.0);
        assert_eq!(signal.affect.arousal, 0.0);
        assert_eq!(signal.temporal_surprise.derivative_norm, 0.0);
        assert_eq!(signal.temporal_surprise.gate, 0.5);
        assert_eq!(signal.temporal_surprise.centered_energy, 0.0);
    }
}

#[test]
fn novel_gesture_creates_measurable_bounded_reaction() {
    let mut baseline = CognitionCore::new(init(7)).unwrap();
    let mut reactive = CognitionCore::new(init(7)).unwrap();

    reactive.observe(gesture(0.96)).unwrap();
    let baseline_signal = baseline.tick(0.1).unwrap();
    let signal = reactive.tick(0.1).unwrap();

    assert!(signal.temporal_surprise.centered_energy > 0.3);
    assert!(signal.temporal_surprise.gate > 0.5);
    assert!(signal.affect.surprise > 0.3);
    assert!(signal.affect.arousal > 0.0);
    assert!(signal.affect.valence >= -1.0 && signal.affect.valence <= 1.0);
    assert!(
        signal.behavior_bias.jump_chance > baseline_signal.behavior_bias.jump_chance,
        "novel gesture must raise the bounded jump tendency"
    );
    assert!(signal.behavior_bias.bubble_chance > baseline_signal.behavior_bias.bubble_chance);
    assert_bounded(&signal);
    assert_bounded(&baseline_signal);
}

#[test]
fn strongest_novel_gesture_stays_finite_and_bounded() {
    let mut core = CognitionCore::new(init(u32::MAX)).unwrap();
    core.observe(gesture(1.0)).unwrap();

    for _ in 0..50 {
        let signal = core.tick(0.1).unwrap();
        assert_bounded(&signal);
    }
}

#[test]
fn repeated_similar_gestures_habituate_and_decay() {
    let mut core = CognitionCore::new(init(11)).unwrap();
    core.observe(gesture(0.96)).unwrap();

    let mut surprises = Vec::new();
    for _ in 0..40 {
        // The stimulus keeps arriving while cognition keeps stepping.
        core.observe(gesture(0.96)).unwrap();
        surprises.push(core.tick(0.1).unwrap().affect.surprise);
    }

    let peak = surprises.iter().cloned().fold(f64::MIN, f64::max);
    assert!(
        peak > 0.3,
        "novel gesture must be measurable: {surprises:?}"
    );
    assert!(
        surprises[30..].iter().all(|value| *value < 0.05),
        "repeated similar stimuli must habituate: {surprises:?}"
    );

    let peak_index = surprises
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.total_cmp(b))
        .unwrap()
        .0;
    for pair in surprises[peak_index..].windows(2) {
        assert!(
            pair[1] <= pair[0] + 1e-12,
            "surprise must decay after its peak: {surprises:?}"
        );
    }

    // A novel gesture for a fresh character is much stronger than the habituated tail.
    let mut fresh = CognitionCore::new(init(11)).unwrap();
    fresh.observe(gesture(0.96)).unwrap();
    let fresh_signal = fresh.tick(0.1).unwrap();
    assert!(fresh_signal.affect.surprise > *surprises.last().unwrap());
}

#[test]
fn snapshots_preserve_temporal_state_across_restore() {
    let mut core = CognitionCore::new(init(0x10203040)).unwrap();
    core.observe(gesture(0.91)).unwrap();
    core.tick(0.1).unwrap();
    let snapshot = core.snapshot();

    assert_eq!(snapshot.schema_version, COGNITION_SCHEMA_VERSION);
    assert_eq!(snapshot.character_id, "character-1");
    assert_eq!(
        snapshot.cognition["kind"],
        json!("micro-belief-reactions-v2")
    );

    let mut restored = CognitionCore::new(init(0x10203040)).unwrap();
    restored.restore(snapshot.clone()).unwrap();
    assert_eq!(restored.snapshot(), snapshot);
    assert_eq!(restored.tick(0.1).unwrap(), core.tick(0.1).unwrap());
}

#[test]
fn restores_reject_invalid_temporal_state() {
    let mut core = CognitionCore::new(init(1)).unwrap();
    core.observe(gesture(0.8)).unwrap();
    core.tick(0.1).unwrap();
    let snapshot = core.snapshot();

    let mut nonfinite = snapshot.clone();
    nonfinite.cognition["fast"][0] = json!(null);
    assert!(core.restore(nonfinite).is_err());

    let mut unbounded = snapshot.clone();
    unbounded.cognition["affect"]["surprise"] = json!(1.5);
    assert!(core.restore(unbounded).is_err());

    let mut wrong_dimensions = snapshot;
    wrong_dimensions.cognition["dimensions"] = json!(PersonalityDimensions {
        energy: 0.5,
        curiosity: 0.5,
        boldness: 0.5,
        sociability: 0.5,
    });
    assert!(core.restore(wrong_dimensions).is_err());
}
