# Priority katgpt-rs substrates for Wisp

**Research ticket:** [Audit the priority substrate trio for Wisp · #34](https://github.com/TK3096/wisp/issues/34)  
**Audit date:** 2026-08-25  
**Primary material:** the ignored local `katgpt-rs/` tree in this checkout. All performance/GOAT numbers below are **repo-reported** unless explicitly listed under “Tests actually run in this audit.” They were not re-benchmarked here.

## Executive answer

**Recommendation:** adopt the three algorithms as small, pure-TypeScript per-character substrates in Wisp's simulation layer; do **not** import `katgpt-core` or the Rust crates wholesale.

1. **Temporal Derivative — adopt first.** It is only two EMAs plus their difference and a sigmoid gate. It naturally biases Wisp's existing idle/walk/jump/bubble roll timers from changes in per-character observations.
2. **Micro-belief — adopt only `LeakyIntegrator` (Family C).** The repo-reported coherence benchmark decisively favors it over random-initialized `AttractorKernel`; defer or reject Family A/B for Wisp.
3. **Personality — adopt static sigmoid-gated composition, but defer reward-surprise drift.** Wisp has no reward definition yet. Start with per-character/per-archetype weights that modulate visible behavior, then decide whether user interaction supplies a reward signal.
4. **Do not extract `katgpt-core`.** Temporal Derivative now lives in `katgpt-types` and `katgpt-core` is only a compatibility re-export; Personality and Micro-belief are also extracted leaf crates. `katgpt-core` additionally carries a very large default feature set.

This follows the existing Wisp architecture: the simulation remains pure TypeScript with injected rendering handles (`src/character.ts:18-26`), registry-owned factories and change callbacks (`src/characterRegistry.ts:95-126`), and tunables centralized in `src/config.ts:1-10` and `src/config.ts:25-54`.

The strongest evidence is:

- Temporal Derivative: repo-reported 4/4 fusion gates pass, although those gates concern katgpt consumers rather than Wisp (`katgpt-rs/.benchmarks/277_temporal_deriv_goat.md:18-30`).
- Micro-belief: repo-reported leaky coherence is 1 flip versus 569 for the random attractor and 560 for latent thought (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:78-90`); the report explicitly limits promotable output to the trait plus `LeakyIntegrator` (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:123-132`).
- Personality: repo-reported compose cost is 79.585 ns at N=9/D=32 and zero hot-path allocations by code audit (`katgpt-rs/.benchmarks/297_personality_composition_goat.md:12-20`, `katgpt-rs/.benchmarks/297_personality_composition_goat.md:48-79`), but Wisp has neither nine latent behavior layers nor a reward source yet.

## Exact public APIs

### `katgpt-personality` 0.1.3

The crate exports modules and the principal types/functions through its root (`katgpt-rs/crates/katgpt-personality/src/lib.rs:81-91`). It also pins these aliases: `SingleLayerComposition<N=1>`, `QuadLayerComposition<N=4>`, `HeptaLayerComposition<N=7>`, and `EntityCognitionComposition<N=9,D=32>` (`katgpt-rs/crates/katgpt-personality/src/lib.rs:93-113`).

```rust
pub struct PersonalityConfig {
    pub tau: f32,
    pub alpha: f32,
    pub w_max: f32,
    pub ema_decay: f32,
}
impl PersonalityConfig {
    pub fn is_valid(&self) -> bool;
}

pub struct ArchetypeLabel(pub [u8; 16]);
impl ArchetypeLabel {
    pub fn new(bytes: [u8; 16]) -> Self;
    pub fn from_str(s: &str) -> Self;
    pub fn empty() -> Self;
    pub fn as_bytes(&self) -> &[u8; 16];
}

pub trait LayerDirectionSource: Send + Sync {
    fn direction<'a>(&self, scratch: &'a mut [f32]) -> &'a [f32];
    fn recent_direction(&self) -> &[f32] { /* empty by default */ }
    fn belief_confidence(&self) -> f32 { /* 1.0 by default */ }
}

pub struct PersonalityWeightedComposition<const N: usize, const D: usize> {
    pub w: [f32; N],
}
impl<const N: usize, const D: usize> PersonalityWeightedComposition<N, D> {
    pub fn new(config: PersonalityConfig, initial_w: [f32; N]) -> Self;
    pub fn uniform() -> Self;
    pub const fn config(&self) -> &PersonalityConfig;
    pub const fn r_expected(&self) -> &[f32; N];
    pub fn compose_into<'a>(
        &self,
        layers: &[&dyn LayerDirectionSource; N],
        scratch: &mut [f32],
        out: &'a mut [f32],
    ) -> &'a mut [f32];
    pub fn drift(&mut self, layers: &[&dyn LayerDirectionSource; N], r_observed: f32);
    pub fn w_snapshot(&self) -> &[f32; N];
    pub fn restore_w(&mut self, w: [f32; N]);
    pub fn restore_r_expected(&mut self, r_expected: [f32; N]);
    pub fn reset_r_expected(&mut self);
    pub fn to_bytes(&self) -> Vec<u8>;
    pub fn from_bytes(buf: &[u8]) -> Option<Self>;
    pub fn snapshot(
        &self,
        archetype: ArchetypeLabel,
        version: u64,
    ) -> PersonalitySnapshot<N>;
}

pub struct PersonalitySnapshot<const N: usize> {
    pub w: [f32; N],
    pub archetype: ArchetypeLabel,
    pub blake3: [u8; 32],
    pub version: u64,
}
impl<const N: usize> PersonalitySnapshot<N> {
    pub fn from_composition<const D: usize>(
        composition: &PersonalityWeightedComposition<N, D>,
        archetype: ArchetypeLabel,
        version: u64,
    ) -> Self;
    pub fn from_parts(
        w: [f32; N],
        archetype: ArchetypeLabel,
        blake3: [u8; 32],
        version: u64,
    ) -> Self;
    pub fn commit(&mut self) -> [u8; 32];
    pub fn verify_blake3(&self) -> bool;
    pub fn to_bytes(&self) -> Vec<u8>;
    pub fn from_bytes(buf: &[u8]) -> Option<Self>;
}

pub fn sigmoid(x: f32) -> f32;
pub fn sigmoid_into(x: &[f32], out: &mut [f32]);
pub const SNAPSHOT_VERSION: u64 = 1;
```

Sources: config fields and validation (`katgpt-rs/crates/katgpt-personality/src/types.rs:19-79`), archetype API (`katgpt-rs/crates/katgpt-personality/src/types.rs:81-136`), trait contract (`katgpt-rs/crates/katgpt-personality/src/trait_def.rs:38-88`), kernel methods (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:64-104`, `katgpt-rs/crates/katgpt-personality/src/kernel.rs:138-176`, `katgpt-rs/crates/katgpt-personality/src/kernel.rs:180-244`, `katgpt-rs/crates/katgpt-personality/src/kernel.rs:246-364`), snapshot fields/methods (`katgpt-rs/crates/katgpt-personality/src/snapshot.rs:42-100`, `katgpt-rs/crates/katgpt-personality/src/snapshot.rs:103-234`), and sigmoid API (`katgpt-rs/crates/katgpt-personality/src/sigmoid.rs:10-47`).

### `katgpt-micro-belief` 0.2.1

The recommended extraction is the core family API plus `LeakyIntegrator`, bridge, and optionally snapshot. The crate also contains opt-in BoM sampling and arena modules; those are intentionally excluded from the minimum Wisp unit (`katgpt-rs/crates/katgpt-micro-belief/Cargo.toml:28-35`, `katgpt-rs/crates/katgpt-micro-belief/README.md:35-37`).

```rust
#[repr(u8)]
pub enum RecurrenceFamily {
    Attractor = 0,
    LatentThought = 1,
    DeltaRule = 2,
}
impl RecurrenceFamily {
    pub const fn from_u8(b: u8) -> Option<Self>;
}

pub trait MicroRecurrentBeliefState: Send + Sync {
    fn dim(&self) -> usize;
    fn step(&self, state: &mut [f32], input: &[f32]);
    fn project_to_scalars(
        &self,
        state: &[f32],
        directions: &[f32],
        dim: usize,
        out: &mut [f32],
    );
    fn family(&self) -> RecurrenceFamily;
}

pub struct KernelConfig {
    pub dim: usize,
    pub family: RecurrenceFamily,
    pub clamp: f32,
    pub seed: u64,
}
impl KernelConfig {
    pub fn with_dim(self, dim: usize) -> Self;
    pub fn with_family(self, family: RecurrenceFamily) -> Self;
    pub fn with_clamp(self, clamp: f32) -> Self;
    pub fn with_seed(self, seed: u64) -> Self;
}

pub struct AttractorKernel {
    pub ws: Vec<f32>,
    pub wx: Vec<f32>,
    pub b: Vec<f32>,
    pub dim: usize,
    pub clamp: f32,
    pub seed: u64,
}
impl AttractorKernel {
    pub fn from_seed(seed: u64, dim: usize) -> Self;
    pub fn from_config(config: &KernelConfig) -> Self;
    pub fn with_clamp(self, clamp: f32) -> Self;
    pub fn precompute_wx_dot(&self, input: &[f32], out: &mut [f32]);
    pub fn step_with_precomputed_wx(&self, state: &mut [f32], wx_x: &[f32]);
    #[cfg(feature = "depth_invariance")]
    pub fn audit_depth_invariance(/* ... */) -> katgpt_types::depth_invariance::DepthInvarianceDiagnostic;
    pub fn to_snapshot_blob(&self) -> Vec<u8>;
}
impl MicroRecurrentBeliefState for AttractorKernel { /* ... */ }

pub struct LeakyIntegrator {
    pub lr: f32,
    pub max_delta: f32,
    pub dim: usize,
}
impl LeakyIntegrator {
    pub fn new(lr: f32, max_delta: f32, dim: usize) -> Self;
    pub fn belief_default(dim: usize) -> Self;
    #[cfg(feature = "depth_invariance")]
    pub fn audit_depth_invariance(/* ... */) -> katgpt_types::depth_invariance::DepthInvarianceDiagnostic;
}
impl MicroRecurrentBeliefState for LeakyIntegrator { /* ... */ }

pub struct LatentThoughtKernel {
    pub inner: AttractorKernel,
    pub k_iters: u8,
}
impl LatentThoughtKernel {
    pub fn from_seed(seed: u64, dim: usize, k_iters: u8) -> Self;
    pub fn with_k_iters(self, k: u8) -> Self;
}
impl MicroRecurrentBeliefState for LatentThoughtKernel { /* ... */ }

pub fn project_to_scalars(
    state: &[f32],
    directions: &[f32],
    dim: usize,
    out: &mut [f32],
);

pub const SNAPSHOT_VERSION: u64 = 1;
pub struct MicroRecurrentKernelSnapshot {
    pub family: RecurrenceFamily,
    pub dim: usize,
    pub weights_blob: Vec<u8>,
    pub blake3: [u8; 32],
    pub version: u64,
}
impl MicroRecurrentKernelSnapshot {
    pub fn from_kernel<K: MicroRecurrentBeliefState>(
        kernel: &K,
        weights_blob: Vec<u8>,
        version: u64,
    ) -> Self;
    pub fn from_parts(
        family: RecurrenceFamily,
        dim: usize,
        weights_blob: Vec<u8>,
        blake3: [u8; 32],
        version: u64,
    ) -> Self;
    pub fn commit(&mut self) -> [u8; 32];
    pub fn verify(&self) -> bool;
    pub fn to_bytes(&self) -> Vec<u8>;
    pub fn from_bytes(buf: &[u8]) -> Option<Self>;
}
```

Sources: family enum and taxonomy (`katgpt-rs/crates/katgpt-micro-belief/src/types.rs:26-73`), trait contract (`katgpt-rs/crates/katgpt-micro-belief/src/types.rs:76-147`), config (`katgpt-rs/crates/katgpt-micro-belief/src/types.rs:179-242`), attractor fields and methods (`katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:54-77`, `katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:79-145`, `katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:168-245`, `katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:280-318`, `katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:321-456`), leaky API (`katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:45-73`, `katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:75-134`, `katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:137-167`), latent-thought API (`katgpt-rs/crates/katgpt-micro-belief/src/latent_thought.rs:37-70`, `katgpt-rs/crates/katgpt-micro-belief/src/latent_thought.rs:73-135`), bridge (`katgpt-rs/crates/katgpt-micro-belief/src/bridge.rs:27-57`), and snapshot (`katgpt-rs/crates/katgpt-micro-belief/src/snapshot.rs:42-75`, `katgpt-rs/crates/katgpt-micro-belief/src/snapshot.rs:77-212`).

### Temporal Derivative

The implementation now lives in `katgpt-types`; `katgpt-core::temporal_deriv` only re-exports it to preserve historical paths (`katgpt-rs/crates/katgpt-core/src/temporal_deriv.rs:7-18`).

```rust
pub struct TemporalDerivativeKernel<const N: usize> {
    pub fast: [f32; N],
    pub slow: [f32; N],
    pub alpha_fast: f32,
    pub alpha_slow: f32,
}

impl<const N: usize> TemporalDerivativeKernel<N> {
    pub fn new(alpha_fast: f32, alpha_slow: f32) -> Self;
    pub fn with_initial(
        fast: [f32; N],
        slow: [f32; N],
        alpha_fast: f32,
        alpha_slow: f32,
    ) -> Self;
    pub fn observe(&mut self, signal: &[f32; N]) -> [f32; N];
    pub fn observe_simd(&mut self, signal: &[f32; N]) -> [f32; N];
    pub fn surprise_norm(&self) -> f32;
    pub fn derivative_slice(&self, out: &mut [f32; N]);
    pub fn reset(&mut self);
}

impl<const N: usize> Default for TemporalDerivativeKernel<N> {
    fn default() -> Self; // alpha_fast = 0.3, alpha_slow = 0.03
}

pub fn sigmoid_surprise_gate(derivative: &[f32], beta: f32) -> f32;
```

Sources: struct and invariants (`katgpt-rs/crates/katgpt-types/src/temporal.rs:50-78`), constructors (`katgpt-rs/crates/katgpt-types/src/temporal.rs:80-108`), observe and alias (`katgpt-rs/crates/katgpt-types/src/temporal.rs:110-155`), norm/derivative/reset (`katgpt-rs/crates/katgpt-types/src/temporal.rs:157-189`), default (`katgpt-rs/crates/katgpt-types/src/temporal.rs:192-198`), and gate (`katgpt-rs/crates/katgpt-types/src/temporal.rs:200-218`).

## Algorithm and state model

### Personality

Composition is:

```text
behavior[j] = Σ_i sigmoid(w_i / τ) · belief_confidence_i · direction_i[j]
```

The implementation zeroes the caller-owned output, obtains each direction, computes the gate, and uses SIMD scale-accumulate for each layer (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:151-176`). `LayerDirectionSource::direction` is zero-allocation and accepts caller scratch (`katgpt-rs/crates/katgpt-personality/src/trait_def.rs:21-56`); `belief_confidence` defaults to 1.0 (`katgpt-rs/crates/katgpt-personality/src/trait_def.rs:73-88`).

Drift is:

```text
surprise_i     = r_observed − r_expected_i
delta_i        = α · surprise_i · Σ_j recent_direction_i[j]
w_i            = clamp(w_i + delta_i, −w_max, +w_max)
r_expected_i   = ema_decay · r_expected_i + (1 − ema_decay) · r_observed
```

The implementation treats the sum of the recent direction components as the scalar credit direction, clamps `w`, and updates the reward EMA (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:180-244`). Defaults are `τ=1.0`, `α=0.01`, `w_max=5.0`, and `ema_decay=0.95` (`katgpt-rs/crates/katgpt-personality/src/types.rs:12-18`, `katgpt-rs/crates/katgpt-personality/src/types.rs:50-59`).

State is `w`, immutable config, and per-layer `r_expected`; at N=9 it is documented as 88 bytes (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:29-55`). Snapshots commit `(archetype, w)` with BLAKE3 and exclude the caller-managed version (`katgpt-rs/crates/katgpt-personality/src/snapshot.rs:159-186`). The flat composition format is `w || config || r_expected`, is deterministic, and has no cryptographic integrity (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:292-364`).

### Micro-belief

All families implement one in-place tick, `s_t = f(s_{t−1}, x_t)`, with caller-owned state and zero allocation (`katgpt-rs/crates/katgpt-micro-belief/src/types.rs:76-147`).

- **Family A / Attractor:** `s_t = 2σ(W_s·s + W_x·x + b) − 1`, stored in `(-1,1)` (`katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:1-28`). Random Xavier-like weights are deterministically generated with `fastrand`, with zero bias (`katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:79-114`). The step computes all rows before write-back to avoid read-after-write corruption (`katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:327-345`, `katgpt-rs/crates/katgpt-micro-belief/src/attractor.rs:410-445`).
- **Family B / LatentThought:** wraps Family A and applies the same input K times per tick; K=0 is a no-op and K=1 is bit-identical to the attractor (`katgpt-rs/crates/katgpt-micro-belief/src/latent_thought.rs:1-26`, `katgpt-rs/crates/katgpt-micro-belief/src/latent_thought.rs:37-70`, `katgpt-rs/crates/katgpt-micro-belief/src/latent_thought.rs:79-125`).
- **Family C / Leaky (recommended):** stateless config plus caller-owned state (`katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:45-58`). With `total = Σ input`, the shared primitive is:

```text
if total < 1e-8: return
t_min      = min(total, 1)
scale      = lr · t_min / total
half_total = 0.5 · total
delta_i    = scale · (input_i − half_total)
state_i    = clamp(state_i + clamp(delta_i, ±max_delta), [-1, 1])
```

This exact formula and stability properties are documented and implemented in `katgpt-types::leaky_core` (`katgpt-rs/crates/katgpt-types/src/leaky_core.rs:26-45`, `katgpt-rs/crates/katgpt-types/src/leaky_core.rs:47-80`); `LeakyIntegrator::step` supplies full-dimension `total` (`katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:143-157`). Defaults matching the source baseline are `lr=0.1` and `max_delta=0.2` (`katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:60-73`).

The latent-to-raw bridge is one-way: `out[k] = sigmoid(dot(state, direction_k))` (`katgpt-rs/crates/katgpt-micro-belief/src/types.rs:127-143`, `katgpt-rs/crates/katgpt-micro-belief/src/bridge.rs:27-53`). The crate's boundary model says live belief is local and never synced, while bounded projected scalars may cross the boundary (`katgpt-rs/crates/katgpt-micro-belief/src/lib.rs:24-33`).

### Temporal Derivative

Each tick updates two EMAs and returns their difference:

```text
fast_i ← (1 − α_fast) · fast_i + α_fast · signal_i
slow_i ← (1 − α_slow) · slow_i + α_slow · signal_i
derivative_i = fast_i − slow_i
```

`observe` performs exactly those two fused-decay updates and subtracts slow from fast (`katgpt-rs/crates/katgpt-types/src/temporal.rs:110-144`). `surprise_norm` is the L2 norm of that difference (`katgpt-rs/crates/katgpt-types/src/temporal.rs:157-172`), and the raw gate is `sigmoid(β · ‖derivative‖₂)` (`katgpt-rs/crates/katgpt-types/src/temporal.rs:200-218`). Default coefficients are 0.3 fast and 0.03 slow (`katgpt-rs/crates/katgpt-types/src/temporal.rs:192-198`). The intended boundary keeps the vector local and exposes only a bounded summary scalar (`katgpt-rs/crates/katgpt-types/src/temporal.rs:27-36`).

## Dependencies, licensing, editions, and portability

| Unit | Declared package facts | Direct dependencies relevant to extraction |
|---|---|---|
| `katgpt-personality` | version 0.1.3, Rust edition 2024, MIT (`katgpt-rs/crates/katgpt-personality/Cargo.toml:1-6`) | `katgpt-types` 0.2.1, `blake3` 1, `serde` 1 derive; no `katgpt-core` dependency (`katgpt-rs/crates/katgpt-personality/Cargo.toml:13-22`) |
| `katgpt-micro-belief` | version 0.2.1, edition 2024, MIT (`katgpt-rs/crates/katgpt-micro-belief/Cargo.toml:1-6`) | `katgpt-types`, `blake3`, `fastrand`, `serde`; dev-only `serde_json`; core kernels compile with default `[]` (`katgpt-rs/crates/katgpt-micro-belief/Cargo.toml:13-26`) |
| `katgpt-types` / Temporal | version 0.2.1, edition 2024, MIT (`katgpt-rs/crates/katgpt-types/Cargo.toml:1-6`) | always-compiled direct deps `fastrand`, `blake3`, `serde`, `half`, `rayon` (`katgpt-rs/crates/katgpt-types/Cargo.toml:13-18`) |
| `katgpt-core` compatibility layer | version 0.4.1, edition 2024, MIT (`katgpt-rs/crates/katgpt-core/Cargo.toml:3-5`) | optional `katgpt-micro-belief` and `katgpt-personality`; always-on `katgpt-types` (`katgpt-rs/crates/katgpt-core/Cargo.toml:47-71`) |

The root `katgpt-rs/LICENSE` is MIT, copyright 2026 Todsaporn Banjerdkit (`katgpt-rs/LICENSE:1-21`). Crate manifests declare MIT, but the crate directories themselves have no separate license file; only the root license was found in this checkout.

The relevant core features are compatibility re-export switches: `micro_belief = ["dep:katgpt-micro-belief"]`, `bom_sampling` enables micro-belief plus its BoM modules, `temporal_deriv` forwards to `katgpt-sense`, and `personality_composition = ["dep:katgpt-personality"]` (`katgpt-rs/crates/katgpt-core/Cargo.toml:410-413`, `katgpt-rs/crates/katgpt-core/Cargo.toml:438`). Core's default feature list includes all three feature names (`katgpt-rs/crates/katgpt-core/Cargo.toml:211`). The root re-exports confirm that the standalone crates are the actual substrate homes (`katgpt-rs/crates/katgpt-core/src/lib.rs:499-509`, `katgpt-rs/crates/katgpt-core/src/lib.rs:547-554`, `katgpt-rs/crates/katgpt-core/src/lib.rs:1667-1678`).

Wisp's Tauri crate is edition 2021 (`src-tauri/Cargo.toml:1-7`), while the audited crates are edition 2024. That is not itself incompatible in a Cargo workspace, but it is another reason to prefer a TypeScript port at the simulation seam rather than coupling Wisp's frontend simulation loop to Rust APIs. Transitive crate licenses were not audited; they must be reviewed before vendoring any Rust source.

## Test and benchmark evidence

### Tests actually run in this audit

No Wisp implementation was changed. To avoid compiling unrelated workspace members, the two small crates were copied to temporary standalone roots under `/tmp` with only their `katgpt-types` path dependency rewritten. Temporal Derivative's katgpt-core test module was likewise copied as an integration test against `katgpt-types`; its assertions are unchanged. One small missing transitive crate (`zerocopy-derive` 0.8.56) was downloaded. No benchmark was run.

| Command (temporary roots under `/tmp`) | Result |
|---|---|
| `cargo test --offline --manifest-path /tmp/wisp-substrate-tests/katgpt-personality/Cargo.toml` | **36 unit tests + 1 doctest passed; 0 failed** |
| `cargo test --offline --manifest-path /tmp/wisp-substrate-tests/katgpt-micro-belief/Cargo.toml` | **54 tests passed; 0 failed** |
| `cargo test --offline --manifest-path /tmp/wisp-temporal-test/Cargo.toml` | **12 Temporal Derivative tests passed; 0 failed** |

A direct `cargo test --offline --locked -p katgpt-personality` from `katgpt-rs/` failed during workspace resolution because unrelated `katgpt-speculative` needed a missing `safetensors` package; that is why the temporary standalone roots were used.

The personality suite covers positive/negative/zero weights, confidence decay, positive/negative drift, clamping, EMA tracking, τ=∞ uniform behavior, stable sigmoid, empty recent directions, mixed layers, and restore round trips (`katgpt-rs/crates/katgpt-personality/src/tests.rs:33-344`). The micro suite includes determinism, boundedness, bridge ranking, latency, snapshot atomicity, and object-safe dispatch (`katgpt-rs/crates/katgpt-micro-belief/src/tests.rs:52-394`). Temporal tests cover zero/constant/step signals, validation, reset, norm, buffer equivalence, bounded monotone gate, defaults, and warm start (`katgpt-rs/crates/katgpt-core/src/temporal_deriv.rs:24-211`).

### Repo-reported benchmark evidence

| Substrate | Repo-reported result | Interpretation for Wisp |
|---|---|---|
| Personality | N=9/D=32 compose 79.585 ns (<1 µs target), batch 851.46 µs/10k, drift 59.387 ns; zero allocation by code audit (`katgpt-rs/.benchmarks/297_personality_composition_goat.md:12-20`, `katgpt-rs/.benchmarks/297_personality_composition_goat.md:24-44`) | Cost is irrelevant at Wisp's likely character counts, but benchmark semantics do not establish a Wisp reward or behavior-quality gain. |
| Personality | G5 was a code audit, not empirical heap profiling; the report explicitly says a future dhat run could confirm it (`katgpt-rs/.benchmarks/297_personality_composition_goat.md:66-79`) | Treat zero-allocation as source-audit evidence only. |
| Micro-belief | Leaky: 1 flip; random attractor: 569; latent thought K=3: 560 on a 1000-step coherence benchmark (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:65-90`) | Prefer leaky for stable, coherent per-character mood/belief state. |
| Micro-belief | Attractor latency 270.47 ns versus 35.73 ns leaky; project bridge 22.34 ns; 1000-NPC leaky serial batch 11.34 µs (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:142-158`) | Again favors leaky, although Wisp is far below 1000 characters. |
| Micro-belief | Report says only trait unification and `LeakyIntegrator` are promotable; attractor and latent thought remain experiments (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:123-132`, `katgpt-rs/.benchmarks/276_micro_belief_goat.md:205-207`) | Do not import Family A/B without a new Wisp-specific validation case. |
| Temporal | Four katgpt fusion gates pass: event recall 1.00/FPR 0.00; δ-Mem write suppression 42.90%/recall +9.6%; collapse false-negative reduction 100%; curiosity recovery 1× at 17.2% of CGSP cost (`katgpt-rs/.benchmarks/277_temporal_deriv_goat.md:18-30`) | Strong evidence that the signal is useful as change detection, not proof of Wisp charm/behavior improvement. |
| Temporal | G5 passes overall despite missing its cost stretch goal; the report labels that limitation explicitly (`katgpt-rs/.benchmarks/277_temporal_deriv_goat.md:149-171`) | Use as cheap arousal/attention signal, not as a general target-seeking curiosity model. |

The personality benchmark report says its original criterion bench source and kernel path were under `riir-ai`, outside this Wisp checkout (`katgpt-rs/.benchmarks/297_personality_composition_goat.md:138-143`). Therefore its benchmark could not be locally rerun from the audited tree. The temporal and micro criterion benches live behind `katgpt-core` feature combinations (`katgpt-rs/crates/katgpt-core/Cargo.toml:610-622`), so running them would compile a broader workspace than necessary and was outside this targeted audit.

## Minimum extraction units

### 1. Temporal Derivative — smallest and first

**Algorithmic minimum:** two `Float32Array`s (`fast`, `slow`), two coefficients, `observe`, `surpriseNorm`, `derivativeSlice`, and `reset`. The Rust source unit is `katgpt-rs/crates/katgpt-types/src/temporal.rs:1-229`; it imports four SIMD helpers (`katgpt-rs/crates/katgpt-types/src/temporal.rs:46-48`). A TypeScript port can replace those with ordinary loops. The compatibility re-export and katgpt-core feature are not needed (`katgpt-rs/crates/katgpt-core/src/temporal_deriv.rs:7-18`).

**Tests to port:** the 12 tests in `katgpt-rs/crates/katgpt-core/src/temporal_deriv.rs:20-211`.

### 2. Micro-belief — leaky core only

**Algorithmic minimum:** `LeakyIntegrator` config, `MicroRecurrentBeliefState`-shaped `step`, and `project_to_scalars`. The actual update is `katgpt-rs/crates/katgpt-types/src/leaky_core.rs:47-80`; the wrapper is `katgpt-rs/crates/katgpt-micro-belief/src/leaky.rs:45-167`; the bridge is `katgpt-rs/crates/katgpt-micro-belief/src/types.rs:149-177` and `katgpt-rs/crates/katgpt-micro-belief/src/bridge.rs:27-57`.

**Do not include initially:** `AttractorKernel`, `LatentThoughtKernel`, BoM, arena, depth-invariance, or snapshot machinery. Snapshot is justified only after Wisp chooses cross-restart persistence; its Rust unit is `katgpt-rs/crates/katgpt-micro-belief/src/snapshot.rs:1-212`.

### 3. Personality — static composition before drift

**Algorithmic minimum without persistence:** `PersonalityConfig`, signed `w`, sigmoid, fixed behavior-direction sources, and `composeInto`. These are concentrated in `katgpt-rs/crates/katgpt-personality/src/types.rs:7-79`, `katgpt-rs/crates/katgpt-personality/src/sigmoid.rs:1-48`, `katgpt-rs/crates/katgpt-personality/src/trait_def.rs:1-89`, and `katgpt-rs/crates/katgpt-personality/src/kernel.rs:108-176`.

**Second stage (only after reward is specified):** add `r_expected`, recent-direction EMAs, and `drift` from `katgpt-rs/crates/katgpt-personality/src/kernel.rs:180-244`. Snapshot/restore is a third stage (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:246-364`, `katgpt-rs/crates/katgpt-personality/src/snapshot.rs:42-234`).

### Rejected/deferred units

- **Reject for initial Wisp adoption:** random `AttractorKernel` and `LatentThoughtKernel`; repo evidence marks both as quality losers relative to leaky (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:88-104`).
- **Defer:** BoM and arena planning, snapshot/hot-swap, depth-invariance diagnostics, and reward-driven personality drift.
- **Reject:** wholesale `katgpt-core`, transformer/model-training stacks, and `katgpt-types` as a runtime dependency when a tiny TypeScript implementation preserves Wisp's current testability and Pixi-free simulation layer.

## Natural Wisp seam mappings

### Per-character state and configuration

Wisp already has a pure `CharacterConfig` carrying behavior tunables and an injectable RNG (`src/character.ts:35-48`), with defaults populated from `src/config.ts` (`src/character.ts:50-61`). The registry constructs this config per materialized character (`src/characterRegistry.ts:254-286`), so per-character archetype weights, belief state, or derivative state belong at that ownership boundary—not inside a Pixi handle.

The registry's `CharEntry` is already per-character and owns bubble/jump roll timers (`src/characterRegistry.ts:171-179`). That is the natural home for cognition state if the registry remains the scheduler. If the state must survive registry-level despawn/re-spawn decisions or drive low-level animation directly, encapsulate it in `Character` instead; either way, keep rendering injected through `CharacterHandle` (`src/character.ts:18-26`).

### Tick loop

`CharacterRegistry.tick(dt)` advances effects and pending spawns, then ticks every character and rolls idle bubbles and jumps (`src/characterRegistry.ts:332-386`). A cognition tick should run immediately before or after `entry.char.tick(dt)` and output only behavior modifiers:

- idle/walk dwell multiplier;
- walk speed/target-choice bias;
- jump-roll probability or interval;
- bubble pool/urgency;
- optional debug scalar for instrumentation.

`Character` already exposes imperative `jump()` and `say(text)` methods suitable for cognition-driven actuation (`src/character.ts:117-137`). The internal idle↔walk state machine chooses random targets and dwell durations (`src/character.ts:177-228`), so personality/belief outputs can multiply or bound those existing choices rather than replace the state machine.

### Config

All current timing and motion knobs are centralized in `src/config.ts:1-7`; jump and bubble roll constants are `src/config.ts:25-54`; asset archetypes are `src/config.ts:81-130`. New substrate coefficients, observation ranges, output clamps, and per-archetype seeds should follow that convention. The current four `AssetEntry` names (`src/config.ts:81-130`) are a natural first archetype taxonomy, but a decision is needed on whether personality is shared per asset type or seeded per individual.

### Gesture sidecar boundary

The sidecar is a lifecycle and NDJSON event bridge: Rust launches Python with unbuffered stdout and reads one JSON object per line (`src-tauri/src/sidecar.rs:50-68`). It currently recognizes only `ready`, `spawn`, and `error`; a spawn event emits an empty Tauri payload (`src-tauri/src/sidecar.rs:68-90`). If gestures become observations for Temporal Derivative/Micro-belief rather than direct spawn commands, the protocol needs event names and bounded payloads (gesture kind, confidence, timestamp/frame) while leaving cognition ownership in TypeScript. `SidecarProcess` itself should remain process lifecycle code, not a belief kernel.

## Risks

1. **Benchmark-to-Wisp transfer is unproven.** All GOAT outcomes are katgpt/riir synthetic cases; none measures whether Wisp characters feel more alive. The temporal report's four consumers are HLA, δ-Mem, collapse, and CGSP curiosity, not a desktop overlay (`katgpt-rs/.benchmarks/277_temporal_deriv_goat.md:18-30`). Wisp needs its own acceptance fixtures/videos.
2. **Micro-belief documentation is stale/mixed.** The README still calls the attractor the “GOAT candidate” (`katgpt-rs/crates/katgpt-micro-belief/README.md:24-29`), while the canonical benchmark report demotes it after G2.1 failure (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:17-34`). Extraction should follow the benchmark report, not the older label.
3. **Default-on does not mean attractor quality.** Core can compile micro-belief transitively through default BoM (`katgpt-rs/crates/katgpt-core/Cargo.toml:410-413`), but the benchmark explicitly keeps attractor/latent-thought experimental (`katgpt-rs/.benchmarks/276_micro_belief_goat.md:123-132`).
4. **No reward signal in Wisp.** Personality drift requires `r_observed` and host-maintained recent direction EMAs (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:180-244`), but Wisp's only current feedback-like behavior is user-initiated spawn/despawn/jump commands; no reward semantics or telemetry are specified.
5. **Time semantics differ.** The Rust kernels are per-call/per-tick and are not dt-aware; Wisp's ticker passes elapsed seconds (`src/characterRegistry.ts:332-358`). Wisp must decide fixed cognition cadence, dt-normalized coefficients, or accumulation.
6. **Numerical fidelity and determinism.** Rust uses f32, deterministic SIMD reduction, and `fastrand`; TypeScript will use f64 `number` and Wisp currently defaults to `Math.random` (`src/character.ts:50-61`). Exact Rust bit-identity cannot be promised without a deliberate deterministic implementation.
7. **Temporal validation is only a debug assertion.** Source documentation says invalid α values “clamps in release,” but the implementation is explicitly a no-op in release and makes the caller responsible (`katgpt-rs/crates/katgpt-types/src/temporal.rs:220-229`). A Wisp port should validate once at construction.
8. **Personality drift's scalar reduction is dimension-sensitive.** It sums recent-direction components rather than projecting against a host-supplied credit direction (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:220-239`). Direction semantics must be designed before drift, or weights can reinforce the wrong layer.
9. **Persistence integrity is not automatic.** Personality composition `to_bytes/from_bytes` is structural only and explicitly lacks cryptographic integrity (`katgpt-rs/crates/katgpt-personality/src/kernel.rs:322-331`). Snapshot hashes protect only their declared contents and do not authenticate the outer file by themselves (`katgpt-rs/crates/katgpt-personality/src/snapshot.rs:175-186`).
10. **Cross-boundary coupling.** Putting these kernels in Rust would force serialization/event calls between Tauri and the Pixi ticker. Wisp's tests currently rely on the pure TS/handle seam (`src/characterRegistry.ts:102-125`); importing Rust crates would weaken that unless the boundary is deliberately redesigned.
11. **Sidecar sparsity and privacy.** The sidecar currently emits only lifecycle/error events and empty spawn payloads (`src-tauri/src/sidecar.rs:68-90`). Gesture-derived cognition needs a bounded event schema, debounce/camera-state semantics, and a local-data policy before it is treated as dense per-frame evidence.

## Unanswered decision questions

1. **Implementation owner:** pure TypeScript substrate (recommended), Rust backend service, or generated shared spec with dual implementations?
2. **Observation vector:** exactly which Wisp signals form the Temporal/Micro-belief input—state, position, time since user event, gesture kind/confidence, bubble activity, or external time?
3. **Cadence:** fixed cognition ticks, every Pixi frame with dt correction, or event-driven updates only?
4. **Output policy:** do substrates directly modify timers/probabilities, or return a typed `BehaviorBias` consumed by `Character`/registry?
5. **Reward:** what user action, if any, counts as positive/negative reward for Personality drift? Is reward global, per character, per archetype, or absent?
6. **Personality granularity:** one weight vector per `AssetEntry` or one seeded vector per spawned individual? How are seeds generated and displayed in debug UI?
7. **Persistence:** should temporal/belief/personality state survive app restarts, and at what commit cadence? Which snapshot/hash format is authoritative?
8. **Gesture contract:** which NDJSON events carry features, and how are confidence, camera availability, duplicate frames, and errors represented?
9. **Determinism/testing:** should sessions be replayable with seeded RNG, and what golden tests or visual acceptance criteria define “individually distinctive”?
10. **Scope gate:** what is the maximum acceptable added per-frame work and bundle complexity for a desktop overlay with likely fewer than 100 characters?

