use wisp_cognition_core::{
    BehaviorBias, CognitionCore, CognitionInit, EnvironmentChange, GestureName, Reaction, Stimulus,
    COGNITION_SCHEMA_VERSION,
};

fn init(seed: u32) -> CognitionInit {
    CognitionInit {
        schema_version: COGNITION_SCHEMA_VERSION,
        character_id: "reaction-character".into(),
        archetype: "neutral".into(),
        personality_seed: seed,
    }
}

fn app_focus() -> Stimulus {
    Stimulus::Environment {
        change: EnvironmentChange::AppFocus,
    }
}

fn app_blur() -> Stimulus {
    Stimulus::Environment {
        change: EnvironmentChange::AppBlur,
    }
}

fn gesture(confidence: f64) -> Stimulus {
    Stimulus::Gesture {
        gesture: GestureName::OpenPalm,
        confidence,
    }
}

fn assert_valid_bias(signal: &wisp_cognition_core::BehaviorSignal) {
    let bias = signal.behavior_bias;
    for value in [
        bias.idle_dwell,
        bias.walk_speed,
        bias.jump_chance,
        bias.bubble_chance,
        bias.animation_pace,
    ] {
        assert!(value.is_finite() && value > 0.0 && value <= 2.0);
    }
}

fn assert_bias_multiplier(
    baseline: BehaviorBias,
    actual: BehaviorBias,
    idle_dwell: f64,
    walk_speed: f64,
    jump_chance: f64,
    bubble_chance: f64,
    animation_pace: f64,
) {
    let multipliers = [
        (baseline.idle_dwell, actual.idle_dwell, idle_dwell, 0.5, 1.5),
        (
            baseline.walk_speed,
            actual.walk_speed,
            walk_speed,
            0.5,
            1.75,
        ),
        (
            baseline.jump_chance,
            actual.jump_chance,
            jump_chance,
            0.2,
            1.8,
        ),
        (
            baseline.bubble_chance,
            actual.bubble_chance,
            bubble_chance,
            0.2,
            1.8,
        ),
        (
            baseline.animation_pace,
            actual.animation_pace,
            animation_pace,
            0.75,
            1.25,
        ),
    ];

    for (base, value, multiplier, min, max) in multipliers {
        let expected = (base * multiplier).clamp(min, max);
        assert!((value - expected).abs() < 1e-12);
    }
}

#[test]
fn micro_belief_projects_slow_bounded_semantic_channels() {
    let mut core = CognitionCore::new(init(17)).unwrap();
    core.observe(gesture(0.96)).unwrap();
    let first = core.tick(0.1).unwrap();

    assert!(first.micro_belief.novelty > 0.0);
    for value in [
        first.micro_belief.novelty,
        first.micro_belief.familiarity,
        first.micro_belief.social_positivity,
        first.micro_belief.caution,
    ] {
        assert!(value.is_finite() && (0.0..=1.0).contains(&value));
    }

    // The accepted passive decay tau is 60 s. This is deliberately a slow
    // observation-level decay, not another short-lived affect state.
    for _ in 0..600 {
        core.tick(0.1).unwrap();
    }
    let minute = core.tick(0.1).unwrap();
    assert!(minute.micro_belief.novelty < first.micro_belief.novelty);
    assert!(minute.micro_belief.novelty > first.micro_belief.novelty * 0.2);
    assert_valid_bias(&minute);

    let mut cautious = CognitionCore::new(init(17)).unwrap();
    cautious.observe(app_blur()).unwrap();
    let projection = cautious.tick(0.1).unwrap().micro_belief;
    assert!(projection.caution > 0.0);
}

#[test]
fn affect_uses_short_lived_rise_and_decay_dynamics() {
    let mut core = CognitionCore::new(init(17)).unwrap();
    core.observe(gesture(0.96)).unwrap();
    let peak = core.tick(0.1).unwrap();

    assert!(peak.affect.surprise > 0.3);
    assert!(peak.affect.arousal > 0.0);

    for _ in 0..100 {
        core.tick(0.1).unwrap();
    }
    let decayed = core.tick(0.1).unwrap();
    assert!(decayed.affect.surprise < peak.affect.surprise * 0.4);
    assert!(decayed.affect.arousal < peak.affect.arousal);
    assert!(decayed.affect.valence >= -1.0 && decayed.affect.valence <= 1.0);
    assert_valid_bias(&decayed);
}

