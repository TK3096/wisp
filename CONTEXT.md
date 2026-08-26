# Wisp

Wisp is a macOS overlay where pixel-art characters wander across the user's screen and react as if they are alive.

## Language

**Cognition State**:
The opaque, per-character internal state owned by the cognition core.
_Avoid_: character state, frontend state, render state

**Cognition Handle**:
The injected per-character seam through which the TypeScript behavior orchestrator sends stimuli, advances cognition, and receives behavior signals.
_Avoid_: brain, controller, WASM service

**Stimulus**:
A meaningful event delivered to cognition before a cognition tick; it carries no wall-clock time.
_Avoid_: input event, raw sensor frame, Tauri event

**Stimulus Envelope**:
A dispatcher-owned wrapper that pairs one stimulus with its recipient scope.
_Avoid_: stimulus payload, targeted event

**Ingress Bridge**:
The adapter that turns shell, sidecar, and future platform events into stimulus envelopes without exposing their transports to the simulation.
_Avoid_: event listener, Tauri hook

**Gesture Confidence**:
The bounded 0–1 certainty attached to a gesture stimulus after detection and debouncing.
_Avoid_: score, raw detection probability

**Materialized**:
The lifecycle phase in which a character has completed its spawn transition and exists in the simulation.
_Avoid_: spawned, loaded

**Vanishing**:
The lifecycle phase in which a character has begun its despawn transition and will soon leave the simulation.
_Avoid_: despawned, destroyed

**Behavior Signal**:
A bounded tendency emitted after a cognition tick for the behavior orchestrator to interpret; it is not a command.
_Avoid_: action, command, instruction

**Behavior Bias**:
A bounded multiplier that adjusts an existing behavior tendency without replacing the behavior state machine.
_Avoid_: behavior override, direct control

**Character Identity**:
The stable opaque identifier that distinguishes one individual character across cognition and future persistence.
_Avoid_: spawn id, render index

**Archetype**:
The named character variety that anchors static personality configuration.
_Avoid_: sprite, skin, class

**Personality Seed**:
The deterministic seed used to specialize an individual within its archetype.
_Avoid_: random number, nonce

**Persistent Cognition State**:
A versioned, serializable snapshot of one character's cognition state that TypeScript may store but cannot interpret.
_Avoid_: save data, render state, personality profile

**Social Projection**:
The bounded character-scoped cognition view that other characters may perceive and respond to during social influence.
_Avoid_: raw cognition state, personality profile, durable memory

**Social Influence**:
The bounded cross-character effect derived from social projections and incorporated into a character's cognition before behavior signals are emitted.
_Avoid_: behavior command, direct control, social override

**Population Cognition Pass**:
The fixed-cadence batch step through which materialized characters exchange bounded social influence without changing lifecycle or behavior ownership.
_Avoid_: crowd control, global mood, render tick

**Durable Memory**:
Curated, character-scoped knowledge that remains meaningful across sessions and can influence future cognition.
_Avoid_: save data, cognition snapshot, render state

**Sleep Consolidation**:
Deferred background work that prepares predictable future cognition from durable memory.
_Avoid_: character rest animation, idle behavior, offline-time replay

**Cognition Cadence**:
The fixed internal rate at which cognition advances independently of the render frame rate.
_Avoid_: frame rate, ticker rate
