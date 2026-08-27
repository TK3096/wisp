use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;

pub const COGNITION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GestureName {
    #[serde(rename = "openPalm")]
    OpenPalm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifecyclePhase {
    #[serde(rename = "materialized")]
    Materialized,
    #[serde(rename = "vanishing")]
    Vanishing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EnvironmentChange {
    #[serde(rename = "appFocus")]
    AppFocus,
    #[serde(rename = "appBlur")]
    AppBlur,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Stimulus {
    Gesture {
        gesture: GestureName,
        confidence: f64,
    },
    Lifecycle {
        phase: LifecyclePhase,
    },
    Environment {
        change: EnvironmentChange,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CognitionInit {
    pub schema_version: u32,
    pub character_id: String,
    pub archetype: String,
    pub personality_seed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityDimensions {
    pub energy: f64,
    pub curiosity: f64,
    pub boldness: f64,
    pub sociability: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Affect {
    pub surprise: f64,
    pub valence: f64,
    pub arousal: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorBias {
    pub idle_dwell: f64,
    pub walk_speed: f64,
    pub jump_chance: f64,
    pub bubble_chance: f64,
    pub animation_pace: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorSignal {
    pub affect: Affect,
    pub temporal_surprise: TemporalSurprise,
    pub behavior_bias: BehaviorBias,
}

/// The bounded Temporal Derivative summary emitted by each Cognition step.
///
/// `gate` is the raw sigmoid gate in `[0, 1]` and therefore rests at `0.5`
/// during inactivity. `centered_energy` recentres that gate to `[0, 1]` so a
/// stationary observation produces exactly zero surprise energy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporalSurprise {
    /// L2 norm of the current `(fast - slow)` observation difference.
    pub derivative_norm: f64,
    /// `sigmoid(beta * derivative_norm)`.
    pub gate: f64,
    /// `clamp(2 * gate - 1, 0, 1)`; the derivative-derived surprise energy.
    pub centered_energy: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistentCognitionState {
    pub schema_version: u32,
    pub character_id: String,
    pub cognition: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemporalPersonalityState {
    kind: String,
    dimensions: PersonalityDimensions,
    observation: ObservationVector,
    fast: ObservationVector,
    slow: ObservationVector,
    affect: Affect,
}

type ObservationVector = [f64; OBSERVATION_DIMENSIONS];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CognitionError {
    UnsupportedSchemaVersion,
    EmptyCharacterId,
    EmptyArchetype,
    InvalidCognitionState,
    InvalidStimulus,
    InvalidDt,
}

impl fmt::Display for CognitionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::UnsupportedSchemaVersion => "Unsupported Cognition State schema version",
            Self::EmptyCharacterId => "Character Identity must not be empty",
            Self::EmptyArchetype => "Archetype must not be empty",
            Self::InvalidCognitionState => "Persistent Cognition State is invalid",
            Self::InvalidStimulus => "Stimulus is invalid",
            Self::InvalidDt => "Cognition dt must be finite and non-negative",
        };
        f.write_str(message)
    }
}

impl std::error::Error for CognitionError {}

pub type CognitionResult<T> = Result<T, CognitionError>;

const NEUTRAL_AFFECT: Affect = Affect {
    surprise: 0.0,
    valence: 0.0,
    arousal: 0.0,
};
const PERSONALITY_JITTER: f64 = 0.12;
/// Number of bounded semantic observation channels fed to the derivative.
const OBSERVATION_DIMENSIONS: usize = 3;
const GESTURE_CHANNEL: usize = 0;
const LIFECYCLE_CHANNEL: usize = 1;
const ENVIRONMENT_CHANNEL: usize = 2;
/// Canonical Temporal Derivative coefficients: fast ≈ 10× slow.
const ALPHA_FAST: f64 = 0.3;
const ALPHA_SLOW: f64 = 0.03;
/// Sigmoid inverse temperature applied to the derivative norm.
const SURPRISE_GATE_BETA: f64 = 6.0;
/// Short-lived affect decay time constants, in seconds.
const SURPRISE_DECAY_TAU_S: f64 = 0.6;
const AROUSAL_DECAY_TAU_S: f64 = 1.5;
const TEMPORAL_STATE_KIND: &str = "temporal-personality-v1";

pub struct CognitionCore {
    schema_version: u32,
    character_id: String,
    dimensions: PersonalityDimensions,
    temporal: TemporalState,
    signal: BehaviorSignal,
}

/// The mutable Temporal Derivative state that travels through every step.
///
/// `observation` holds the latest bounded semantic level per channel. Stimuli
/// replace those levels immediately (last writer wins within a Cognition
/// step), while the EMAs and short-lived affect advance only on `tick`.
/// Replacing a level with the same value is intentionally a no-op, which is
/// what makes repeated similar stimuli habituate.
#[derive(Debug, Clone, Copy)]
struct TemporalState {
    /// Latest bounded semantic observation level. Stimuli replace channel
    /// levels immediately; the derivative itself advances only on `tick`.
    observation: ObservationVector,
    fast: ObservationVector,
    slow: ObservationVector,
    affect: Affect,
}

impl CognitionCore {
    pub fn new(init: CognitionInit) -> CognitionResult<Self> {
        if init.schema_version != COGNITION_SCHEMA_VERSION {
            return Err(CognitionError::UnsupportedSchemaVersion);
        }
        if init.character_id.trim().is_empty() {
            return Err(CognitionError::EmptyCharacterId);
        }
        if init.archetype.trim().is_empty() {
            return Err(CognitionError::EmptyArchetype);
        }

        let dimensions = compose_dimensions(&init.archetype, init.personality_seed);
        // A new character is already Materialized and has observed no gesture
        // or environment change. Starting every EMA at that resting level
        // removes the startup transient, so inactivity is exactly zero.
        let temporal = TemporalState {
            observation: [0.0, 1.0, 0.0],
            fast: [0.0, 1.0, 0.0],
            slow: [0.0, 1.0, 0.0],
            affect: NEUTRAL_AFFECT,
        };
        Ok(Self {
            schema_version: init.schema_version,
            character_id: init.character_id,
            dimensions,
            temporal,
            signal: Self::compose_signal(dimensions, &temporal),
        })
    }

    pub fn dimensions(&self) -> PersonalityDimensions {
        self.dimensions
    }

    pub fn observe(&mut self, stimulus: Stimulus) -> CognitionResult<()> {
        if let Stimulus::Gesture { confidence, .. } = stimulus {
            if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
                return Err(CognitionError::InvalidStimulus);
            }
        }
        // Stimuli update bounded observation levels. Replacing the same level
        // with the same value is intentionally a no-op: repeated similar
        // stimuli habituate instead of re-triggering novelty.
        match stimulus {
            Stimulus::Gesture { confidence, .. } => {
                self.temporal.observation[GESTURE_CHANNEL] = confidence;
            }
            Stimulus::Lifecycle { phase } => {
                self.temporal.observation[LIFECYCLE_CHANNEL] = match phase {
                    LifecyclePhase::Materialized => 1.0,
                    LifecyclePhase::Vanishing => -1.0,
                };
            }
            Stimulus::Environment { change } => {
                self.temporal.observation[ENVIRONMENT_CHANNEL] = match change {
                    EnvironmentChange::AppFocus => 1.0,
                    EnvironmentChange::AppBlur => -1.0,
                };
            }
        }
        Ok(())
    }

    pub fn tick(&mut self, dt: f64) -> CognitionResult<BehaviorSignal> {
        if !dt.is_finite() || dt < 0.0 {
            return Err(CognitionError::InvalidDt);
        }
        let previous_energy =
            temporal_surprise(&self.temporal.fast, &self.temporal.slow).centered_energy;
        for channel in 0..OBSERVATION_DIMENSIONS {
            self.temporal.fast[channel] +=
                ALPHA_FAST * (self.temporal.observation[channel] - self.temporal.fast[channel]);
            self.temporal.slow[channel] +=
                ALPHA_SLOW * (self.temporal.observation[channel] - self.temporal.slow[channel]);
        }

        let temporal_surprise = temporal_surprise(&self.temporal.fast, &self.temporal.slow);
        // Short-lived affect integrates only novelty *rises*, then leaks away
        // on the accepted timescale. A sustained or repeated observation level
        // therefore habituates instead of pinning surprise at its peak.
        let novelty_rise = (temporal_surprise.centered_energy - previous_energy).max(0.0);
        let surprise_decay = (-dt / SURPRISE_DECAY_TAU_S).exp();
        let arousal_decay = (-dt / AROUSAL_DECAY_TAU_S).exp();
        self.temporal.affect.surprise =
            (self.temporal.affect.surprise * surprise_decay + novelty_rise).clamp(0.0, 1.0);
        self.temporal.affect.arousal =
            (self.temporal.affect.arousal * arousal_decay + novelty_rise).clamp(0.0, 1.0);
        // Signed valence waits for the explicit-delight/dismiss reward work;
        // surprise alone must not invent an unverifiable positive/negative mood.
        self.temporal.affect.valence = 0.0;

        self.signal = behavior_signal(self.dimensions, self.temporal.affect, temporal_surprise);
        Ok(self.signal)
    }

    pub fn snapshot(&self) -> PersistentCognitionState {
        PersistentCognitionState {
            schema_version: self.schema_version,
            character_id: self.character_id.clone(),
            cognition: json!(TemporalPersonalityState {
                kind: TEMPORAL_STATE_KIND.to_owned(),
                dimensions: self.dimensions,
                observation: self.temporal.observation,
                fast: self.temporal.fast,
                slow: self.temporal.slow,
                affect: self.temporal.affect,
            }),
        }
    }

    pub fn restore(&mut self, state: PersistentCognitionState) -> CognitionResult<()> {
        if state.schema_version != COGNITION_SCHEMA_VERSION {
            return Err(CognitionError::UnsupportedSchemaVersion);
        }
        if state.character_id != self.character_id {
            return Err(CognitionError::InvalidCognitionState);
        }

        let restored: TemporalPersonalityState = serde_json::from_value(state.cognition)
            .map_err(|_| CognitionError::InvalidCognitionState)?;
        if restored.kind != TEMPORAL_STATE_KIND || restored.dimensions != self.dimensions {
            return Err(CognitionError::InvalidCognitionState);
        }
        if !valid_dimensions(restored.dimensions) {
            return Err(CognitionError::InvalidCognitionState);
        }
        if !valid_observation_vector(restored.observation)
            || !valid_observation_vector(restored.fast)
            || !valid_observation_vector(restored.slow)
            || !valid_affect(restored.affect)
        {
            return Err(CognitionError::InvalidCognitionState);
        }

        self.dimensions = restored.dimensions;
        self.temporal = TemporalState {
            observation: restored.observation,
            fast: restored.fast,
            slow: restored.slow,
            affect: restored.affect,
        };
        self.signal = Self::compose_signal(self.dimensions, &self.temporal);
        Ok(())
    }

    fn compose_signal(
        dimensions: PersonalityDimensions,
        temporal: &TemporalState,
    ) -> BehaviorSignal {
        behavior_signal(
            dimensions,
            temporal.affect,
            temporal_surprise(&temporal.fast, &temporal.slow),
        )
    }
}

fn compose_dimensions(archetype: &str, seed: u32) -> PersonalityDimensions {
    let profile = archetype_profile(archetype);
    compose_bounded_dimensions(profile, seed)
}

fn compose_bounded_dimensions(profile: PersonalityDimensions, seed: u32) -> PersonalityDimensions {
    PersonalityDimensions {
        energy: clamp_dimension(profile.energy + seeded_jitter(seed, 1)),
        curiosity: clamp_dimension(profile.curiosity + seeded_jitter(seed, 2)),
        boldness: clamp_dimension(profile.boldness + seeded_jitter(seed, 3)),
        sociability: clamp_dimension(profile.sociability + seeded_jitter(seed, 4)),
    }
}

fn archetype_profile(archetype: &str) -> PersonalityDimensions {
    match archetype {
        "mask-dude" => PersonalityDimensions {
            energy: 0.55,
            curiosity: 0.45,
            boldness: 0.50,
            sociability: 0.50,
        },
        "ninja-frog" => PersonalityDimensions {
            energy: 0.78,
            curiosity: 0.65,
            boldness: 0.82,
            sociability: 0.35,
        },
        "pink-man" => PersonalityDimensions {
            energy: 0.70,
            curiosity: 0.50,
            boldness: 0.60,
            sociability: 0.80,
        },
        "virtual-guy" => PersonalityDimensions {
            energy: 0.45,
            curiosity: 0.60,
            boldness: 0.40,
            sociability: 0.70,
        },
        _ => PersonalityDimensions {
            energy: 0.50,
            curiosity: 0.50,
            boldness: 0.50,
            sociability: 0.50,
        },
    }
}

fn seeded_jitter(seed: u32, channel: u32) -> f64 {
    let mut z = (u64::from(seed) ^ (u64::from(channel).wrapping_mul(0x9e3779b97f4a7c15)))
        .wrapping_add(0x6d2b79f5);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^= z >> 31;
    let unit = (z >> 11) as f64 / ((1u64 << 53) as f64);
    (unit * 2.0 - 1.0) * PERSONALITY_JITTER
}

fn clamp_dimension(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn valid_dimensions(dimensions: PersonalityDimensions) -> bool {
    [
        dimensions.energy,
        dimensions.curiosity,
        dimensions.boldness,
        dimensions.sociability,
    ]
    .iter()
    .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
}

fn valid_observation_vector(vector: ObservationVector) -> bool {
    vector
        .iter()
        .all(|value| value.is_finite() && (-1.0..=1.0).contains(value))
}

fn valid_affect(affect: Affect) -> bool {
    affect.surprise.is_finite()
        && (0.0..=1.0).contains(&affect.surprise)
        && affect.valence.is_finite()
        && (-1.0..=1.0).contains(&affect.valence)
        && affect.arousal.is_finite()
        && (0.0..=1.0).contains(&affect.arousal)
}

fn sigmoid(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exp = value.exp();
        exp / (1.0 + exp)
    }
}

fn temporal_surprise(fast: &ObservationVector, slow: &ObservationVector) -> TemporalSurprise {
    let squared_norm = (0..OBSERVATION_DIMENSIONS)
        .map(|channel| {
            let derivative = fast[channel] - slow[channel];
            derivative * derivative
        })
        .sum::<f64>();
    // Defensive against a negative zero/rounding artifact; the square sum is
    // otherwise non-negative for finite inputs.
    let derivative_norm = squared_norm.max(0.0).sqrt();
    let gate = (sigmoid(SURPRISE_GATE_BETA * derivative_norm)).clamp(0.0, 1.0);
    TemporalSurprise {
        derivative_norm,
        gate,
        centered_energy: (2.0 * gate - 1.0).clamp(0.0, 1.0),
    }
}

fn behavior_signal(
    dimensions: PersonalityDimensions,
    affect: Affect,
    temporal_surprise: TemporalSurprise,
) -> BehaviorSignal {
    let energy = dimensions.energy;
    let curiosity = dimensions.curiosity;
    let engagement = energy * 0.7 + curiosity * 0.3;
    let surprise = affect.surprise;
    let arousal = affect.arousal;

    BehaviorSignal {
        affect,
        temporal_surprise,
        behavior_bias: reaction_bias(
            BehaviorBias {
                idle_dwell: 1.25 - 0.5 * engagement,
                walk_speed: 0.8 + 0.4 * energy,
                jump_chance: 0.6 + 0.8 * dimensions.boldness,
                bubble_chance: 0.7 + 0.6 * dimensions.sociability,
                animation_pace: 0.85 + 0.3 * energy,
            },
            surprise,
            arousal,
        ),
    }
}

/// Map short-lived affect onto bounded behavior tendencies. Cognition never
/// selects or commands an action; it only bends the scheduler's existing odds.
fn reaction_bias(base: BehaviorBias, surprise: f64, arousal: f64) -> BehaviorBias {
    BehaviorBias {
        idle_dwell: (base.idle_dwell * (1.0 - 0.30 * arousal)).clamp(0.5, 1.5),
        walk_speed: (base.walk_speed * (1.0 + 0.35 * arousal)).clamp(0.5, 1.75),
        jump_chance: (base.jump_chance * (1.0 + 0.55 * surprise)).clamp(0.2, 1.8),
        bubble_chance: (base.bubble_chance * (1.0 + 0.45 * surprise)).clamp(0.2, 1.8),
        animation_pace: (base.animation_pace * (1.0 + 0.12 * arousal)).clamp(0.75, 1.25),
    }
}