#[test]
fn caution_arc_selects_startle_after_curiosity() {
    let mut core = CognitionCore::new(init(17)).unwrap();

    core.observe(app_blur()).unwrap();
    let first = core.tick(0.1).unwrap();
    assert_eq!(
        first.reaction.kind,
        wisp_cognition_core::Reaction::Curiosity
    );
    for _ in 0..50 {
        core.observe(app_blur()).unwrap();
        core.tick(0.1).unwrap();
    }

    for _ in 0..36 {
        core.tick(0.1).unwrap();
    }

    let mut startled = None;
    for _ in 0..20 {
        core.observe(app_focus()).unwrap();
        let signal = core.tick(0.1).unwrap();
        if signal.reaction.kind == wisp_cognition_core::Reaction::Startle {
            startled = Some(signal);
            break;
        }
    }
    let startled = startled.expect("accumulated caution and change select Startle");
    assert!(startled.micro_belief.caution > startled.micro_belief.novelty);
}

#[test]
fn quiet_boredom_accumulates_without_a_stimulus_and_recovers_after_reaction() {
    let mut core = CognitionCore::new(init(17)).unwrap();

    let mut first_boredom_s = None;
    for step in 0..120 {
        let signal = core.tick(0.1).unwrap();
        if signal.reaction.kind == wisp_cognition_core::Reaction::Boredom {
            first_boredom_s = Some((step + 1) as f64 * 0.1);
            break;
        }
    }
    let first_boredom_s = first_boredom_s.expect("quiet cognition eventually becomes bored");
    assert!(first_boredom_s > 8.0 && first_boredom_s <= 12.0);

    let mut selected_at = Vec::new();
    let mut previous = wisp_cognition_core::Reaction::Boredom;
    for step in 0..400 {
        let signal = core.tick(0.1).unwrap();
        if previous == wisp_cognition_core::Reaction::None
            && signal.reaction.kind != wisp_cognition_core::Reaction::None
        {
            selected_at.push(step as f64 * 0.1);
        }
        previous = signal.reaction.kind;
    }
    assert!(!selected_at.is_empty());
    assert!(selected_at.iter().all(|time| *time >= 11.5));
}

#[test]
fn stimulus_required_reactions_wait_for_the_next_observed_stimulus() {
    let mut core = CognitionCore::new(init(17)).unwrap();
    core.observe(app_blur()).unwrap();
    let observed = core.tick(0.1).unwrap();

    // Let the belief/affect evidence remain high while the pending Stimulus is
    // absent. No curiosity/startle/excitement candidate may self-fire.
    for _ in 0..40 {
        core.tick(0.1).unwrap();
    }
    for _ in 0..10 {
        let quiet = core.tick(0.1).unwrap();
        assert_eq!(quiet.reaction.kind, wisp_cognition_core::Reaction::None);
    }
    // Advance through any temporary Boredom without treating its continued
    // active duration as a new Stimulus-required selection.
    for _ in 0..100 {
        core.tick(0.1).unwrap();
    }
    let mut selected = false;
    for _ in 0..20 {
        core.observe(app_focus()).unwrap();
        let signal = core.tick(0.1).unwrap();
        if signal.reaction.kind != wisp_cognition_core::Reaction::None {
            selected = true;
            break;
        }
    }
    assert!(selected);
    assert!(observed.reaction.candidates.len() == 4);
}

