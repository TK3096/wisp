import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  BASELINE_SCENARIO,
  HABITUATION_SCENARIO,
  NOVEL_STRONG_GESTURE_SCENARIO,
  runScenario,
  scenarioBehaviorDecisions,
  scenarioCognitionSteps,
} from "../src/scenarioHarness";
import { BehaviorSignal, CognitionInit, CognitionHandle } from "../src/cognition";

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

interface LiveReplay {
  results: ReturnType<typeof runScenario>[];
  steps: ReturnType<typeof scenarioCognitionSteps>[];
  decisions: ReturnType<typeof scenarioBehaviorDecisions>[];
  stableEvents: Record<string, unknown>[][];
}

function replayAtAllFrameRates(
  scenario: Parameters<typeof runScenario>[0],
  createCognitionHandle: (init: CognitionInit) => CognitionHandle,
): LiveReplay {
  const results = [30, 60, 120].map((framesPerSecond) =>
    runScenario(scenario, framesPerSecond, { createCognitionHandle }),
  );
  return {
    results,
    steps: results.map(scenarioCognitionSteps),
    decisions: results.map(scenarioBehaviorDecisions),
    stableEvents: results.map((result) =>
      result.trace
        .filter((record) =>
          ["stimulus_dispatch", "stimulus_observed", "scheduler_roll"].includes(
            record.type,
          ),
        )
        .map((record) => ({
          type: record.type,
          characterId: record.characterId,
          envelope: record.envelope,
          rollIndex: record.rollIndex,
          value: record.value,
        })),
    ),
  };
}

function expectEquivalentFrameRateReplays(replay: LiveReplay): void {
  expect(replay.steps[1]).toEqual(replay.steps[0]);
  expect(replay.steps[2]).toEqual(replay.steps[0]);
  expect(replay.decisions[1]).toEqual(replay.decisions[0]);
  expect(replay.decisions[2]).toEqual(replay.decisions[0]);
  expect(replay.stableEvents[1]).toEqual(replay.stableEvents[0]);
  expect(replay.stableEvents[2]).toEqual(replay.stableEvents[0]);
}

it("passes the Novel Strong Gesture acceptance through the live cognition core", async () => {
  const wasm = await loadGeneratedCognition();
  const createCognitionHandle = (init: CognitionInit): CognitionHandle =>
    new wasm.WispCognition(init);
  const replay = replayAtAllFrameRates(
    NOVEL_STRONG_GESTURE_SCENARIO,
    createCognitionHandle,
  );
  const result = replay.results[1];
  const steps = replay.steps[1];
  const beforeGesture = steps.find(
    (step) => step.elapsedCognitionS < 20,
  ) as (typeof steps)[number];
  const rollStep = steps.find((step) => step.elapsedCognitionS >= 20);
  const temporal = rollStep?.temporalSurprise as {
    centeredEnergy: number;
    gate: number;
  };
  const rollSignal = rollStep?.behaviorSignal as BehaviorSignal;
  const beforeSignal = beforeGesture.behaviorSignal as BehaviorSignal;
  const schedulerRollIndex = result.trace.findIndex(
    (record) => record.type === "scheduler_roll",
  );
  const jumpStartedIndex = result.trace.findIndex(
    (record) => record.type === "jump_started",
  );
  const gestureDispatch = result.trace.find(
    (record) => record.type === "stimulus_dispatch",
  );

  expect(temporal.centeredEnergy).toBeGreaterThan(0.3);
  expect(temporal.gate).toBeGreaterThan(0.5);
  expect(rollSignal.affect.surprise).toBeGreaterThan(0.3);
  expect(rollSignal.affect.valence).toBeGreaterThanOrEqual(-1);
  expect(rollSignal.affect.valence).toBeLessThanOrEqual(1);
  expect(rollSignal.affect.arousal).toBeGreaterThan(0);
  expect(rollSignal.behaviorBias.jumpChance).toBeGreaterThan(
    beforeSignal.behaviorBias.jumpChance,
  );
  expect(rollSignal.behaviorBias.jumpChance).toBeGreaterThanOrEqual(1);
  expect(rollSignal.behaviorBias.idleDwell).toBeGreaterThanOrEqual(0.5);
  expect(rollSignal.behaviorBias.idleDwell).toBeLessThanOrEqual(1.5);
  expect(rollSignal.behaviorBias.walkSpeed).toBeLessThanOrEqual(1.75);
  expect(rollSignal.behaviorBias.jumpChance).toBeLessThanOrEqual(1.8);
  expect(rollSignal.behaviorBias.bubbleChance).toBeLessThanOrEqual(1.8);
  expect(rollSignal.behaviorBias.animationPace).toBeLessThanOrEqual(1.25);
  expect(result.trace[schedulerRollIndex]).toMatchObject({ value: 0.99 });
  expect(
    (result.trace[schedulerRollIndex]?.clockS ?? Infinity) >
      (gestureDispatch?.clockS ?? -Infinity),
  ).toBe(true);
  expect(jumpStartedIndex).toBeGreaterThan(schedulerRollIndex);
  expectEquivalentFrameRateReplays(replay);
});

it("passes the Habituation acceptance through the live cognition core", async () => {
  const wasm = await loadGeneratedCognition();
  const createCognitionHandle = (init: CognitionInit): CognitionHandle =>
    new wasm.WispCognition(init);
  const replay = replayAtAllFrameRates(
    HABITUATION_SCENARIO,
    createCognitionHandle,
  );
  const result = replay.results[1];
  const steps = replay.steps[1];
  const surprises = steps.map(
    (step) => (step.behaviorSignal as BehaviorSignal).affect.surprise,
  );
  const rollStep = steps.find((step) => step.elapsedCognitionS >= 20);
  const gestureObservations = result.trace.filter(
    (record) =>
      record.type === "stimulus_observed" &&
      (record.envelope as { stimulus: { kind: string } }).stimulus.kind ===
        "gesture",
  );
  const schedulerRolls = result.trace.filter(
    (record) => record.type === "scheduler_roll",
  );

  expect(gestureObservations).toHaveLength(99);
  expect(Math.max(...surprises)).toBeGreaterThan(0.3);
  expect(surprises[surprises.length - 1]).toBeLessThan(0.05);
  expect(schedulerRolls.map((record) => record.value)).toEqual([0.99, 0.95]);
  expect(rollStep?.behaviorSignal.behaviorBias.jumpChance).toBeLessThan(0.95);
  expect(
    replay.decisions.every(
      (runDecisions) =>
        !runDecisions.some((decision) => decision.type === "jump_started"),
    ),
  ).toBe(true);
  expectEquivalentFrameRateReplays(replay);
});

it("makes the live novel gesture visibly stronger than its habituated repetition", async () => {
  const wasm = await loadGeneratedCognition();
  const createCognitionHandle = (init: CognitionInit): CognitionHandle =>
    new wasm.WispCognition(init);
  const novel = runScenario(NOVEL_STRONG_GESTURE_SCENARIO, 60, {
    createCognitionHandle,
  });
  const habituated = runScenario(HABITUATION_SCENARIO, 60, {
    createCognitionHandle,
  });

  expect(
    scenarioBehaviorDecisions(novel).some(
      (decision) => decision.type === "jump_started",
    ),
  ).toBe(true);
  expect(
    scenarioBehaviorDecisions(habituated).some(
      (decision) => decision.type === "jump_started",
    ),
  ).toBe(false);
});
