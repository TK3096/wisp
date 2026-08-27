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
    pub behavior_bias: BehaviorBias,
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
struct StaticPersonalityState {
    kind: String,
    dimensions: PersonalityDimensions,
}

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

pub struct CognitionCore {
    schema_version: u32,
    character_id: String,
    dimensions: PersonalityDimensions,
    signal: BehaviorSignal,
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
        let signal = behavior_signal(dimensions);
        Ok(Self {
            schema_version: init.schema_version,
            character_id: init.character_id,
            dimensions,
            signal,
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
        // Static personality accepts semantic stimuli but does not change its durable
        // composition. Dynamic cognition layers can consume them in later Phase 1 work.
        Ok(())
    }

    pub fn tick(&mut self, dt: f64) -> CognitionResult<BehaviorSignal> {
        if !dt.is_finite() || dt < 0.0 {
            return Err(CognitionError::InvalidDt);
        }
        Ok(self.signal)
    }

    pub fn snapshot(&self) -> PersistentCognitionState {
        PersistentCognitionState {
            schema_version: self.schema_version,
            character_id: self.character_id.clone(),
            cognition: json!(StaticPersonalityState {
                kind: "static-personality-v1".to_owned(),
                dimensions: self.dimensions,
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

        let restored: StaticPersonalityState = serde_json::from_value(state.cognition)
            .map_err(|_| CognitionError::InvalidCognitionState)?;
        if restored.kind != "static-personality-v1" || restored.dimensions != self.dimensions {
            return Err(CognitionError::InvalidCognitionState);
        }
        if !valid_dimensions(restored.dimensions) {
            return Err(CognitionError::InvalidCognitionState);
        }

        self.dimensions = restored.dimensions;
        self.signal = behavior_signal(self.dimensions);
        Ok(())
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

fn behavior_signal(dimensions: PersonalityDimensions) -> BehaviorSignal {
    let energy = dimensions.energy;
    let curiosity = dimensions.curiosity;
    let engagement = energy * 0.7 + curiosity * 0.3;

    BehaviorSignal {
        affect: NEUTRAL_AFFECT,
        behavior_bias: BehaviorBias {
            idle_dwell: 1.25 - 0.5 * engagement,
            walk_speed: 0.8 + 0.4 * energy,
            jump_chance: 0.6 + 0.8 * dimensions.boldness,
            bubble_chance: 0.7 + 0.6 * dimensions.sociability,
            animation_pace: 0.85 + 0.3 * energy,
        },
    }
}
