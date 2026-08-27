use serde_json::json;
use wisp_cognition_core::{CognitionCore, CognitionInit, Stimulus};

fn init(personality_seed: u32, archetype: &str) -> CognitionInit {
    CognitionInit {
        schema_version: 1,
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
fn snapshots_are_versioned_opaque_and_restorable() {
    let mut core = CognitionCore::new(init(0x10203040, "mask-dude")).unwrap();
    core.tick(0.1).unwrap();
    let snapshot = core.snapshot();

    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.character_id, "character-1");
    assert_eq!(
        snapshot.cognition,
        json!({
            "kind": "static-personality-v1",
            "dimensions": {
                "energy": core.dimensions().energy,
                "curiosity": core.dimensions().curiosity,
                "boldness": core.dimensions().boldness,
                "sociability": core.dimensions().sociability,
            }
        })
    );

    let mut restored = CognitionCore::new(init(0x10203040, "mask-dude")).unwrap();
    restored.restore(snapshot.clone()).unwrap();
    assert_eq!(restored.snapshot(), snapshot);
    assert_eq!(restored.dimensions(), core.dimensions());
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