#[test]
fn reaction_selection_is_exclusive_and_respects_global_and_local_cooldowns() {
    let mut core = CognitionCore::new(init(17)).unwrap();
    let mut active_count = 0;
    let mut starts = Vec::new();
    let mut previous: Option<wisp_cognition_core::Reaction> = None;
    let mut kinds = Vec::new();

    for step in 0..500 {
        core.observe(gesture(0.96)).unwrap();
        let signal = core.tick(0.1).unwrap();
        if signal.reaction.kind != wisp_cognition_core::Reaction::None {
            active_count += 1;
        }
        if previous != Some(signal.reaction.kind)
            && signal.reaction.kind != wisp_cognition_core::Reaction::None
        {
            starts.push(step as f64 * 0.1);
        }
        if !kinds.contains(&signal.reaction.kind) {
            kinds.push(signal.reaction.kind);
        }
        previous = Some(signal.reaction.kind);
    }

    assert!(active_count > 0);
    assert!(starts.len() > 1);
    assert!(starts.windows(2).all(|pair| pair[1] - pair[0] >= 0.6));
    assert!(kinds.contains(&wisp_cognition_core::Reaction::Excitement));
}

#[test]
fn every_reaction_emits_only_its_accepted_bias_multipliers() {
    let mut core = CognitionCore::new(init(17)).unwrap();
    let baseline = core.tick(0.1).unwrap().behavior_bias;

    core.observe(app_focus()).unwrap();
    let curiosity = core.tick(0.1).unwrap();
    assert_eq!(curiosity.reaction.kind, Reaction::Curiosity);
    assert_bias_multiplier(
        baseline,
        curiosity.behavior_bias,
        0.65,
        1.15,
        1.25,
        1.40,
        1.08,
    );

    let mut excited = None;
    for _ in 0..500 {
        core.observe(gesture(0.96)).unwrap();
        let signal = core.tick(0.1).unwrap();
        if signal.reaction.kind == Reaction::Excitement {
            excited = Some(signal);
            break;
        }
    }
    let excited = excited.expect("repeated positive gestures select Excitement");
    assert_bias_multiplier(
        baseline,
        excited.behavior_bias,
        0.50,
        1.25,
        1.80,
        1.50,
        1.20,
    );

    let mut quiet = CognitionCore::new(init(17)).unwrap();
    let mut bored = None;
    for _ in 0..120 {
        let signal = quiet.tick(0.1).unwrap();
        if signal.reaction.kind == Reaction::Boredom {
            bored = Some(signal);
            break;
        }
    }
    let bored = bored.expect("quiet inactivity selects Boredom");
    assert_bias_multiplier(baseline, bored.behavior_bias, 0.75, 0.90, 0.55, 1.20, 0.88);

    let mut cautious = CognitionCore::new(init(17)).unwrap();
    for _ in 0..50 {
        cautious.observe(app_blur()).unwrap();
        cautious.tick(0.1).unwrap();
    }
    for _ in 0..36 {
        cautious.tick(0.1).unwrap();
    }
    let mut startled = None;
    for _ in 0..20 {
        cautious.observe(app_focus()).unwrap();
        let signal = cautious.tick(0.1).unwrap();
        if signal.reaction.kind == Reaction::Startle {
            startled = Some(signal);
            break;
        }
    }
    let startled = startled.expect("accumulated caution selects Startle");
    assert_bias_multiplier(
        baseline,
        startled.behavior_bias,
        1.15,
        0.85,
        2.20,
        1.30,
        1.18,
    );
}
#[test]
fn snapshots_preserve_micro_belief_and_active_reaction_state() {
    let mut source = CognitionCore::new(init(17)).unwrap();
    for _ in 0..10 {
        source.observe(app_blur()).unwrap();
        source.tick(0.1).unwrap();
    }
    let snapshot = source.snapshot();
    assert_eq!(snapshot.schema_version, COGNITION_SCHEMA_VERSION);

    let mut left = CognitionCore::new(init(17)).unwrap();
    let mut right = CognitionCore::new(init(17)).unwrap();
    left.restore(snapshot.clone()).unwrap();
    right.restore(snapshot).unwrap();
    let left_signal = left.tick(0.1).unwrap();
    let right_signal = right.tick(0.1).unwrap();

    assert_eq!(left_signal, right_signal);
    assert_eq!(left.snapshot(), right.snapshot());
    assert_valid_bias(&left_signal);
}
