import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { bindWasmCognition, CognitionWasmModule } from "../src/cognitionFacade";
import { CognitionHandle, CognitionInit } from "../src/cognition";
import {
  humanEvaluationScenarios,
  type HumanEvaluationArm,
} from "../src/humanEvaluation";
import {
  HUMAN_EVALUATION_SCENARIO_DEFINITIONS,
  type HumanEvaluationScenarioId,
} from "../src/humanEvaluationScenarios";
import { ScenarioResult, runScenario } from "../src/scenarioHarness";

interface VisibleEvent {
  atS: number;
  type: string;
  actorId?: string;
  animation?: unknown;
  text?: string;
}

async function createLiveCognition(): Promise<
  (init: CognitionInit) => CognitionHandle
> {
  const moduleUrl = new URL(
    "../public/cognition/wisp_cognition_wasm.js",
    import.meta.url,
  );
  const wasmUrl = new URL(
    "../public/cognition/wisp_cognition_wasm_bg.wasm",
    import.meta.url,
  );
  const rawModule = (await import(moduleUrl.href)) as unknown as {
    WispCognition: new (init: CognitionInit) => unknown;
    initSync: (module: WebAssembly.Module) => void;
  };
  rawModule.initSync(
    new WebAssembly.Module(readFileSync(fileURLToPath(wasmUrl))),
  );
  return bindWasmCognition(
    async () => rawModule as unknown as CognitionWasmModule,
  );
}

let createCognition: (init: CognitionInit) => CognitionHandle;

function visibleEvents(
  scenarioId: HumanEvaluationScenarioId,
  arm: HumanEvaluationArm,
): VisibleEvent[] {
  const result: ScenarioResult = runScenario(
    HUMAN_EVALUATION_SCENARIO_DEFINITIONS[scenarioId],
    30,
    arm === "cognition" ? { createCognitionHandle: createCognition } : {},
  );
  return result.trace
    .filter((record) =>
      [
        "character_materialized",
        "animation_changed",
        "jump_started",
        "bubble_started",
      ].includes(record.type),
    )
    .map((record) => ({
      atS: record.clockS,
      type: record.type,
      actorId: record.characterId,
      animation: record.to,
      text: record.text,
    }));
}

it("uses only evaluator-visible baseline/cognition deltas", async () => {
  createCognition = await createLiveCognition();

  for (const scenario of humanEvaluationScenarios()) {
    const baseline = visibleEvents(scenario.id, "baseline");
    const cognition = visibleEvents(scenario.id, "cognition");
    const count = (events: VisibleEvent[]) =>
      events.filter((event) => event.type === scenario.visibleDelta.event)
        .length;

    expect(baseline).not.toEqual(cognition);
    expect(count(baseline)).toBe(scenario.visibleDelta.baselineCount);
    expect(count(cognition)).toBe(scenario.visibleDelta.cognitionCount);
  }
}, 30_000);
