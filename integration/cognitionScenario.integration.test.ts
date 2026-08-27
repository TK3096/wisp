import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BASELINE_SCENARIO, runScenario, scenarioBehaviorDecisions } from "../src/scenarioHarness";
import { CognitionInit, CognitionHandle } from "../src/cognition";

type CognitionWasmModule = {
  WispCognition: new (init: CognitionInit) => CognitionHandle;
  initSync: (module: WebAssembly.Module) => void;
};

async function loadGeneratedCognition(): Promise<CognitionWasmModule> {
  const moduleUrl = new URL("../public/cognition/wisp_cognition_wasm.js", import.meta.url);
  const wasmUrl = new URL("../public/cognition/wisp_cognition_wasm_bg.wasm", import.meta.url);
  const cognitionModule = (await import(moduleUrl.href)) as unknown as CognitionWasmModule;
  const bytes = readFileSync(fileURLToPath(wasmUrl));
  cognitionModule.initSync(new WebAssembly.Module(bytes));
  return cognitionModule;
}

it("turns contrasting real Personality Seeds into different headless behavior decisions", async () => {
  const wasm = await loadGeneratedCognition();
  const createCognitionHandle = (init: CognitionInit): CognitionHandle =>
    new wasm.WispCognition(init);
  const scenarioWithSeed = (personalitySeed: number) => ({
    ...BASELINE_SCENARIO,
    name: `live-personality-${personalitySeed}`,
    personalitySeeds: [personalitySeed],
    schedulerRolls: [0.1, 0.905, 0.1, 0.905],
  });

  const cautious = runScenario(scenarioWithSeed(42997), 60, {
    createCognitionHandle,
  });
  const bold = runScenario(scenarioWithSeed(86206), 60, {
    createCognitionHandle,
  });

  expect(
    scenarioBehaviorDecisions(cautious).some((decision) => decision.type === "jump_started"),
  ).toBe(false);
  expect(
    scenarioBehaviorDecisions(bold).some((decision) => decision.type === "jump_started"),
  ).toBe(true);
});
