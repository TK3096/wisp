import { ScenarioDefinition } from "./scenarioHarness";

export const HUMAN_EVALUATION_SCENARIO_IDS = [
  "habituation-gate",
  "boredom-gate",
  "personality-gate",
  "caution-gate",
] as const;

export type HumanEvaluationScenarioId =
  (typeof HUMAN_EVALUATION_SCENARIO_IDS)[number];

const CALM_ROLLS = Array.from({ length: 8 }, () => 0.99);

function gestureStimuli(fromS: number, toS: number, stepS = 0.1) {
  return Array.from(
    { length: Math.floor((toS - fromS) / stepS) + 1 },
    (_, index) => ({
      atS: fromS + index * stepS,
      envelope: {
        target: "all" as const,
        stimulus: {
          kind: "gesture" as const,
          gesture: "openPalm" as const,
          confidence: 0.96,
        },
      },
    }),
  );
}

function appBlurStimuli(count: number, fromS = 0.8, stepS = 0.1) {
  return Array.from({ length: count }, (_, index) => ({
    atS: fromS + index * stepS,
    envelope: {
      target: "all" as const,
      stimulus: {
        kind: "environment" as const,
        change: "appBlur" as const,
      },
    },
  }));
}

/**
 * These scenarios are selected for evaluator-visible A/B deltas while keeping
 * every concrete action owned by the existing scheduler. Their rolls sit close
 * enough to cognition probability boundaries that suppressed bubbles or jumps
 * are perceptible without cognition commanding behavior.
 */
export const HUMAN_EVALUATION_SCENARIO_DEFINITIONS: Record<
  HumanEvaluationScenarioId,
  ScenarioDefinition
> = {
  "habituation-gate": {
    name: "eval-habituation-gate",
    seed: 0x48475431,
    durationS: 70,
    spawnTimes: [0],
    spawnRolls: [0, 0.25, 0.25, 0, 0.5],
    personalitySeeds: [17],
    schedulerRolls: [0.99, 0.99, 0.99, 0.99],
    stimuli: gestureStimuli(1, 10.9),
  },
  "boredom-gate": {
    name: "eval-boredom-gate",
    seed: 0x42475432,
    durationS: 70,
    spawnTimes: [0],
    spawnRolls: [0, 0.25, 0.25, 0, 0.5],
    personalitySeeds: [17],
    schedulerRolls: CALM_ROLLS,
  },
  "personality-gate": {
    name: "eval-personality-gate",
    seed: 0x50475433,
    durationS: 70,
    spawnTimes: [0, 0.1],
    spawnRolls: [0, 0.25, 0.25, 0, 0.75, 0.75],
    personalitySeeds: [101, 7],
    schedulerRolls: Array.from({ length: 16 }, () => 0.99),
  },
  "caution-gate": {
    name: "eval-caution-gate",
    seed: 0x43475434,
    durationS: 70,
    spawnTimes: [0],
    spawnRolls: [0, 0.25, 0.25, 0, 0.5],
    personalitySeeds: [17],
    schedulerRolls: CALM_ROLLS,
    stimuli: appBlurStimuli(50),
  },
};
