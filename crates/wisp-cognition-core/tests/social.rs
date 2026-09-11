use wisp_cognition_core::{CognitionCore, CognitionInit, COGNITION_SCHEMA_VERSION};

fn init(character_id: &str) -> CognitionInit {
    CognitionInit {
        schema_version: COGNITION_SCHEMA_VERSION,
        character_id: character_id.into(),
        archetype: "neutral".into(),
        personality_seed: 17,
    }
}

#[test]
fn exposes_bounded_eight_dimensional_social_projection() {
    let core = CognitionCore::new(init("social-character")).unwrap();
    let projection = core.social_projection();

    assert_eq!(projection.len(), 8);
    assert!(projection
        .iter()
        .all(|value| value.is_finite() && (-1.0..=1.0).contains(value)));
    assert_eq!(core.dimensions().sociability, projection[3]);
}

#[test]
fn social_influence_enters_the_slow_social_channel_only() {
    let mut core = CognitionCore::new(init("social-character")).unwrap();
    let baseline = core.social_projection()[7];
    core.apply_social_influence(0.5).unwrap();
    let influenced = core.social_projection()[7];

    assert!(influenced > baseline);
    assert!((0.0..=1.0).contains(&influenced));
    assert!(core.tick(0.1).unwrap().micro_belief.social_positivity > 0.0);

    assert!(core.apply_social_influence(f64::NAN).is_err());
    assert!(core.apply_social_influence(f64::INFINITY).is_err());
}

#[test]
fn rejected_and_bounded_influences_preserve_durable_state() {
    let mut core = CognitionCore::new(init("social-character")).unwrap();
    core.apply_social_influence(-2.0).unwrap();
    let clamped = core.social_projection()[7];
    assert_eq!(clamped, 0.0);

    let snapshot = core.snapshot();
    let mut restored = CognitionCore::new(init("social-character")).unwrap();
    restored.restore(snapshot).unwrap();
    assert_eq!(restored.social_projection(), core.social_projection());
}
