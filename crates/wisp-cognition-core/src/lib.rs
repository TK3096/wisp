use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;

pub const COGNITION_SCHEMA_VERSION: u32 = 3;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedbackKind {
    Delight,
    Dismiss,
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
    Feedback {
        feedback: FeedbackKind,
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

/// The bounded Micro-belief projections exposed by each Cognition step.
///
/// These are slow interpretations, not short-lived affect values: the passive
/// leak time constant is measured in tens of seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroBeliefProjection {
    pub novelty: f64,
    pub familiarity: f64,
    pub social_positivity: f64,
    pub caution: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reaction {
    #[serde(rename = "none")]
    None,
    Curiosity,
    Startle,
    Excitement,
    Boredom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReactionKind {
    Curiosity,
    Startle,
    Excitement,
    Boredom,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactionCandidate {
    pub kind: ReactionKind,
    pub score: f64,
    pub threshold: f64,
    pub eligible: bool,
    pub requires_stimulus: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactionSignal {
    pub kind: Reaction,
    pub score: f64,
    pub remaining_s: f64,
    pub candidates: [ReactionCandidate; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorSignal {
    pub personality: PersonalityDimensions,
    pub affect: Affect,
    pub temporal_surprise: TemporalSurprise,
    pub micro_belief: MicroBeliefProjection,
    pub reaction: ReactionSignal,
    pub behavior_bias: BehaviorBias,
}

/// Minimal read-only projection used to select a tone before a cadence tick.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToneSignal {
    pub personality: PersonalityDimensions,
    pub affect: Affect,
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
    micro_belief: MicroBeliefState,
}

type ObservationVector = [f64; OBSERVATION_DIMENSIONS];
type BeliefChannels = [f64; MICRO_BELIEF_DIMENSIONS];
type ReactionTimes = [f64; REACTION_COUNT];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CognitionError {
    UnsupportedSchemaVersion,
    EmptyCharacterId,
    EmptyArchetype,
    InvalidCognitionState,
    InvalidStimulus,
    InvalidSocialInfluence,
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
            Self::InvalidSocialInfluence => "Social Influence must be finite",
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
/// Number of accepted LeakyIntegrator Micro-belief channels.
const MICRO_BELIEF_DIMENSIONS: usize = 4;
const CHANGE_CHANNEL: usize = 0;
const SOCIAL_CHANNEL: usize = 1;
const HABIT_CHANNEL: usize = 2;
const CAUTION_CHANNEL: usize = 3;
const REACTION_COUNT: usize = 4;
const REACTION_INDEX_STARTLE: usize = 0;
const REACTION_INDEX_EXCITEMENT: usize = 1;
const REACTION_INDEX_CURIOSITY: usize = 2;
const REACTION_INDEX_BOREDOM: usize = 3;
/// Canonical Temporal Derivative coefficients: fast ≈ 10× slow.
const ALPHA_FAST: f64 = 0.3;
const ALPHA_SLOW: f64 = 0.03;
/// Sigmoid inverse temperature applied to the derivative norm.
const SURPRISE_GATE_BETA: f64 = 4.0;
/// Accepted recentring scale for the Temporal Derivative gate.
const SURPRISE_ENERGY_SCALE: f64 = 2.6;
/// Short-lived affect decay time constants, in seconds.
const SURPRISE_DECAY_TAU_S: f64 = 0.65;
const AROUSAL_RISE_TAU_S: f64 = 0.35;
const AROUSAL_DECAY_TAU_S: f64 = 3.0;
const VALENCE_TAU_S: f64 = 4.5;
/// Accepted LeakyIntegrator Micro-belief coefficients.
const MICRO_BELIEF_LEARNING_RATE: f64 = 0.25;
const MICRO_BELIEF_MAX_DELTA: f64 = 0.2;
const MICRO_BELIEF_DECAY_TAU_S: f64 = 60.0;
/// Quiet-boredom accumulation and recovery.
const BOREDOM_BUILD_S: f64 = 12.0;
const BOREDOM_RECOVERY_S: f64 = 2.5;
const QUIET_SURPRISE_MAX: f64 = 0.1;
const QUIET_AROUSAL_MAX: f64 = 0.25;
const BOREDOM_RECOVERY_LEVEL: f64 = 0.2;
/// Reaction policy, in seconds.
const GLOBAL_REACTION_LOCK_S: f64 = 0.6;
const REACTION_DURATION_S: ReactionTimes = [0.8, 2.0, 3.0, 4.0];
const REACTION_COOLDOWN_S: ReactionTimes = [4.0, 5.0, 3.0, 12.0];
const REACTION_THRESHOLD: ReactionTimes = [0.58, 0.62, 0.35, 0.75];
const COGNITION_STATE_KIND: &str = "micro-belief-reactions-v3";
/// The accepted modelless cross-character Social Projection width.
const SOCIAL_PROJECTION_DIMENSIONS: usize = 8;
/// One shell action opens one bounded opportunity for a visible expression.
const FEEDBACK_CREDIT_WINDOW_S: f64 = 2.0;
const REWARD_EVENT_STEP: f64 = 0.04;
const REWARD_DIMENSION_CAP: f64 = 0.08;

pub struct CognitionCore {
    schema_version: u32,
    character_id: String,
    /// The archetype + seed identity for this session before bounded reward.
    base_dimensions: PersonalityDimensions,
    dimensions: PersonalityDimensions,
    temporal: TemporalState,
    micro_belief: MicroBeliefState,
    reward_drift: RewardDrift,
    reward_cue: Option<RewardCue>,
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

/// Slow LeakyIntegrator interpretation and exclusive reaction policy state.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MicroBeliefState {
    clock_s: f64,
    channels: BeliefChannels,
    pending_stimulus: Option<Stimulus>,
    stimulus_count: u32,
    boredom: f64,
    active: Option<ActiveReaction>,
    reaction_lock_s: f64,
    next_eligible_s: ReactionTimes,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveReaction {
    kind: ReactionKind,
    score: f64,
    remaining_s: f64,
}

/// Session-scoped explicit user reward. It never originates from a passive
/// gesture, environment change, or survival tick.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RewardDrift {
    energy: f64,
    sociability: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RewardCue {
    kind: FeedbackKind,
    /// Absolute Cognition clock after which an unclaimed cue expires.
    expires_at_s: f64,
}

struct AffectTarget {
    valence: f64,
    arousal: f64,
}

impl Default for MicroBeliefState {
    fn default() -> Self {
        Self {
            clock_s: 0.0,
            channels: [0.0; MICRO_BELIEF_DIMENSIONS],
            pending_stimulus: None,
            stimulus_count: 0,
            boredom: 0.0,
            active: None,
            reaction_lock_s: 0.0,
            next_eligible_s: [0.0; REACTION_COUNT],
        }
    }
}

impl Default for RewardDrift {
    fn default() -> Self {
        Self {
            energy: 0.0,
            sociability: 0.0,
        }
    }
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
        let micro_belief = MicroBeliefState::default();
        let reward_drift = RewardDrift::default();
        let signal = Self::compose_signal(dimensions, &temporal, &micro_belief);
        Ok(Self {
            schema_version: init.schema_version,
            character_id: init.character_id,
            base_dimensions: dimensions,
            dimensions,
            temporal,
            micro_belief,
            reward_drift,
            reward_cue: None,
            signal,
        })
    }

    pub fn dimensions(&self) -> PersonalityDimensions {
        self.dimensions
    }

    /// Latest tone projection without advancing the fixed-time dynamics.
    pub fn tone_signal(&self) -> ToneSignal {
        ToneSignal {
            personality: self.signal.personality,
            affect: self.signal.affect,
        }
    }

    /// The bounded peer-visible projection used by Population Cognition.
    pub fn social_projection(&self) -> [f64; SOCIAL_PROJECTION_DIMENSIONS] {
        [
            self.signal.personality.energy,
            self.signal.personality.curiosity,
            self.signal.personality.boldness,
            self.signal.personality.sociability,
            self.signal.affect.surprise,
            self.signal.affect.valence,
            self.signal.affect.arousal,
            self.signal.micro_belief.social_positivity,
        ]
    }

    /// Apply one bounded population contribution to the slow Social channel.
    ///
    /// This is the only Set Attention mutation permitted across the Cognition
    /// boundary. It composes a new Behavior Signal immediately but never adds
    /// a Stimulus, bypasses reaction locks, or commands behavior.
    pub fn apply_social_influence(&mut self, influence: f64) -> CognitionResult<()> {
        if !influence.is_finite() {
            return Err(CognitionError::InvalidSocialInfluence);
        }
        let channel = &mut self.micro_belief.channels[SOCIAL_CHANNEL];
        *channel = (*channel + influence.clamp(-1.0, 1.0)).clamp(-1.0, 1.0);
        self.signal = Self::compose_signal(self.dimensions, &self.temporal, &self.micro_belief);
        Ok(())
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
            Stimulus::Feedback { feedback } => {
                // Feedback is not an observation feature and does not consume
                // the pending belief stimulus. It only opens a bounded reward
                // opportunity; personality changes only if a visible expression
                // claims that opportunity before it expires.
                self.reward_cue = Some(RewardCue {
                    kind: feedback,
                    expires_at_s: self.micro_belief.clock_s + FEEDBACK_CREDIT_WINDOW_S,
                });
                return Ok(());
            }
        }
        // Last observed semantic Stimulus wins within a Cognition step. Dense
        // dispatch can update this pending evidence, but cannot call tick or
        // bypass cooldowns and reaction exclusivity.
        self.micro_belief.pending_stimulus = Some(stimulus);
        Ok(())
    }

    pub fn tick(&mut self, dt: f64) -> CognitionResult<BehaviorSignal> {
        if !dt.is_finite() || dt < 0.0 {
            return Err(CognitionError::InvalidDt);
        }
        self.micro_belief.clock_s += dt;
        self.micro_belief.reaction_lock_s = (self.micro_belief.reaction_lock_s - dt).max(0.0);
        if self
            .reward_cue
            .is_some_and(|cue| self.micro_belief.clock_s > cue.expires_at_s)
        {
            self.reward_cue = None;
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
        let pending_stimulus = self.micro_belief.pending_stimulus.take();
        let had_stimulus = pending_stimulus.is_some();
        if let Some(stimulus) = pending_stimulus {
            let input = stimulus_feature(stimulus, self.micro_belief.stimulus_count);
            if leaky_step(&mut self.micro_belief.channels, &input) {
                self.micro_belief.stimulus_count = self
                    .micro_belief
                    .stimulus_count
                    .checked_add(1)
                    .ok_or(CognitionError::InvalidStimulus)?;
            }
        }
        let belief_decay = (-dt / MICRO_BELIEF_DECAY_TAU_S).exp();
        for channel in self.micro_belief.channels.iter_mut() {
            *channel = (*channel * belief_decay).clamp(-1.0, 1.0);
        }
        let belief = project_belief(&self.micro_belief.channels);

        // Short-lived affect integrates only novelty *rises*, then leaks away
        // on the accepted timescale. A sustained or repeated observation level
        // therefore habituates instead of pinning surprise at its peak.
        let novelty_rise = (temporal_surprise.centered_energy - previous_energy).max(0.0);
        let surprise_decay = (-dt / SURPRISE_DECAY_TAU_S).exp();
        self.temporal.affect.surprise =
            (self.temporal.affect.surprise * surprise_decay + novelty_rise).clamp(0.0, 1.0);
        let affect_target = affect_target(&belief, temporal_surprise.centered_energy);
        let valence_toward = 1.0 - (-dt / VALENCE_TAU_S).exp();
        self.temporal.affect.valence = (self.temporal.affect.valence
            + (affect_target.valence - self.temporal.affect.valence) * valence_toward)
            .clamp(-1.0, 1.0);
        if affect_target.arousal > self.temporal.affect.arousal {
            let arousal_toward = 1.0 - (-dt / AROUSAL_RISE_TAU_S).exp();
            self.temporal.affect.arousal = (self.temporal.affect.arousal
                + (affect_target.arousal - self.temporal.affect.arousal) * arousal_toward)
                .clamp(0.0, 1.0);
        } else {
            self.temporal.affect.arousal =
                (self.temporal.affect.arousal * (-dt / AROUSAL_DECAY_TAU_S).exp()).clamp(0.0, 1.0);
        }

        let quiet = !had_stimulus
            && temporal_surprise.centered_energy < QUIET_SURPRISE_MAX
            && self.temporal.affect.arousal < QUIET_AROUSAL_MAX;
        self.micro_belief.boredom = if quiet {
            (self.micro_belief.boredom + dt / BOREDOM_BUILD_S).clamp(0.0, 1.0)
        } else {
            (self.micro_belief.boredom - dt / BOREDOM_RECOVERY_S).clamp(0.0, 1.0)
        };

        advance_reaction(
            &mut self.micro_belief,
            dt,
            self.dimensions,
            self.temporal.affect,
            had_stimulus,
        );

        self.signal = behavior_signal(
            self.dimensions,
            self.temporal.affect,
            temporal_surprise,
            &self.micro_belief,
        );
        Ok(self.signal)
    }

    pub fn snapshot(&self) -> PersistentCognitionState {
        PersistentCognitionState {
            schema_version: self.schema_version,
            character_id: self.character_id.clone(),
            cognition: json!(TemporalPersonalityState {
                kind: COGNITION_STATE_KIND.to_owned(),
                // Session reward never crosses the persistence boundary.
                dimensions: self.base_dimensions,
                observation: self.temporal.observation,
                fast: self.temporal.fast,
                slow: self.temporal.slow,
                affect: self.temporal.affect,
                micro_belief: self.micro_belief,
            }),
        }
    }

    /// Called by the behavior orchestrator only when `Character.say` actually
    /// started a bubble. Unexpired explicit feedback is claimed once.
    pub fn note_expression(&mut self) {
        let Some(cue) = self.reward_cue else {
            return;
        };
        if self.micro_belief.clock_s > cue.expires_at_s {
            self.reward_cue = None;
            return;
        }

        let (energy_delta, sociability_delta) = match cue.kind {
            FeedbackKind::Delight => (REWARD_EVENT_STEP, REWARD_EVENT_STEP),
            FeedbackKind::Dismiss => (-REWARD_EVENT_STEP, -REWARD_EVENT_STEP),
        };
        self.reward_drift.energy = (self.reward_drift.energy + energy_delta)
            .clamp(-REWARD_DIMENSION_CAP, REWARD_DIMENSION_CAP);
        self.reward_drift.sociability = (self.reward_drift.sociability + sociability_delta)
            .clamp(-REWARD_DIMENSION_CAP, REWARD_DIMENSION_CAP);
        self.dimensions = reward_dimensions(self.base_dimensions, self.reward_drift);
        self.reward_cue = None;
        self.signal = Self::compose_signal(self.dimensions, &self.temporal, &self.micro_belief);
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
        if restored.kind != COGNITION_STATE_KIND {
            return Err(CognitionError::InvalidCognitionState);
        }
        if !valid_dimensions(restored.dimensions) {
            return Err(CognitionError::InvalidCognitionState);
        }
        if !valid_observation_vector(restored.observation)
            || !valid_observation_vector(restored.fast)
            || !valid_observation_vector(restored.slow)
            || !valid_affect(restored.affect)
            || !valid_micro_belief_state(restored.micro_belief)
            || restored.dimensions != self.base_dimensions
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
        self.micro_belief = restored.micro_belief;
        self.signal = Self::compose_signal(self.dimensions, &self.temporal, &self.micro_belief);
        Ok(())
    }

    fn compose_signal(
        dimensions: PersonalityDimensions,
        temporal: &TemporalState,
        micro_belief: &MicroBeliefState,
    ) -> BehaviorSignal {
        behavior_signal(
            dimensions,
            temporal.affect,
            temporal_surprise(&temporal.fast, &temporal.slow),
            micro_belief,
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

fn valid_stimulus(stimulus: Stimulus) -> bool {
    match stimulus {
        Stimulus::Gesture { confidence, .. } => {
            confidence.is_finite() && (0.0..=1.0).contains(&confidence)
        }
        Stimulus::Lifecycle { .. } | Stimulus::Environment { .. } | Stimulus::Feedback { .. } => {
            true
        }
    }
}

fn valid_micro_belief_state(state: MicroBeliefState) -> bool {
    if !state.clock_s.is_finite() || state.clock_s < 0.0 {
        return false;
    }
    if state
        .channels
        .iter()
        .any(|value| !value.is_finite() || !(-1.0..=1.0).contains(value))
    {
        return false;
    }
    if let Some(stimulus) = state.pending_stimulus {
        if !valid_stimulus(stimulus) {
            return false;
        }
    }
    if !state.boredom.is_finite() || !(0.0..=1.0).contains(&state.boredom) {
        return false;
    }
    if let Some(active) = state.active {
        if !active.score.is_finite()
            || !(0.0..=1.0).contains(&active.score)
            || !active.remaining_s.is_finite()
            || active.remaining_s <= 0.0
        {
            return false;
        }
    }
    if !state.reaction_lock_s.is_finite()
        || state.reaction_lock_s < 0.0
        || state
            .next_eligible_s
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
    {
        return false;
    }
    true
}

fn reward_dimensions(base: PersonalityDimensions, drift: RewardDrift) -> PersonalityDimensions {
    PersonalityDimensions {
        energy: clamp_dimension(base.energy + drift.energy),
        curiosity: base.curiosity,
        boldness: base.boldness,
        sociability: clamp_dimension(base.sociability + drift.sociability),
    }
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
        centered_energy: (SURPRISE_ENERGY_SCALE * (gate - 0.5)).clamp(0.0, 1.0),
    }
}

fn behavior_signal(
    dimensions: PersonalityDimensions,
    affect: Affect,
    temporal_surprise: TemporalSurprise,
    micro_belief: &MicroBeliefState,
) -> BehaviorSignal {
    let energy = dimensions.energy;
    let curiosity = dimensions.curiosity;
    let engagement = energy * 0.7 + curiosity * 0.3;
    let personality_bias = BehaviorBias {
        idle_dwell: 1.25 - 0.5 * engagement,
        walk_speed: 0.8 + 0.4 * energy,
        jump_chance: 0.6 + 0.8 * dimensions.boldness,
        bubble_chance: 0.7 + 0.6 * dimensions.sociability,
        animation_pace: 0.85 + 0.3 * energy,
    };
    let multiplier = active_reaction_bias(micro_belief.active.map(|active| active.kind));

    BehaviorSignal {
        personality: dimensions,
        affect,
        temporal_surprise,
        micro_belief: project_belief(&micro_belief.channels),
        reaction: reaction_signal(micro_belief, dimensions, affect),
        behavior_bias: combine_bias(personality_bias, multiplier),
    }
}

/// Cognition emits only bounded behavior tendencies. It never selects or
/// commands an action; the behavior orchestrator still owns every roll and
/// lifecycle decision.
fn combine_bias(base: BehaviorBias, multiplier: BehaviorBias) -> BehaviorBias {
    BehaviorBias {
        idle_dwell: (base.idle_dwell * multiplier.idle_dwell).clamp(0.5, 1.5),
        walk_speed: (base.walk_speed * multiplier.walk_speed).clamp(0.5, 1.75),
        jump_chance: (base.jump_chance * multiplier.jump_chance).clamp(0.2, 1.8),
        bubble_chance: (base.bubble_chance * multiplier.bubble_chance).clamp(0.2, 1.8),
        animation_pace: (base.animation_pace * multiplier.animation_pace).clamp(0.75, 1.25),
    }
}

fn active_reaction_bias(kind: Option<ReactionKind>) -> BehaviorBias {
    match kind {
        Some(ReactionKind::Curiosity) => BehaviorBias {
            idle_dwell: 0.65,
            walk_speed: 1.15,
            jump_chance: 1.25,
            bubble_chance: 1.40,
            animation_pace: 1.08,
        },
        Some(ReactionKind::Startle) => BehaviorBias {
            idle_dwell: 1.15,
            walk_speed: 0.85,
            jump_chance: 2.20,
            bubble_chance: 1.30,
            animation_pace: 1.18,
        },
        Some(ReactionKind::Excitement) => BehaviorBias {
            idle_dwell: 0.50,
            walk_speed: 1.25,
            jump_chance: 1.80,
            bubble_chance: 1.50,
            animation_pace: 1.20,
        },
        Some(ReactionKind::Boredom) => BehaviorBias {
            idle_dwell: 0.75,
            walk_speed: 0.90,
            jump_chance: 0.55,
            bubble_chance: 1.20,
            animation_pace: 0.88,
        },
        None => BehaviorBias {
            idle_dwell: 1.0,
            walk_speed: 1.0,
            jump_chance: 1.0,
            bubble_chance: 1.0,
            animation_pace: 1.0,
        },
    }
}

fn selected_reaction(kind: ReactionKind) -> Reaction {
    match kind {
        ReactionKind::Startle => Reaction::Startle,
        ReactionKind::Excitement => Reaction::Excitement,
        ReactionKind::Curiosity => Reaction::Curiosity,
        ReactionKind::Boredom => Reaction::Boredom,
    }
}

fn reaction_index(kind: ReactionKind) -> Option<usize> {
    match kind {
        ReactionKind::Startle => Some(REACTION_INDEX_STARTLE),
        ReactionKind::Excitement => Some(REACTION_INDEX_EXCITEMENT),
        ReactionKind::Curiosity => Some(REACTION_INDEX_CURIOSITY),
        ReactionKind::Boredom => Some(REACTION_INDEX_BOREDOM),
    }
}

fn reaction_kind(index: usize) -> ReactionKind {
    match index {
        REACTION_INDEX_STARTLE => ReactionKind::Startle,
        REACTION_INDEX_EXCITEMENT => ReactionKind::Excitement,
        REACTION_INDEX_CURIOSITY => ReactionKind::Curiosity,
        _ => ReactionKind::Boredom,
    }
}

fn reaction_score(
    index: usize,
    dimensions: PersonalityDimensions,
    affect: Affect,
    belief: MicroBeliefProjection,
    boredom: f64,
) -> f64 {
    match index {
        REACTION_INDEX_STARTLE => {
            (0.8 * affect.surprise + 0.5 * belief.caution + 0.1 * (1.0 - dimensions.boldness)
                - 0.28 * belief.familiarity)
                .clamp(0.0, 1.0)
        }
        REACTION_INDEX_EXCITEMENT => (0.55 * belief.social_positivity
            + 0.25 * belief.familiarity
            + 0.35 * affect.surprise
            + 0.15 * dimensions.energy
            + 0.2 * affect.valence.max(0.0))
        .clamp(0.0, 1.0),
        REACTION_INDEX_CURIOSITY => {
            (0.45 * affect.surprise + 0.5 * belief.novelty + 0.15 * dimensions.curiosity
                - 0.2 * belief.familiarity)
                .clamp(0.0, 1.0)
        }
        _ => (boredom * 0.8 + 0.1 * belief.familiarity + 0.1 * (1.0 - affect.arousal)
            - 0.35 * affect.surprise)
            .clamp(0.0, 1.0),
    }
}

fn reaction_candidates(
    micro_belief: &MicroBeliefState,
    dimensions: PersonalityDimensions,
    affect: Affect,
) -> [ReactionCandidate; REACTION_COUNT] {
    let belief = project_belief(&micro_belief.channels);
    let mut candidates = [ReactionCandidate {
        kind: ReactionKind::Startle,
        score: 0.0,
        threshold: 0.0,
        eligible: false,
        requires_stimulus: true,
    }; REACTION_COUNT];

    for index in 0..REACTION_COUNT {
        let kind = reaction_kind(index);
        let score = reaction_score(index, dimensions, affect, belief, micro_belief.boredom);
        candidates[index] = ReactionCandidate {
            kind,
            score,
            threshold: REACTION_THRESHOLD[index],
            eligible: micro_belief.clock_s >= micro_belief.next_eligible_s[index]
                && score >= REACTION_THRESHOLD[index],
            requires_stimulus: kind != ReactionKind::Boredom,
        };
    }
    candidates
}

fn reaction_signal(
    micro_belief: &MicroBeliefState,
    dimensions: PersonalityDimensions,
    affect: Affect,
) -> ReactionSignal {
    let candidates = reaction_candidates(micro_belief, dimensions, affect);
    ReactionSignal {
        kind: micro_belief
            .active
            .map(|active| selected_reaction(active.kind))
            .unwrap_or(Reaction::None),
        score: micro_belief
            .active
            .map(|active| active.score)
            .unwrap_or(0.0),
        remaining_s: micro_belief
            .active
            .map(|active| active.remaining_s)
            .unwrap_or(0.0),
        candidates,
    }
}

fn advance_reaction(
    state: &mut MicroBeliefState,
    dt: f64,
    dimensions: PersonalityDimensions,
    affect: Affect,
    had_stimulus: bool,
) {
    if let Some(active) = state.active.as_mut() {
        active.remaining_s -= dt;
        if active.remaining_s <= 0.0 {
            state.active = None;
            state.reaction_lock_s = GLOBAL_REACTION_LOCK_S;
        }
        return;
    }

    if state.reaction_lock_s > 0.0 {
        return;
    }

    let candidates = reaction_candidates(state, dimensions, affect);
    let winner = [
        REACTION_INDEX_STARTLE,
        REACTION_INDEX_EXCITEMENT,
        REACTION_INDEX_CURIOSITY,
        REACTION_INDEX_BOREDOM,
    ]
    .into_iter()
    .map(|index| candidates[index])
    .find(|candidate| candidate.eligible && (candidate.requires_stimulus == had_stimulus));

    if let Some(winner) = winner {
        let index = reaction_index(winner.kind).expect("eligible candidate has a reaction index");
        state.next_eligible_s[index] =
            state.clock_s + REACTION_DURATION_S[index] + REACTION_COOLDOWN_S[index];
        state.active = Some(ActiveReaction {
            kind: winner.kind,
            score: winner.score,
            remaining_s: REACTION_DURATION_S[index],
        });
        if winner.kind == ReactionKind::Boredom {
            state.boredom = BOREDOM_RECOVERY_LEVEL;
        }
    }
}

fn stimulus_feature(stimulus: Stimulus, previous_count: u32) -> [f64; MICRO_BELIEF_DIMENSIONS] {
    match stimulus {
        Stimulus::Gesture { confidence, .. } => {
            if confidence >= 0.65 {
                let habit = (previous_count as f64 / 3.0).clamp(0.0, 1.0);
                let novelty = 0.8 * (1.0 - habit).powi(2);
                [
                    novelty,
                    0.22 + 0.58 * habit,
                    0.04 * habit,
                    0.06 * (1.0 - habit),
                ]
            } else {
                [0.68, 0.28, 0.08, 0.28]
            }
        }
        Stimulus::Lifecycle { phase: _ } => [0.0; MICRO_BELIEF_DIMENSIONS],
        Stimulus::Environment { change } => match change {
            EnvironmentChange::AppFocus => [0.16, 0.08, 0.7, 0.0],
            EnvironmentChange::AppBlur => [0.45, 0.0, 0.1, 0.85],
        },
        // Feedback never becomes a passive-belief feature; it is only a reward
        // credit cue. This arm preserves exhaustiveness without mutating state.
        Stimulus::Feedback { .. } => [0.0; MICRO_BELIEF_DIMENSIONS],
    }
}

fn leaky_step(channels: &mut BeliefChannels, input: &[f64; MICRO_BELIEF_DIMENSIONS]) -> bool {
    let total: f64 = input.iter().sum();
    if total < 1e-8 {
        return false;
    }

    let scale = (MICRO_BELIEF_LEARNING_RATE * total.min(1.0)) / total;
    let half_total = 0.5 * total;
    for channel in 0..MICRO_BELIEF_DIMENSIONS {
        let delta = (scale * (input[channel] - half_total))
            .clamp(-MICRO_BELIEF_MAX_DELTA, MICRO_BELIEF_MAX_DELTA);
        channels[channel] = (channels[channel] + delta).clamp(-1.0, 1.0);
    }
    true
}

fn project_belief(channels: &BeliefChannels) -> MicroBeliefProjection {
    MicroBeliefProjection {
        novelty: channels[CHANGE_CHANNEL].clamp(0.0, 1.0),
        familiarity: (channels[HABIT_CHANNEL] + 0.7 * channels[SOCIAL_CHANNEL]
            - 0.35 * channels[CHANGE_CHANNEL])
            .clamp(0.0, 1.0),
        social_positivity: channels[SOCIAL_CHANNEL].clamp(0.0, 1.0),
        caution: channels[CAUTION_CHANNEL].clamp(0.0, 1.0),
    }
}

fn affect_target(belief: &MicroBeliefProjection, surprise: f64) -> AffectTarget {
    AffectTarget {
        valence: (0.55 * belief.social_positivity + 0.25 * belief.familiarity
            - 0.7 * belief.caution
            - 0.08 * belief.novelty)
            .clamp(-1.0, 1.0),
        arousal: surprise
            .max(0.65 * belief.social_positivity)
            .max(0.75 * belief.caution)
            .max(0.25 * belief.novelty)
            .clamp(0.0, 1.0),
    }
}
