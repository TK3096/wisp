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

**Tone Tag**:
The single accepted expression tone that weights which greeting or idle line a character may speak.
_Avoid_: mood, vibe, style flag

**Feedback Cue**:
The bounded, character-scoped cognition opportunity opened by an explicit shell delight or dismiss action and claimed by at most one visible expression.
_Avoid_: reward event, personality command, shell reward

**Session Reward Drift**:
The bounded, in-session adjustment to personality dimensions produced only by an accepted expression; it never persists with Cognition State.
_Avoid_: durable personality, learning, passive reward

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

**Cognition Debug Snapshot**:
A bounded, read-only projection of one Materialized character's latest observable cognition surface for development inspection.
_Avoid_: raw Cognition State, trace record, telemetry payload

**Cognition Debug Overlay**:
A development-only presentation of selected Cognition Debug Snapshots; it never owns behavior, cognition, lifecycle, or persistence.
_Avoid_: acceptance authority, release setting, debug brain

**Speech Debug Snapshot**:
A bounded, read-only projection of one character's latest generated-speech outcome, Expression Direction, attempt accounting, and generation cost for development inspection.
_Avoid_: raw Cognition State, full candidate pool, banned-word detail, production telemetry

**Scenario Harness**:
The deterministic headless replay that advances Wisp behavior on a virtual clock and records observable cognition/behavior traces without a renderer or shell.
_Avoid_: integration test, browser harness, playback recorder

**Speech Handle**:
The injected per-character seam through which the behavior orchestrator requests one bounded short expression.
_Avoid_: mouth, bubble owner, renderer hook, model service

**Speech Request**:
The bounded expression-time projection containing occasion, personality, affect, reaction, recent-expression context, and deterministic seed.
_Avoid_: prompt, cognition state, conversation transcript

**Speech Voice Identity**:
The reproducible speaker identity derived from an immutable Archetype, Personality Seed, and Voice Profile Version rather than stored as a mutable profile.
_Avoid_: audio voice, account identity, unique persona guarantee

**Speech Voice Profile**:
The immutable, bounded speaker projection that shapes phrase patterns, syntax, lexicon, cadence, and verbal tics; expression-time state may bias its use but never mutate it.
_Avoid_: personality state, durable speech memory, generator-local identity

**Voice Profile Version**:
The compatibility boundary for a Speech Voice Profile generation contract; a meaningful generator change requires a new version.
_Avoid_: app version, forever-stable output promise, personality generation

**Speech Expression**:
The immutable final utterance value carrying display text, accepted Tone Tag, and whether it was generated or substituted.
_Avoid_: stream, generator result object, raw model output

**Expression Occasion**:
The bounded behavior-owned reason for requesting one final expression, such as a greeting or idle line.
_Avoid_: scheduler randomness, speech command, conversation plan

**Expression Ordinal**:
The per-character monotonic ordering of final expressions across generated and substituted outcomes.
_Avoid_: render tick, cognition step, global expression counter

**Expression Seed**:
The opaque deterministic lineage identifier for one Speech Expression.
_Avoid_: raw RNG state, generation input dump, output compatibility version

**Expression Trace Record**:
The canonical Scenario Harness projection of one final Speech Expression, its accepted direction, voice lineage, source status, and ordering.
_Avoid_: generator internals, validation diagnostics, bubble lifetime

**Expression Direction**:
The bounded speech-conditioning projection derived from observable cognition state; it proposes Style, Intent, and Intensity but never owns speech scheduling or behavior.
_Avoid_: speech command, generation prompt, behavior override

**Utterance Intent**:
The bounded expression purpose carried by Expression Direction; an active Reaction may override the occasion baseline, but it never commands behavior.
_Avoid_: action, behavior goal, conversation plan

**Expression Intensity**:
The bounded quiet/neutral/charged strength of an utterance derived from combined cognition projections.
_Avoid_: emotion level, volume, personality strength

**Stance Modifier**:
The bounded lexical posture selected from at most one dominant Micro-belief signal.
_Avoid_: belief statement, topic, opinion command

**Neutral Speech Handle**:
The default Speech Handle that supplies no generated expression, leaving the behavior orchestrator to use its ordinary fallback.
_Avoid_: disabled speech, empty speaker, silent mode

**Fixed-Line Fallback**:
The behavior orchestrator's deterministic use of an authored expression when no generated expression is accepted.
_Avoid_: error message, retry, generated filler
