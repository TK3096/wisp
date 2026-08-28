import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  BASELINE_SCENARIO,
  CAUTION_STARTLE_ARC_SCENARIO,
  HABITUATION_SCENARIO,
  NOVEL_STRONG_GESTURE_SCENARIO,
  NEUTRAL_BASELINE_SCENARIO,
  PERSONALITY_CONTRAST_SCENARIO,
  QUIET_BOREDOM_SCENARIO,
  REACTION_STORM_SCENARIO,
  runScenario,
  scenarioBehaviorDecisions,
  scenarioCognitionSteps,
} from "../src/scenarioHarness";
import {
  BehaviorSignal,
  CognitionInit,
  CognitionHandle,
} from "../src/cognition";

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
  const createCognitionHandle = await createLiveCognition();
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

async function createLiveCognition(): Promise<
  (init: CognitionInit) => CognitionHandle
> {
  const wasm = await loadGeneratedCognition();
  return (init: CognitionInit) => new wasm.WispCognition(init);
}

it("passes the Novel Strong Gesture acceptance through the live cognition core", async () => {
  const createCognitionHandle = await createLiveCognition();
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
  const createCognitionHandle = await createLiveCognition();
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
  const createCognitionHandle = await createLiveCognition();
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

it("passes the Neutral Baseline Micro-belief acceptance through live cognition", async () => {
  const createCognitionHandle = await createLiveCognition();
  const replay = replayAtAllFrameRates(
    NEUTRAL_BASELINE_SCENARIO,
    createCognitionHandle,
  );
  const steps = replay.steps[1];
  const decisions = replay.decisions[1];

  for (const step of steps) {
    const signal = step.behaviorSignal as BehaviorSignal;
    expect(signal.reaction.kind).toBe("none");
    expect(signal.microBelief).toEqual({
      novelty: 0,
      familiarity: 0,
      socialPositivity: 0,
      caution: 0,
    });
    expect(signal.reaction.candidates).toHaveLength(4);
  }
  expect(
    decisions.some((decision) => decision.type === "jump_started"),
  ).toBe(false);
  expect(
    decisions.filter((decision) => decision.type === "bubble_started"),
  ).toHaveLength(1);
  expectEquivalentFrameRateReplays(replay);
});

it("passes the Caution/Startle Arc acceptance through live cognition", async () => {
  const createCognitionHandle = await createLiveCognition();
  const replay = replayAtAllFrameRates(
    CAUTION_STARTLE_ARC_SCENARIO,
    createCognitionHandle,
  );
  const steps = replay.steps[1];
  const firstBlur = steps.find((step) => step.elapsedCognitionS === 0.8);
  const startled = steps.find(
    (step) => (step.behaviorSignal as BehaviorSignal).reaction.kind === "startle",
  );
  const startleSignal = startled?.behaviorSignal as BehaviorSignal;
  const firstSignal = firstBlur?.behaviorSignal as BehaviorSignal;

  expect(firstSignal.reaction.kind).toBe("curiosity");
  expect(startleSignal.reaction.kind).toBe("startle");
  expect(startleSignal.microBelief.caution).toBeGreaterThan(
    startleSignal.microBelief.novelty,
  );
  expect(startleSignal.reaction.remainingS).toBeLessThanOrEqual(0.8);
  expectEquivalentFrameRateReplays(replay);
});

it("passes the Quiet Boredom acceptance through live cognition", async () => {
  const createCognitionHandle = await createLiveCognition();
  const replay = replayAtAllFrameRates(
    QUIET_BOREDOM_SCENARIO,
    createCognitionHandle,
  );
  const steps = replay.steps[1];
  const bored = steps.find(
    (step) => (step.behaviorSignal as BehaviorSignal).reaction.kind === "boredom",
  );

  expect(bored).toBeDefined();
  expect(bored?.elapsedCognitionS).toBeGreaterThan(8);
  expect(bored?.elapsedCognitionS).toBeLessThanOrEqual(12);
  expect((bored?.behaviorSignal as BehaviorSignal).reaction.remainingS).toBe(
    4,
  );
  expectEquivalentFrameRateReplays(replay);
});

it("passes the Personality Contrast acceptance through live cognition", async () => {
  const createCognitionHandle = await createLiveCognition();
  const replay = replayAtAllFrameRates(
    PERSONALITY_CONTRAST_SCENARIO,
    createCognitionHandle,
  );
  const result = replay.results[1];
  const gestureStep = replay.steps[1].filter(
    (step) =>
      ((step.behaviorSignal as BehaviorSignal).temporalSurprise.centeredEnergy ?? 0) >
      0.3,
  );
  const first = gestureStep[0]?.behaviorSignal as BehaviorSignal;
  const second = gestureStep[1]?.behaviorSignal as BehaviorSignal;
  const walkCounts = replay.decisions[1].reduce<Record<string, number>>(
    (counts, decision) => {
      if (decision.type === "animation_changed" && decision.to === "walk") {
        counts[decision.characterId] = (counts[decision.characterId] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );

  expect(
    result.trace.filter(
      (record) =>
        record.type === "stimulus_observed" &&
        (record.envelope as { stimulus: { kind: string } }).stimulus.kind ===
          "gesture",
    ),
  ).toHaveLength(2);
  expect(first.reaction.kind).toBe("curiosity");
  expect(second.reaction.kind).toBe("curiosity");
  expect(first.behaviorBias.jumpChance).not.toBe(second.behaviorBias.jumpChance);
  expect(new Set(Object.keys(walkCounts))).toEqual(
    new Set(["personality-contrast-character-1", "personality-contrast-character-2"]),
  );
  expectEquivalentFrameRateReplays(replay);
});

it("passes the Reaction Storm acceptance without yielding scheduler ownership", async () => {
  const createCognitionHandle = await createLiveCognition();
  const replay = replayAtAllFrameRates(
    REACTION_STORM_SCENARIO,
    createCognitionHandle,
  );
  const result = replay.results[1];
  const steps = replay.steps[1];
  const observations = result.trace.filter(
    (record) =>
      record.type === "stimulus_observed" &&
      (record.envelope as { stimulus: { kind: string } }).stimulus.kind ===
        "gesture",
  );
  const starts: number[] = [];
  let previous: Reaction = "none";
  for (const step of steps) {
    const kind = (step.behaviorSignal as BehaviorSignal).reaction.kind;
    if (previous === "none" && kind !== "none") starts.push(step.elapsedCognitionS);
    previous = kind;
  }

  expect(observations).toHaveLength(608);
  expect(starts.length).toBeGreaterThan(1);
  const orderedStarts = [...starts].sort((a, b) => a - b);
  for (let index = 1; index < orderedStarts.length; index++) {
    expect(orderedStarts[index] - orderedStarts[index - 1]).toBeGreaterThanOrEqual(0.6);
  }
  for (const decision of replay.decisions[1]) {
    if (decision.type === "jump_started") {
      const jumpIndex = result.trace.findIndex(
        (record) =>
          record.type === "jump_started" && record.characterId === decision.characterId,
      );
      const priorRoll = result.trace
        .slice(0, jumpIndex)
        .reverse()
        .find((record) => record.type === "scheduler_roll");
      expect(priorRoll).toBeDefined();
    }
  }
  // Dense events can interleave differently inside a render frame. Cognition
  // cadence, decisions, and the scheduler sequence—not frame-local event
  // ordering—are the deterministic contract.
  expect(replay.steps[1]).toEqual(replay.steps[0]);
  expect(replay.steps[2]).toEqual(replay.steps[0]);
  expect(replay.decisions[1]).toEqual(replay.decisions[0]);
  expect(replay.decisions[2]).toEqual(replay.decisions[0]);
  expect(
    replay.results.map((result) =>
      result.trace
        .filter((record) => record.type === "scheduler_roll")
        .map((record) => record.value),
    ),
  ).toEqual([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
});
