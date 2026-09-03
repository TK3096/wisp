import {
  Affect,
  BehaviorSignal,
  CognitionHandle,
  CognitionInit,
  PersonalityDimensions,
  PersistentCognitionState,
  SocialProjection,
  Stimulus,
} from "./cognition";

/**
 * The generated wasm-bindgen API deliberately keeps Rust method naming. The
 * adapter below is the only place allowed to translate that shape into the
 * Cognition Handle contract consumed by the pure simulation layer.
 */
export interface WispCognitionBinding {
  new (init: CognitionInit): {
    observe(stimulus: Stimulus): void;
    tone_seed(): { personality: PersonalityDimensions; affect: Affect };
    social_projection(): Float64Array | SocialProjection;
    apply_social_influence(influence: number): void;
    tick(dt: number): unknown;
    note_expression(): void;
    snapshot(): PersistentCognitionState;
    restore(state: PersistentCognitionState): void;
  };
}

export interface CognitionWasmModule {
  WispCognition: WispCognitionBinding;
  default?: () => Promise<unknown>;
}

export type CognitionWasmLoader = () => Promise<CognitionWasmModule>;

const loadGeneratedCognition: CognitionWasmLoader = () =>
  import("./cognitionWasm/wisp_cognition_wasm.js") as Promise<CognitionWasmModule>;

/**
 * Bind the coarse-grained WASM facade to the injected Cognition Handle seam.
 * The loader is injectable so unit tests exercise only TypeScript contracts.
 */
export async function bindWasmCognition(
  loadModule: CognitionWasmLoader = loadGeneratedCognition,
): Promise<(init: CognitionInit) => CognitionHandle> {
  const module = await loadModule();
  await module.default?.();
  return (init: CognitionInit) => {
    const binding = new module.WispCognition(init);
    return {
      observe: (stimulus) => binding.observe(stimulus),
      toneSeed: () => binding.tone_seed(),
      socialProjection: () =>
        Array.from(binding.social_projection()) as SocialProjection,
      applySocialInfluence: (influence) =>
        binding.apply_social_influence(influence.value),
      tick: (dt) => binding.tick(dt) as BehaviorSignal,
      noteExpression: () => binding.note_expression(),
      snapshot: () => binding.snapshot(),
      restore: (state) => binding.restore(state),
    };
  };
}
