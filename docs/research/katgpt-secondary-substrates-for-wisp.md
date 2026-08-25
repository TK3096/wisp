# Secondary katgpt-rs substrates for Wisp

- **Issue:** [#35 — Audit secondary katgpt-rs substrates for Wisp fit](https://github.com/TK3096/wisp/issues/35)
- **Date:** 2026-08-25
- **Source tree audited:** local ignored `katgpt-rs/` checkout in this repository (`.gitignore:33`)
- **Wisp commit:** `4c9b7574e8d8e7cdd434ee09706337a5d01d7394`
- **Mode:** research/planning only; no Wisp implementation or full workspace test suite was run

## Executive hypothesis

| Substrate | Current decision | One-line rationale | Revisit trigger |
|---|---:|---|---|
| **Set Attention** (`katgpt-core`) | **Defer — strongest secondary candidate** | It is a clean, modelless cross-character influence kernel, but Wisp first needs durable per-character latent state and a mapping from that state to observable behavior. | After the priority Temporal Derivative / Micro-belief / Personality layer gives each character a stable vector and identity. |
| **Sleep** (`katgpt-sleep`) | **Defer** | It is an offline query-answer cache and amortization model, not merely “characters sleep”; Wisp has neither persistent memory nor repeated expensive queries to cache. | After restart-surviving character memory and a genuinely expensive query/consolidation workload exist. |
| **Sense** (`katgpt-sense`) | **Reject for current roadmap** | Wisp already has a Python vision sidecar, while Sense requires a knowledge-graph embedding corpus, 8-D latent beliefs, and a Rust-side brain model that Wisp does not have. | Only if Wisp adopts persistent screen/user understanding beyond binary gesture-spawn events. |
| **Viable Manifold Graph** (`katgpt-core`) | **Defer at low priority** | It is a well-tested safe latent-navigation primitive, but Wisp has no latent manifold to sample or viability predicate to enforce. | After personality/affect state needs constrained exploration rather than independent random drift. |
| **Trigger Gate** (`katgpt-core`) | **Reject for current roadmap** | It routes transformer inference across CPU/GPU/ANE under server-scale QPS; Wisp has a lightweight TypeScript ticker and an on/off Python process, not an inference backend fleet. | Only if a heavy Rust cognition service with a real queue and multiple execution backends is introduced. |

**Adopt-now count: zero.** The priority roadmap should first make characters individually distinctive and stateful. Set Attention is the only secondary substrate whose eventual behavioral payoff is directly aligned with “characters feel alive together”; Sleep and Viable Manifold Graph become useful only on top of that state. Sense and Trigger Gate solve different architectural problems from Wisp's current one.

## Wisp baseline and integration seams

Wisp's documented architecture keeps the simulation as pure TypeScript with rendering injected through `CharacterHandle`, `BubbleHandle`, and related seams; Pixi factories are wired only from `src/main.ts` (`README.md:49-60`). The actual `Character` state is positional and animation-oriented—`x`, `y`, `facing`, `idle`/`walk`, frame timers, a dwell timer, a walk target, one bubble, and jump timers—but contains no personality, mood, belief, or persistent identity (`src/character.ts:63-84`). Each tick advances one branch of the idle/walk state machine, the jump arc, and the bubble; walk destinations and dwell times are random (`src/character.ts:139-146`, `src/character.ts:177-220`, `src/character.ts:222-229`).

The registry owns mutable live entries, transient effects, pending deferred spawns, elapsed time, global bubble timing, and an ID counter (`src/characterRegistry.ts:171-199`). It chooses a random asset and x position on spawn (`src/characterRegistry.ts:233-251`), fires a random greeting (`src/characterRegistry.ts:281-299`), and ticks every character with independent random idle-line and jump rolls under a global three-second bubble cooldown (`src/characterRegistry.ts:332-385`). There is no cross-character social state in this loop.

Current tuning is global: four indistinguishable asset manifests share the same jump, bubble, greeting, and idle-line pools (`src/config.ts:25-70`, `src/config.ts:81-130`). The Rust side does not perform cognition: `SidecarProcess` starts Python with unbuffered stdout and translates only NDJSON `spawn`, `error`, and `ready` events into a Tauri event or logging (`src-tauri/src/sidecar.rs:25-103`). The frontend ticker, rather than Rust, drives `registry.tick` (`src/main.ts:76-88`).

Consequently, a future substrate must answer three questions before import:

1. Where does per-character latent state live and how does it survive spawn/despawn/restart?
2. Is the computation in the TypeScript simulation tick, the Tauri/Rust shell, or a separate worker/process?
3. Which existing observable seam changes—walk target, idle/walk timing, jump probability, bubble content, or a new effect—when latent state changes?

Set Attention's dense identity-projection update is a natural candidate for a small pure-TypeScript port. Viable Manifold Graph's walk/navigation phase could also be represented in TypeScript, but its Jacobian/SVD graph construction is more naturally an offline Rust concern. Neither should cross the boundary until Wisp has the required state. Sense and Trigger Gate would pull substantial new architecture in for needs Wisp does not currently have.

## 1. Set Attention (`katgpt-core`)

### Purpose and API

Set Attention is the inference-time half of Non-Parametric Transformers: given `N` entity vectors and frozen query/key/value projections, it produces a residual, permutation-equivariant, sigmoid-gated cross-entity refinement (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:1-20`). It deliberately avoids softmax so an entity can attend to zero, one, or many peers (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:23-35`). The substrate has no opinion about vector semantics; caller code owns meaning and synchronization (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:44-49`).

`SetAttentionConfig` exposes sigmoid temperature `beta`, residual step `gamma`, and optional dense/sparse `top_k` (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:60-80`). The main API, `set_sigmoid_attention_into`, accepts flat row-major states, projections, an output buffer, dimensions, and three caller-owned scratch slices; it validates all lengths and is designed for zero steady-state allocation (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:183-253`, `katgpt-rs/crates/katgpt-core/src/set_attention.rs:268-325`). The update is normalized by peer count so the same `gamma` has stable meaning at different population sizes (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:196-212`).

The CLR-weighted sibling accepts a per-entity reliability vector and changes the denominator to total reliability (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:735-757`); uniform reliability is the plain operator (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:748-750`). Its reliability helper computes a CLR-style score from supplied direction probes (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:673-699`).

### Required state and assumptions

- A stable population snapshot of `N × D` latent vectors, not sprite identities alone.
- Frozen or deliberately chosen `W_Q`/`W_K` projections; identity projections provide the documented modelless floor (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:1183-1213`).
- A bounded behavior mapping from updated vectors back to Wisp observables. Without this, the kernel merely moves numbers.
- A concurrency policy: the substrate operates on borrowed buffers and leaves the caller responsible for gathering and scattering per-character state (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:37-49`).
- If using CLR weighting, an independently meaningful reliability signal; the primitive is not CLR-specific (`katgpt-rs/.plans/570_clr_weighted_set_attention.md:117-127`).

### Dependencies and cost

The core feature is dependency-free and default-on in `katgpt-core`; the CLR feature only implies Set Attention (`katgpt-rs/crates/katgpt-core/Cargo.toml:336-337`). The dense path costs `O(N²·k + N·D²)` and measured latency rises from 1.75 µs at 16 entities to 333.54 µs at 256 (`katgpt-rs/.benchmarks/354_set_attention_goat.md:39-50`). Exact top-k still scores every pair and failed the 1,000-entity target; LSH remains deferred (`katgpt-rs/.benchmarks/354_set_attention_goat.md:22-37`). Scratch ownership is roughly `2·N·K + N` floats plus an `N·D` output (`katgpt-rs/crates/katgpt-core/src/set_attention.rs:191-243`).

Wisp currently has four manifest characters (`src/config.ts:81-130`), so quadratic cost is not the near-term obstacle. The obstacle is that Wisp has no latent vectors or social semantics to refine.

### Tests and repo-reported evidence

**Local tests inspected, not run:** `set_attention_g1_g5.rs` defines permutation equivariance, identity-floor meaningfulness, latency/zero-allocation evidence hooks, and lonely-query behavior (`katgpt-rs/crates/katgpt-core/tests/set_attention_g1_g5.rs:1-18`). Its G4 test explicitly notes that actual allocation counting is in the benchmark and that the sparse path uses an internal index vector (`katgpt-rs/crates/katgpt-core/tests/set_attention_g1_g5.rs:255-310`). A separate G8 test ports a deterministic 64-entity crowd fixture for CLR identification and amplification (`katgpt-rs/crates/katgpt-core/tests/set_attention_clr_weighted_g8.rs:1-33`).

**Repo-reported, not independently reproduced:** the benchmark reports G1–G5 pass, 21.96 µs at `N=64,D=8,K=4`, zero dense allocations, and later production evidence of 75.7 µs/tick at 100 NPCs (`katgpt-rs/.benchmarks/354_set_attention_goat.md:10-20`, `katgpt-rs/.benchmarks/354_set_attention_goat.md:67-75`). It reports CLR weighting closing the collective-inference gate with +8.7 percentage points identification accuracy and 3.88× aggregate amplification (`katgpt-rs/.benchmarks/354_set_attention_goat.md:67-75`).

### Wisp fit

This is the strongest secondary candidate because Wisp's desired experience is intrinsically multi-character and Set Attention is exactly a population-level influence operator. However, current Wisp behavior is independent per-character randomness; the registry does not compare characters or share state (`src/characterRegistry.ts:357-385`). Applying it now would create a hidden homogenization force with no user-visible personality contract.

A minimum future design should use the identity projection first and defer CLR until a meaningful per-character confidence/reliability signal exists. That keeps the integration modelless and testable.

### Minimum viable future integration

1. Wait for or build the priority individual-state layer: one bounded 8-D vector per live character, initialized from personality and updated by Temporal Derivative/Micro-belief.
2. In `CharacterRegistry.tick`, gather a dense state snapshot, run a TypeScript port of the identity-projection dense kernel at a low cadence (for example 2–5 Hz, not every render frame), and scatter clamped updates.
3. Map a small subset of dimensions to explicit, testable behavior biases: walk-target attraction/avoidance, idle/walk transition threshold, jump probability, and willingness to speak.
4. Preserve the global bubble cooldown and per-character bubble ownership; social influence should change likelihood/content, not bypass presentation rules (`src/characterRegistry.ts:360-384`).
5. Record a diagnostics snapshot in tests (population before/after, chosen lines/actions) so “social influence” is observable rather than assumed.
6. Only then consider CLR reliability and top-k; neither is justified for a four-character desktop overlay.

### Risks

- **Homogenization:** residual averaging can make distinct personalities converge into one mood unless `beta`/`gamma` and per-character biases are constrained.
- **Unexplained behavior:** without an explicit vector-to-action contract, attention becomes an invisible random-number generator.
- **Population churn:** spawn/despawn and deferred spawn promotion must define which entities enter a snapshot (`src/characterRegistry.ts:181-186`, `src/characterRegistry.ts:342-355`).
- **Scaling assumption:** exact top-k does not remove the all-pairs scoring cost and is not a future crowd-scale panacea (`katgpt-rs/.benchmarks/354_set_attention_goat.md:22-37`).
- **Semantic drift:** learned-looking projections would contradict the current modelless roadmap and require evidence before adoption.

## 2. Sleep (`katgpt-sleep`)

### Purpose and API

Sleep-Time Query Anticipation separates offline computation from wake-time lookup. Offline, `SleepTimeAnticipator::anticipate` runs a caller-provided compute operation and predictability scorer for each of `K` anticipated query directions, producing a versioned, BLAKE3-committed `AnticipatedQuerySet` (`katgpt-rs/crates/katgpt-sleep/src/lib.rs:16-38`, `katgpt-rs/crates/katgpt-sleep/src/anticipator.rs:83-149`). Wake-time `consume` finds the best slot, computes a sigmoid gate from predictability, and blends cached and fresh outputs (`katgpt-rs/crates/katgpt-sleep/src/consume.rs:114-189`).

The artifact stores `K` slots, each containing a committed direction, precomputed vector, and predictability score; the full artifact is committed and verifiable (`katgpt-rs/crates/katgpt-sleep/src/types.rs:97-160`). `consume_gate_with_match_mode` returns the slot and gate without executing the fresh fallback (`katgpt-rs/crates/katgpt-sleep/src/consume.rs:237-276`). Two matching modes distinguish topic-direction matching from nearest-forecast-answer matching (`katgpt-rs/crates/katgpt-sleep/src/consume.rs:28-67`, `katgpt-rs/crates/katgpt-sleep/src/consume.rs:80-111`).

### Required state and assumptions

- Fixed latent dimension `D` and bounded catalog size `K`; the crate expects `K ≤ 8` for its intended runtime (`katgpt-rs/crates/katgpt-sleep/src/lib.rs:98-106`, `katgpt-rs/crates/katgpt-sleep/src/types.rs:118-120`).
- A meaningful context vector and query-direction catalog. The default scorer is only an alignment heuristic, explicitly not a claim (`katgpt-rs/crates/katgpt-sleep/src/predictability.rs:1-16`, `katgpt-rs/crates/katgpt-sleep/src/predictability.rs:41-48`).
- An expensive, deterministic `fresh_think` operation worth avoiding; the shipped `IdentityFunctorOp` is a synthetic baseline (`katgpt-rs/crates/katgpt-sleep/src/anticipator.rs:153-181`).
- Repeated, predictable queries so offline cost amortizes across consumers.
- Artifact persistence and versioning if “sleep” spans app sessions; the current Wisp registry creates new IDs and has no restart reload path (`src/characterRegistry.ts:193-199`, `src/characterRegistry.ts:281-299`).

### Dependencies and cost

`katgpt-sleep` depends only on `katgpt-types` and `blake3`, has no feature gates, and compiles its whole substrate (`katgpt-rs/crates/katgpt-sleep/Cargo.toml:13-27`). Offline `anticipate` necessarily allocates the returned artifact, while `consume` is the zero-allocation hot path (`katgpt-rs/crates/katgpt-sleep/src/anticipator.rs:111-149`, `katgpt-rs/crates/katgpt-sleep/src/lib.rs:64-70`).

The explicit amortization model is `sleep_cost + consumers · t · b_max · (1 − expected_gate)`, with precompute paying only when avoided wake cost exceeds offline cost (`katgpt-rs/crates/katgpt-sleep/src/cost_model.rs:1-25`, `katgpt-rs/crates/katgpt-sleep/src/cost_model.rs:63-95`). Current Wisp has no expensive inference call and no consumer queue, so the numerator of this benefit is zero.

### Tests and repo-reported evidence

**Local tests inspected, not run:** inline tests cover deterministic commitments, one-ULP tamper detection, predictable/unpredictable consume behavior, smooth blending, gate range, matching modes, and cost-model boundaries (`katgpt-rs/crates/katgpt-sleep/src/types.rs:163-249`, `katgpt-rs/crates/katgpt-sleep/src/consume.rs:330-620`, `katgpt-rs/crates/katgpt-sleep/src/cost_model.rs:156-258`).

**Repo-reported, not independently reproduced:** the benchmark reports synthetic G1/G2/G5/G6/G7 passes, zero allocations over 1,000 wake calls, 9.5 ns at `D=8,K=8`, 57.6 ns at `D=64,K=8`, and four BLAKE3 tests, while explicitly deferring real-corpus quality gates (`katgpt-rs/.benchmarks/334_sleep_time_goat.md:14-24`). The plan further warns that the default predictability score is an uncalibrated gate heuristic, not uncertainty quantification (`katgpt-rs/.plans/334_sleep_time_query_anticipator_primitive.md:307-313`).

### Wisp fit

The name is misleading for Wisp: this substrate does not give characters circadian rest, dreams, or personality consolidation by itself. It caches answers to anticipated future queries. Wisp's current “queries” are timer rolls for random lines and jumps (`src/characterRegistry.ts:357-385`), which are already cheap and intentionally stochastic. There is also no persistence layer or event history to consolidate.

Therefore Sleep should remain deferred even though the crate is unusually clean and well isolated. It becomes relevant when a character must synthesize expensive responses from long-term memory while the overlay is idle.

### Minimum viable future integration

1. First define restart-surviving character identity, event memory, and a query/event vocabulary.
2. Add a real expensive operation that can be skipped—for example narrative summary, future intention selection, or response generation—not random animation selection.
3. Run `anticipate` only during an explicit idle/sleep phase away from Pixi's ticker, likely in Rust or a worker.
4. Persist a versioned artifact keyed by character identity, not by the current session-only numeric ID (`src/characterRegistry.ts:193-199`).
5. Use `consume_gate` to decide cache use; only invoke fresh computation on a miss.
6. Add an expiry/policy layer so stale predictions fade when memory or personality changes.

### Risks

- **Premature infrastructure:** commitments and catalogs burden Wisp before memory semantics exist.
- **Stale predictions:** cached affect or speech may make characters repeat inappropriate behavior.
- **False predictability:** alignment-based scores can produce confident but useless caching; the source explicitly calls the default a baseline (`katgpt-rs/crates/katgpt-sleep/src/predictability.rs:41-48`).
- **Privacy and persistence:** user-adjacent observations would introduce retention and consent questions absent from the current random-speech design.
- **Amortization failure:** with few or unpredictable wake-time consumers, offline work is pure overhead (`katgpt-rs/crates/katgpt-sleep/src/cost_model.rs:87-95`).

## 3. Sense (`katgpt-sense`)

### Purpose and API

Sense compresses knowledge-graph embeddings into fixed `SenseModule` pods and reconstructs six sense activations from an evolving eight-dimensional belief. Its public surface includes `SenseOctreeBuilder`, `ReconstructionState`, BAKE precision updates, and binary serialization (`katgpt-rs/crates/katgpt-sense/README.md:24-33`). The six sense kinds range from Common and Fighter to Spatial, Social, and Skill (`katgpt-rs/crates/katgpt-types/src/sense.rs:81-96`).

`KgEmbedding` assumes entity and relation hashes, an eight-float embedding, confidence, and sign (`katgpt-rs/crates/katgpt-sense/src/octree.rs:5-13`). `SenseModule` stores four occupancy words, eight ternary directions, confidence, metadata, and a 32-byte commitment (`katgpt-rs/crates/katgpt-types/src/sense.rs:141-157`). Projection computes a ternary dot product followed by confidence-scaled sigmoid (`katgpt-rs/crates/katgpt-types/src/sense.rs:159-193`). Active reconstruction holds an evolving belief, evidence, configuration, active nodes, a step count, and optional surprise state (`katgpt-rs/crates/katgpt-sense/src/reconstruction.rs:395-435`); its default is at most three steps with belief learning and entropy-based early stop (`katgpt-rs/crates/katgpt-sense/src/reconstruction.rs:74-148`). BAKE updates an eight-dimensional precision-weighted mean and precision vector (`katgpt-rs/crates/katgpt-sense/src/bake.rs:1-63`).

### Required state and assumptions

- A source of meaningful KG entity/relation embeddings and confidence values. The builder does not infer these.
- A per-character or shared “brain” with an eight-float belief state and a reason to select among six senses.
- A corpus/schema that makes module confidence and reconstruction quality meaningful.
- A persistence format and lifecycle for modules; the crate provides raw binary save/load but not a higher-level store (`katgpt-rs/crates/katgpt-sense/src/serialize.rs:1-70`).
- If using optional schema centroids or precision stores, acceptance of the `papaya` concurrent-map dependency (`katgpt-rs/crates/katgpt-sense/Cargo.toml:17-19`, `katgpt-rs/crates/katgpt-sense/Cargo.toml:48-68`).

### Dependencies and cost

The core crate always compiles octree, reconstruction, BAKE, and serialization, and depends on `katgpt-types`, `blake3`, and `fastrand`; optional `papaya` is pulled by schema-centroid and precision features (`katgpt-rs/crates/katgpt-sense/Cargo.toml:13-19`, `katgpt-rs/crates/katgpt-sense/Cargo.toml:21-73`). BAKE advertises `O(8)` updates (`katgpt-rs/crates/katgpt-sense/src/bake.rs:1-6`). Reconstruction uses an adaptive 500 ns latency threshold (`katgpt-rs/crates/katgpt-sense/src/reconstruction.rs:151-160`).

There is also an implementation/documentation mismatch worth flagging: the historical plan describes recursive spatial partitioning, yet the checked-in builder simply sets one occupancy bit per nonzero embedding dimension and keeps at most the first eight embeddings as directions (`katgpt-rs/crates/katgpt-sense/src/octree.rs:57-69`, `katgpt-rs/crates/katgpt-sense/src/octree.rs:73-80`). `query_octree` itself labels its level calculation “quadtree-like” (`katgpt-rs/crates/katgpt-types/src/sense.rs:195-210`). This does not prove the whole crate unusable, but it means Wisp should not adopt it based on the historical “octree” narrative alone.

### Tests and repo-reported evidence

**Local tests inspected, not run:** serialization has roundtrip, invalid-magic, and BLAKE3 verification tests (`katgpt-rs/crates/katgpt-sense/src/serialize.rs:72-103`); octree tests exercise empty/single modules, centroid construction, Merkle determinism, and commitment behavior (`katgpt-rs/crates/katgpt-sense/src/octree.rs:208-369`); reconstruction tests cover node indexing, entropy, step limits, scalar/SIMD equivalence, surprise separation, byte-identical belief evolution, and padded activations (`katgpt-rs/crates/katgpt-sense/src/reconstruction.rs:1357-1800`).

**Repo-reported, not independently reproduced:** the historical plan reports 232-byte modules, roughly 45 ns per tick per NPC, about 100 KB per NPC brain, and six sense kinds (`katgpt-rs/.plans/221_kg_latent_octree_sense_composition.md:35-44`). Those numbers describe the former integrated runtime and are not direct evidence of value in Wisp's current TypeScript registry.

### Wisp fit

Sense is a poor current fit. Wisp's only perception subsystem is the Python gesture sidecar, and its Rust bridge recognizes only `spawn`, `error`, and `ready` events (`src-tauri/src/sidecar.rs:65-100`). Sense would add a second, richer perception architecture while leaving the actual sensor unchanged. Wisp also has no KG, belief state, or six-sense behavioral contract. Importing it now would make architecture more game-like without making the four current characters more distinctive (`src/config.ts:81-130`).

If future characters should react to recognized user context, the first step is a richer NDJSON event schema and a small TypeScript representation—not a Rust KG brain. Sense should be reconsidered only after persistent context, embeddings, and a demonstrated need for multi-step retrieval exist.

### Minimum viable future integration

A future proof of value should precede any import:

1. Extend the sidecar event contract with normalized gesture/session context and confidence.
2. Keep a bounded event history in the simulation layer and show that characters can use it to alter behavior.
3. Define a Wisp-specific sense taxonomy; do not assume Fighter/GameTheory/Skill senses match a desktop overlay (`katgpt-rs/crates/katgpt-types/src/sense.rs:81-96`).
4. Only then evaluate whether embedding-based reconstruction outperforms a simple event-to-mood map.
5. If adopted, keep Sense in Rust/worker code and expose a narrow, serializable activation summary to TypeScript rather than importing Pixi rendering into Rust.

### Risks

- **Wrong sensor boundary:** the Python sidecar owns vision; Rust Sense cannot improve detection accuracy by itself.
- **Corpus dependency:** empty or invented embeddings become pseudoscientific knobs.
- **Doc/code drift:** the historical recursive-octree description does not match the simple checked-in occupancy builder (`katgpt-rs/.plans/221_kg_latent_octree_sense_composition.md:68-72`, `katgpt-rs/crates/katgpt-sense/src/octree.rs:73-80`).
- **Unsafe/fragile serialization:** the format relies on `repr(C)`, raw copying, padding zeroing, and BLAKE3 verification (`katgpt-rs/crates/katgpt-sense/src/serialize.rs:9-69`).
- **Overbuilt state:** six reconstructed senses are unnecessary until one durable mood vector has proven value.

## 4. Viable Manifold Graph (`katgpt-core`)

### Purpose and API

Viable Manifold Graph constructs a discrete approximation of a safe latent manifold and navigates only on viable nodes/edges. It provides `pullback_volume`, `build_safe_manifold_graph`, `manifold_geodesic`, uniform `manifold_random_walk`, and weighted `manifold_curiosity_walk` (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:1-28`). The map and viability predicate are caller-supplied closures, with no game semantics in the primitive (`katgpt-rs/.plans/312_viable_manifold_graph_primitive.md:14-22`).

`pullback_volume` numerically computes a stable log determinant from Jacobian singular values using reusable SVD scratch (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:76-113`). `SafeManifoldGraph` stores flat node coordinates, sorted edges, and CSR adjacency for deterministic `O(degree)` neighbor iteration (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:119-145`, `katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:246-283`). Construction filters each sample by volume and an explicit predicate, then joins each kept node to nearest kept neighbors and optionally checks midpoint viability (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:325-380`, `katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:388-487`). A* returns a viable node path (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:494-529`), while random walks return exactly `m + 1` nodes and park at an isolated node if necessary (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:620-671`).

### Required state and assumptions

- A latent sample set of sufficient density and dimensionality to represent the intended manifold.
- A smooth map `f` whose Jacobian volume is meaningful. Current Wisp has no such map.
- A correctness-critical `ViabilityPredicate`; the primitive only enforces the predicate it is given (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:345-370`).
- A volume threshold, neighbor count, and midpoint-check policy.
- An offline graph lifecycle: rebuild when state space, personality model, or viability rules change.
- A mapping from node transitions to character behavior; Wisp's current spatial behavior already has simple screen bounds (`src/character.ts:188-200`).

### Dependencies and cost

The feature reuses `subspace_phase_gate` and declares no additional dependency (`katgpt-rs/crates/katgpt-core/Cargo.toml:362`). Construction allocates kept nodes, candidate edges, distance scratch, optional midpoint scratch, and CSR arrays (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:411-487`); A* allocates score/predecessor/closed/open structures proportional to graph size (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:515-529`). The `neighbors()` query itself allocates and is designated cold, unlike `for_each_neighbor` (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:246-261`).

### Tests and repo-reported evidence

**Local tests inspected, not run:** inline G1–G6 tests check identity/scaling volume, connected/disconnected graph construction, geodesic validity, walk viability, and capacity stability over 1,000 steps (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:740-803`, `katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:831-1077`). Additional tests check curiosity-walk adjacency and trivial reachable/unreachable A* cases (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:1079-1134`).

**Repo-reported, not independently reproduced:** the benchmark reports all ten unit tests passing, 100% viability on a two-disk/corridor walk, and post-CSR medians of 310 ns for one pullback, 384.60 µs to build from 1,000 four-dimensional samples, and 7.10 ns per random-walk step (`katgpt-rs/.benchmarks/312_viable_manifold_graph_goat.md:14-31`, `katgpt-rs/.benchmarks/312_viable_manifold_graph_goat.md:144-168`). The original 485.58 ns/step failure was transparently root-caused as an `O(E)` adjacency scan and fixed with CSR (`katgpt-rs/.benchmarks/312_viable_manifold_graph_goat.md:62-79`, `katgpt-rs/.benchmarks/312_viable_manifold_graph_goat.md:124-162`).

### Wisp fit

The eventual Wisp use is not x/y navigation. Screen movement is already bounded and intentionally aimless (`src/character.ts:203-212`). The useful future application is affect/personality exploration: constrain mood trajectories to states that are valid for a character's identity and expressible by Wisp's animation and speech seams.

That payoff depends on the priority personality/micro-belief work. Until then, a graph over arbitrary numbers would be validation theater. Therefore defer, but preserve the idea as a later stability mechanism rather than treating it as a movement planner.

### Minimum viable future integration

1. Define a compact affect/personality vector and an animation compatibility predicate (for example allowable energy, sociability, anxiety, and speech bounds).
2. Collect or construct a finite sample of validated states; do not run SVD over x/y screen positions.
3. Build the graph offline in Rust or a worker, not in the render ticker.
4. Use `manifold_curiosity_walk` to choose the next target state at a slow cadence.
5. Map each node transition to deterministic observable changes and debounce it longer than Wisp's 0.5-second jump animation (`src/config.ts:25-36`).
6. Rebuild only on personality-model changes; never rebuild every frame.

### Risks

- **False viability:** a bad predicate makes “safe by construction” safely wrong.
- **Sampling holes/disconnection:** sparse samples can park a character at an isolated state (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:648-660`).
- **Stale graphs:** personality updates can invalidate cached nodes/edges.
- **Numerical tuning:** forward-difference epsilon and threshold choices affect volume filtering (`katgpt-rs/crates/katgpt-core/src/viable_manifold_graph.rs:42-74`).
- **Overengineering:** independent bounded random walks may remain more understandable for a four-character overlay.

## 5. Trigger Gate (`katgpt-core`)

### Purpose and API

TriggerGate escalates a compute workload from CPU-only to CPU+GPU to CPU+GPU+ANE based on QPS and queue depth, with hysteresis and a minimum change interval (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:1-9`). `ComputeTier` is exactly those three ordered hardware tiers (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:15-48`). Configuration defaults are 10,000 QPS for GPU, 100,000 QPS for ANE, 0.7 hysteresis, queue depth 100, P99 latency 5 ms, and 500 ms minimum interval (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:53-81`).

The gate's state consists of atomic inference/latency/queue counters, mutex-protected tier/window timestamps, the current tier, and hardware availability flags (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:155-177`). Recording APIs feed those counters (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:198-214`), promotion/demotion decisions apply thresholds (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:216-277`), and `evaluate` commits a tier change while enforcing the interval and resetting the window (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:279-353`). `TriggerGateMonitor` owns a shared gate and launches a background sleeping evaluation thread (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:395-465`).

### Required state and assumptions

- A centralized stream of completed inference durations and queue-depth observations.
- Actual optional GPU/ANE backends capable of executing the same workload; the router falls back to CPU when a backend is absent or compilation fails (`katgpt-rs/src/inference_router.rs:1-13`, `katgpt-rs/src/inference_router.rs:650-680`).
- Server-scale load. The originating plan was motivated by 30,000 concurrent clients and roughly 600,000 inferences per second (`katgpt-rs/.plans/176_ane_inference_backend.md:10-22`).
- Ownership of tier transitions and backend compilation/recompile hints (`katgpt-rs/src/inference_router.rs:305-353`).

### Dependencies and cost

The module is always-on in `katgpt-core` and uses standard atomics, mutexes, threads, `Instant`, and serde configuration types (`katgpt-rs/crates/katgpt-core/src/lib.rs:2342`, `katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:6-9`). Its monitor cost is a dedicated thread plus periodic mutex-protected evaluation (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:405-460`). TOML helpers are test-only to avoid a production `toml` dependency (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:101-121`).

Wisp already has separate lifecycle concerns: the Pixi ticker owns simulation timing, and the sidecar process is explicitly started/stopped and reverts UI state on failure (`src-tauri/src/sidecar.rs:25-111`). TriggerGate would add a third scheduler without adding an execution target.

### Tests and repo-reported evidence

**Local tests inspected, not run:** inline tests cover initial CPU-only state, GPU/ANE promotion, hysteresis, minimum interval, tier ordering, unavailable hardware, display/config round trips, and monitor lifecycle/promotion (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:491-590`, `katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:592-665`, `katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:668-724`, `katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:726-804`). The integration GOAT test additionally wires the gate into an inference router and transformer fixtures (`katgpt-rs/tests/goat_176_trigger_gate.rs:1-103`).

**Repo-reported, not independently reproduced:** the benchmark file asserts `evaluate()` below 1 µs and `record_inference()` below 0.5 µs, although this audit did not re-run it (`katgpt-rs/tests/bench_176_trigger_gate.rs:46-94`). The historical plan claims all parts complete and lists backend-selection overhead around 0.20 µs, but its hardware-oriented claims were not reproduced here (`katgpt-rs/.plans/176_ane_inference_backend.md:213-220`).

### Wisp fit

TriggerGate is a poor fit by domain, not by implementation quality. Wisp's per-frame computation is a TypeScript registry tick over a small character list (`src/main.ts:76-88`, `src/characterRegistry.ts:332-385`). It has no model forward pass, request queue, GPU/ANE backend, or QPS stream. The Python sidecar emits gesture events; it does not expose an inference queue whose depth TriggerGate could meaningfully observe (`src-tauri/src/sidecar.rs:65-100`).

Even if future behavior becomes computationally heavier, the first Wisp solution should likely be worker isolation, batching, or lower update cadence. Hardware tier routing is justified only after profiling proves a sustained accelerator-worthy workload.

### Minimum viable future integration

Trigger Gate should not be integrated as-is. A distant alternative would require:

1. A Rust/worker cognition service that performs batched, expensive character updates.
2. A real request queue and completed-operation timing stream.
3. At least two genuine execution strategies with different latency/power/quality tradeoffs—not merely booleans named GPU and ANE.
4. A rewritten tier enum and thresholds for those strategies.
5. Failure semantics equivalent to the sidecar's existing automatic UI reversion (`src-tauri/src/sidecar.rs:74-100`).

Until then, only the generic design ideas—hysteresis and a minimum transition interval—are worth borrowing in a simpler TypeScript scheduler.

### Risks

- **False domain mapping:** animation ticks and model inferences are not interchangeable QPS units.
- **No backend payoff:** hardware flags alone cannot improve performance.
- **Thread/lifecycle complexity:** a monitor thread and shared mutex state complicate a desktop overlay for no current benefit (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:395-465`).
- **Inappropriate defaults:** 10,000–100,000 QPS describe a server workload, not four wandering sprites (`katgpt-rs/.plans/176_ane_inference_backend.md:10-22`).
- **Panic policy:** mutex poisoning is handled by `expect`, which is acceptable inside the substrate's assumed service but risky if imported casually (`katgpt-rs/crates/katgpt-core/src/trigger_gate.rs:283-350`).

## Decision summary

The secondary substrates divide cleanly:

- **Defer because they extend individual state:** Set Attention (social influence), Sleep (offline consolidation/query cache), and Viable Manifold Graph (safe affect exploration).
- **Reject because they solve a different system:** Sense (KG perception brain versus existing gesture sidecar) and Trigger Gate (server inference hardware routing versus a lightweight desktop ticker).

No import should precede the priority individual-state layer. The first future integration should be the smallest observable Set Attention experiment on bounded per-character vectors, with the Rust crates remaining reference implementations rather than approved Wisp dependencies.
