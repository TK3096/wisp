use serde_json::json;
use wisp_cognition_core::{
    CognitionCore, CognitionInit, FeedbackKind, Stimulus, COGNITION_SCHEMA_VERSION,
};

fn init(personality_seed: u32, archetype: &str) -> CognitionInit {
    CognitionInit {
        schema_version: COGNITION_SCHEMA_VERSION,
        character_id: "character-1".into(),
        archetype: archetype.into(),
        personality_seed,
    }
}

#[test]
fn personality_is_deterministic_and_bounded() {
    let first = CognitionCore::new(init(0x13579bdf, "ninja-frog")).unwrap();
    let repeated = CognitionCore::new(init(0x13579bdf, "ninja-frog")).unwrap();
    let dimensions = first.dimensions();

    assert_eq!(dimensions, repeated.dimensions());
    for value in [
        dimensions.energy,
        dimensions.curiosity,
        dimensions.boldness,
        dimensions.sociability,
    ] {
        assert!(
            (0.0..=1.0).contains(&value),
            "dimension out of range: {value}"
        );
    }
}

#[test]
fn archetypes_and_seeds_create_legible_personality_differences() {
    let energetic = CognitionCore::new(init(0x2468ace0, "ninja-frog")).unwrap();
    let steady = CognitionCore::new(init(0x2468ace0, "virtual-guy")).unwrap();
    let same_archetype = CognitionCore::new(init(0x2468ace1, "ninja-frog")).unwrap();

    assert!(energetic.dimensions().energy > steady.dimensions().energy);
    assert!(energetic.dimensions().boldness > steady.dimensions().boldness);
    assert_ne!(energetic.dimensions(), same_archetype.dimensions());
}

#[test]
fn ticks_emit_only_bounded_behavior_biases() {
    let mut core = CognitionCore::new(init(u32::MAX, "pink-man")).unwrap();
    core.observe(Stimulus::Lifecycle {
        phase: wisp_cognition_core::LifecyclePhase::Materialized,
    })
    .unwrap();

    let signal = core.tick(0.1).unwrap();
    let bias = signal.behavior_bias;

    assert_eq!(signal.affect.surprise, 0.0);
    assert_eq!(signal.affect.valence, 0.0);
    assert_eq!(signal.affect.arousal, 0.0);
    assert!((0.75..=1.25).contains(&bias.idle_dwell));
    assert!((0.8..=1.2).contains(&bias.walk_speed));
    assert!((0.6..=1.4).contains(&bias.jump_chance));
    assert!((0.7..=1.3).contains(&bias.bubble_chance));
    assert!((0.75..=1.25).contains(&bias.animation_pace));
}

#[test]
fn novel_environment_changes_stay_in_accepted_dynamic_behavior_bounds() {
    for seed in [0, u32::MAX] {
        let mut core = CognitionCore::new(init(seed, "neutral")).unwrap();
        core.observe(Stimulus::Environment {
            change: wisp_cognition_core::EnvironmentChange::AppFocus,
        })
        .unwrap();
        let signal = core.tick(0.1).unwrap();
        let bias = signal.behavior_bias;

        assert!(signal.affect.surprise > 0.0);
        assert!(signal.temporal_surprise.centered_energy > 0.0);

        assert!((0.5..=1.5).contains(&bias.idle_dwell));
        assert!((0.5..=1.75).contains(&bias.walk_speed));
        assert!((0.2..=1.8).contains(&bias.jump_chance));
        assert!((0.2..=1.8).contains(&bias.bubble_chance));
        assert!((0.75..=1.25).contains(&bias.animation_pace));
    }
}

