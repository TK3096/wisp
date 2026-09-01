import {
  Affect,
  BehaviorSignal,
  CognitionHandle,
  CognitionInit,
  PersonalityDimensions,
  PersistentCognitionState,
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

const generatedCognitionUrl: string = "/cognition/wisp_cognition_wasm.js";
const loadGeneratedCognition: CognitionWasmLoader = () =>
  import(generatedCognitionUrl) as Promise<CognitionWasmModule>;

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
      tick: (dt) => binding.tick(dt) as BehaviorSignal,
      noteExpression: () => binding.note_expression(),
      snapshot: () => binding.snapshot(),
      restore: (state) => binding.restore(state),
    };
  };
}
