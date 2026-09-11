# Small-scope speech-generation candidates in katgpt-rs

**Research ticket:** [Audit small-scope speech generation candidates in katgpt-rs · #63](https://github.com/TK3096/wisp/issues/63)  
**Resolution:** [#issuecomment-5578702886](https://github.com/TK3096/wisp/issues/63#issuecomment-5578702886)  
**Audit date:** 2026-09-08  
**Primary material:** the ignored local `katgpt-rs/` tree in this checkout. No performance number was re-benchmarked for this audit. `katgpt-rs` is design provenance only: Wisp must not import, vendor, depend on, or copy it wholesale.

## Executive answer

**Recommendation: use a personality-conditioned phrase grammar as the primary route.** Keep the generator in Wisp's renderer-free simulation layer, feed it bounded Personality, affect, reaction, and Micro-belief projections, and preserve the existing scheduler RNG, cooldown, trace, and fallback seams. The grammar should be authored, small, and deterministic. This extends the accepted tone-weighted line surface in `src/speech.ts` rather than replacing the behavior-owner boundary.

**Fallback: use a fixed top-K phrase-token Markov table only if grammar diversity is insufficient.** Train it offline exclusively from Wisp-owned short lines, store versioned integer probabilities, constrain transitions by tone and safety, and fall back to the grammar or fixed lines on invalid output. Do not use BPE or a transformer for the first implementation.

## Wisp baseline

The existing architecture already provides the important seams:

- `src/cognition.ts` defines bounded `BehaviorSignal`, `PersonalityDimensions`, `Affect`, `MicroBeliefProjection`, reactions, and the `CognitionHandle` boundary.
- `src/speech.ts` already performs deterministic, personality- and affect-weighted tone selection over tagged fixed lines.
- `src/characterRegistry.ts` owns bubble timing, global and per-character scheduling, expression reward, and Character behavior.
- `src/config.ts` owns bubble dimensions, duration, typing speed, cooldowns, and the accepted fixed-line pools.
- `src/scenarioHarness.ts` records deterministic `bubble_started` and `bubble_ended` traces and compares cognition decisions without depending on frame-local timing.

A speech generator should be another pure simulation input to these seams. It must not command Character behavior or duplicate Cognition state.

## Candidate audit

| Candidate | Local reference | Adaptation for Wisp | State, corpus, and training | Runtime and determinism | Fit |
| --- | --- | --- | --- | --- | --- |
| Phrase/template/grammar generation | `katgpt-rs/crates/katgpt-pruners/src/g_zero/template_proposer.rs` | Author small slot grammars with tone and context tags. Select units through bounded personality/affect weights. Omit katgpt's query-bandit machinery initially. | A few kilobytes of authored grammar; no corpus and no training. | Microsecond-scale expansion. Deterministic with the existing scheduler roll. | **Best fit.** Legal short output by construction; the main risks are repetition and awkward authored combinations. |
| Personality-weighted composition | `katgpt-rs/crates/katgpt-personality/src/kernel.rs`, `src/types.rs` | Reuse the idea of bounded sigmoid gates, confidence, clamped drift, and snapshot restoration. Feed Wisp's existing bounded projections rather than importing latent-layer machinery. | A few scalar weights and optional reward EMAs per character. | Negligible. Deterministic when reward application and rolls are virtual-clock ordered. | Strong conditioner for the primary route. Defer persistent drift until feedback semantics are explicitly accepted. |
| Tiny Markov / bigram generation | `katgpt-rs/crates/katgpt-speculative/src/bigram_markov.rs` | Use phrase tokens, not characters or byte tokens. Store fixed top-K successors and mask or reweight rows by tone/state. | Likely a few kilobytes for 32–128 phrase tokens and top 3–4 successors. Requires an offline build from Wisp-owned lines. | O(out-degree) per step; deterministic after the table is frozen and versioned. | Usable fallback, but prone to nonsense and loops. Requires validators and conservative fallback. |
| Token-level constrained sampling | `katgpt-rs/crates/katgpt-types/src/math.rs`, `katgpt-rs/crates/katgpt-core/src/speculative/sampling.rs`, `katgpt-rs/crates/katgpt-pruners/src/spec_compile/dfa.rs`, `katgpt-rs/crates/katgpt-core/src/traits/mod.rs` | If the Markov fallback is accepted, mask candidates through a tiny phrase DFA and sample by inverse CDF. | A small bitmap/DFA is likely below 10 KB for a phrase vocabulary. No corpus unless probabilities are derived from lines. | Cheap, but dead ends need bounded retry or fallback. Deterministic with seeded rolls and fixed quantized weights. | Safety machinery for a constrained fallback, not the primary speech generator. |
| Tiny learned transformer | `katgpt-rs/crates/katgpt-types/src/config.rs` (`micro`, `draft`, `bpe_draft`), `katgpt-rs/crates/katgpt-transformer/src/weights.rs` | Treat only as evidence that very small model shapes exist. | Even `draft` is a trained model; realistic vocabularies increase the artifact. Requires corpus, offline training, packaging, and versioning. | Inference can be small, but model loading and numerical replay add avoidable complexity. | **Not now.** The quality/complexity tradeoff is worse than authored grammar for short bubbles. |
| BPE tokenizer | `katgpt-rs/crates/katgpt-tokenizer/src/bpe.rs`, `src/types.rs` | Do not adapt for current bubbles. Define a small deterministic phrase/symbol vocabulary instead. | BPE requires trained vocabulary and merges; realistic presets use a 4,096-token vocabulary. | Encoding is cheap, but merge provenance, unseen words, and constraint boundaries add complexity. | Poor fit. Revisit only for free-form text or an explicitly accepted learned fallback. |
| Compression/corpus drafting | `katgpt-rs/.plans/285_compression_drafter_quest_grammar.md`, `katgpt-rs/.benchmarks/285_compression_drafter_goat.md` | Treat as a negative result. | Corpus is the asset; compression/index state adds footprint. The reference path also relies on an external compressor. | Repo-reported beam search was about 313 microseconds versus about 290 nanoseconds for template selection, while diversity still failed its gate. | Poor fit for frequent, very short overlay speech. |
| Validators/pruners | `katgpt-rs/crates/katgpt-validator/README.md`, `src/partial_parser.rs`, `src/syn_pruner.rs` | Adapt the cheap-then-accurate tiering, not Rust syntax parsing. Tier 0 checks length, non-empty output, allowed Unicode, slots, and tone. Tier 1 checks banned patterns, repetition, duration/width, and fallback eligibility. | Bounded recent-output history plus declarative rules. | Trivial for grammar output. The learned fallback needs bounded reject/retry. | Required acceptance gate for any generator. |

## Primary direction

Implement a pure TypeScript speech module or `SpeechHandle` around authored slot grammars:

1. Define grammar units with tone, optional context/reaction tags, slot types, and hard length/width budgets.
2. Expand units using deterministic rolls and bounded Personality/affect/Micro-belief weights.
3. Keep `Character` and `CharacterRegistry` as behavior owners; Cognition and speech only bias expression.
4. Pass completed text through the existing bubble duration, width, cooldown, and renderer handle seams.
5. Trace generated text through Scenario Harness with stable canonical records.
6. On invalid, over-budget, or repeated output, deterministically fall back to accepted fixed lines.

### Risks and controls

- **Authoring cost and malformed combinations:** use exhaustive slot-coverage tests and grammar invariants.
- **Tone/state mismatch:** test each Personality/affect projection against expected tone families.
- **Repetition:** add bounded recent-output suppression at the character and population levels as appropriate.
- **Localization and emoji:** validate code-point-safe truncation, rendering width assumptions, and language-specific pools.
- **Replay drift:** keep all random draws, state mutations, and validator decisions on the virtual clock; do not sample from wall time.

Target an authored grammar of roughly 5–30 KB, with no runtime training, no learned artifact, and negligible CPU per bubble. The exact budget remains a human acceptance decision.

## Fallback direction

If authored grammar diversity fails acceptance, build a fixed phrase-token Markov fallback:

1. Create a 32–128 token phrase vocabulary from Wisp-owned speech.
2. Train offline from those lines only; do not download or import a corpus.
3. Serialize fixed top-K successors with integer or quantized probabilities and a schema/version hash.
4. Constrain transitions by tone, context, banned patterns, length, and stop eligibility.
5. Fall back to the primary grammar after one invalid or dead-end result.

This remains a tiny learned artifact, so it needs explicit human acceptance of footprint, provenance, training path, and quality risk.

## Rejected for now

- **BPE:** bubble speech has a small, controllable vocabulary. A learned tokenizer adds state and provenance without solving a current problem.
- **Tiny transformers:** even small learned models require training and packaging, while their best plausible output remains short persona-conditioned phrases.
- **Compression drafting:** the katgpt-rs negative result showed poor diversity and much higher runtime than template selection for already compact text.

## Open human decisions

1. Acceptance thresholds: unique-output target, repetition window, maximum grammar size, p95 generation cost, and maximum fallback rate.
2. Languages, emoji/punctuation policy, moderation rules, and whether greetings/idle are the only initial contexts.
3. Whether the tiny offline fallback is acceptable, including its corpus provenance, artifact format, and compatibility policy.
4. Whether expression feedback should only condition selection or also persist clamped per-character voice drift; if persistent, define reward semantics and schema.
5. Integration boundary and packaging: pure TypeScript is preferable, but the destination module and production/debug/fallback split need confirmation.
6. Scenario Harness contract: whether generated text is canonical trace data, derived data, or split into selection and expansion records.