#[test]
fn snapshots_are_versioned_opaque_and_restorable() {
    let mut core = CognitionCore::new(init(0x10203040, "mask-dude")).unwrap();
    core.tick(0.1).unwrap();
    let snapshot = core.snapshot();

    assert_eq!(snapshot.schema_version, COGNITION_SCHEMA_VERSION);
    assert_eq!(snapshot.character_id, "character-1");
    assert_eq!(
        snapshot.cognition,
        json!({
            "kind": "micro-belief-reactions-v3",
            "dimensions": {
                "energy": core.dimensions().energy,
                "curiosity": core.dimensions().curiosity,
                "boldness": core.dimensions().boldness,
                "sociability": core.dimensions().sociability,
            },
            "observation": [0.0, 1.0, 0.0],
            "fast": [0.0, 1.0, 0.0],
            "slow": [0.0, 1.0, 0.0],
            "affect": { "surprise": 0.0, "valence": 0.0, "arousal": 0.0 },
            "microBelief": {
                "clockS": 0.1,
                "channels": [0.0, 0.0, 0.0, 0.0],
                "pendingStimulus": null,
                "stimulusCount": 0,
                "boredom": 1.0 / 120.0,
                "active": null,
                "reactionLockS": 0.0,
                "nextEligibleS": [0.0, 0.0, 0.0, 0.0],
            },
        })
    );

    let mut restored = CognitionCore::new(init(0x10203040, "mask-dude")).unwrap();
    restored.restore(snapshot.clone()).unwrap();
    assert_eq!(restored.snapshot(), snapshot);
    assert_eq!(restored.dimensions(), core.dimensions());
}

#[test]
fn explicit_feedback_credits_only_one_bounded_visible_expression() {
    let mut core = CognitionCore::new(init(1, "neutral")).unwrap();
    core.observe(Stimulus::Feedback {
        feedback: FeedbackKind::Delight,
    })
    .unwrap();
    let baseline = core.dimensions();

    core.tick(0.1).unwrap();
    core.note_expression();
    let first = core.dimensions();
    assert!((first.energy - baseline.energy - 0.04).abs() < 1e-12);
    assert!((first.sociability - baseline.sociability - 0.04).abs() < 1e-12);

    // A cue is single-use; expressions without feedback cannot drift.
    core.note_expression();
    assert_eq!(core.dimensions(), first);
    for _ in 0..30 {
        core.tick(0.1).unwrap();
    }
    core.note_expression();
    assert_eq!(core.dimensions(), first);

    let snapshot = core.snapshot();
    let mut restored = CognitionCore::new(init(1, "neutral")).unwrap();
    restored.restore(snapshot.clone()).unwrap();
    // Reward is session runtime state and is deliberately not restorable.
    assert_eq!(restored.dimensions(), baseline);
    assert_eq!(restored.snapshot(), snapshot);
}

#[test]
fn dismiss_reverses_delight_and_drift_is_capped() {
    let mut core = CognitionCore::new(init(1, "neutral")).unwrap();
    let baseline = core.dimensions();

    for _ in 0..3 {
        core.observe(Stimulus::Feedback {
            feedback: FeedbackKind::Delight,
        })
        .unwrap();
        core.note_expression();
    }
    assert!((core.dimensions().energy - baseline.energy - 0.08).abs() < 1e-12);
    assert!((core.dimensions().sociability - baseline.sociability - 0.08).abs() < 1e-12);

    core.observe(Stimulus::Feedback {
        feedback: FeedbackKind::Dismiss,
    })
    .unwrap();
    core.note_expression();
    assert!((core.dimensions().energy - baseline.energy - 0.04).abs() < 1e-12);
    assert!((core.dimensions().sociability - baseline.sociability - 0.04).abs() < 1e-12);
}

#[test]
fn gestures_never_mutate_personality_dimensions() {
    let mut core = CognitionCore::new(init(1, "neutral")).unwrap();
    let baseline = core.dimensions();
    for count in 0..12 {
        core.observe(Stimulus::Gesture {
            gesture: wisp_cognition_core::GestureName::OpenPalm,
            confidence: if count % 2 == 0 { 0.96 } else { 0.32 },
        })
        .unwrap();
        core.tick(0.1).unwrap();
        assert_eq!(core.dimensions(), baseline);
    }
}

#[test]
fn restores_reject_mismatched_identity_and_version() {
    let mut core = CognitionCore::new(init(1, "mask-dude")).unwrap();
    let mut snapshot = core.snapshot();
    snapshot.character_id = "character-2".into();
    assert!(core.restore(snapshot).is_err());

    let mut old = core.snapshot();
    old.schema_version = 0;
    assert!(core.restore(old).is_err());
}
