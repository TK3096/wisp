import { CognitionHandle, CognitionInit } from "./cognition";

export interface WispCognitionBinding {
  new (init: CognitionInit): CognitionHandle;
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
 * Bind the coarse-grained WASM facade to the injected TypeScript cognition seam.
 * The loader is injectable so unit tests exercise only TypeScript contracts.
 */
export async function bindWasmCognition(
  loadModule: CognitionWasmLoader = loadGeneratedCognition,
): Promise<(init: CognitionInit) => CognitionHandle> {
  const module = await loadModule();
  await module.default?.();
  return (init: CognitionInit) => new module.WispCognition(init);
}
