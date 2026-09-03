import {
  BehaviorSignal,
  CognitionHandle,
  CognitionInit,
  NEUTRAL_SOCIAL_PROJECTION,
} from "./cognition";
import { BUBBLE } from "./config";
import type { PopulationPassSummary } from "./socialAttention";
import {
  PHASE2_SOCIAL_SOAK_SCENARIO,
  ScenarioDefinition,
  ScenarioTraceRecord,
  formatScenarioTraceNdjson,
  runScenario,
  scenarioCognitionSteps,
} from "./scenarioHarness";

export const PHASE2_SET_ATTENTION_SCHEMA_VERSION = 1;

/** Issue #60 deterministic gates. Human blind evaluation is intentionally separate. */
export const PHASE2_SET_ATTENTION_THRESHOLDS = {
  populationPassP95Ms: 0.2,
  /**
   * A hard maximum must tolerate a host GC pause hitting inside one pass;
   * it remains far below the accepted 33.33 ms frame budget.
   */
  populationPassMaxMs: 5,
  projectionSpreadFractionOfBaseline: 0.8,
  behaviorDistanceFractionOfBaseline: 0.8,
  firstInfluenceByS: 5,
} as const;

type PopulationPassRecord = ScenarioTraceRecord & {
  summary?: PopulationPassSummary;
};

export interface SetAttentionGateEvidence {
  name: string;
  status: "pass" | "marginal" | "failed";
  details: string;
}

export interface SetAttentionAcceptanceReport {
  schemaVersion: number;
  generatedAt: string;
  status: "pass" | "blocked";
  scenario: { name: string; durationS: number; characters: number };
  thresholds: typeof PHASE2_SET_ATTENTION_THRESHOLDS;
  gates: SetAttentionGateEvidence[];
  humanEvaluation: {
    completed: boolean;
    perceivedPeerAwarenessStronger: boolean;
    individualityNotReduced: boolean;
    calmNotReduced: boolean;
    evidenceUrl?: string;
  };
  blockers: string[];
}

export interface SetAttentionAcceptanceInput {
  createCognitionHandle: (init: CognitionInit) => CognitionHandle;
  generatedAt?: string;
  humanEvaluation?: SetAttentionAcceptanceReport["humanEvaluation"];
  soakScenario?: ScenarioDefinition;
}

function projectionSpread(
  projections: Map<string, number[]>,
): number {
  const values = [...projections.values()];
  if (values.length < 2) return 0;
  let total = 0;
  for (let dimension = 0; dimension < 8; dimension++) {
    const column = values.map((projection) => projection[dimension]);
    const mean = column.reduce((sum, value) => sum + value, 0) / column.length;
    total += Math.sqrt(
      column.reduce((sum, value) => sum + (value - mean) ** 2, 0) / column.length,
    );
  }
  return total / 8;
}

function withProjectionRecorder(
  factory: SetAttentionAcceptanceInput["createCognitionHandle"],
  projections: Map<string, number[]>,
) {
  return (init: CognitionInit): CognitionHandle => {
    const inner = factory(init);
    return {
      observe: (stimulus) => inner.observe(stimulus),
      toneSeed: () => inner.toneSeed(),
      socialProjection: () => {
        const projection = inner.socialProjection?.() ?? NEUTRAL_SOCIAL_PROJECTION;
        projections.set(init.characterId, [...projection]);
        return projection;
      },
      applySocialInfluence: (influence) => inner.applySocialInfluence?.(influence),
      tick: (dt) => inner.tick(dt),
      noteExpression: () => inner.noteExpression(),
      snapshot: () => inner.snapshot(),
      restore: (state) => inner.restore(state),
    };
  };
}

function validateCognitionValues(trace: ScenarioTraceRecord[]): string[] {
  const failures: string[] = [];
  for (const record of trace.filter((item) => item.type === "cognition_step")) {
    const stack: unknown[] = [record];
    while (stack.length) {
      const value = stack.pop();
      if (typeof value === "number" && !Number.isFinite(value)) {
        failures.push(`non-finite number at ${record.clockS}s`);
        break;
      }
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === "object") stack.push(...Object.values(value));
    }
  }
  return failures;
}

function validateBehaviorSignalBounds(trace: ScenarioTraceRecord[]): string[] {
  const failures: string[] = [];
  const inRange = (value: number, min: number, max: number) =>
    value >= min && value <= max;
  for (const record of trace.filter((item) => item.type === "cognition_step")) {
    const step = {
      clockS: record.clockS,
      behaviorSignal: record.behaviorSignal,
    };
    const signal = step.behaviorSignal as BehaviorSignal;
    const checks: [string, number, number, number][] = [
      ["personality.energy", signal.personality.energy, 0, 1],
      ["personality.curiosity", signal.personality.curiosity, 0, 1],
      ["personality.boldness", signal.personality.boldness, 0, 1],
      ["personality.sociability", signal.personality.sociability, 0, 1],
      ["affect.surprise", signal.affect.surprise, 0, 1],
      ["affect.valence", signal.affect.valence, -1, 1],
      ["affect.arousal", signal.affect.arousal, 0, 1],
      ["temporal.derivativeNorm", signal.temporalSurprise.derivativeNorm, 0, 4],
      ["temporal.gate", signal.temporalSurprise.gate, 0, 1],
      ["temporal.centeredEnergy", signal.temporalSurprise.centeredEnergy, 0, 1],
      ["microBelief.novelty", signal.microBelief.novelty, 0, 1],
      ["microBelief.familiarity", signal.microBelief.familiarity, 0, 1],
      ["microBelief.socialPositivity", signal.microBelief.socialPositivity, 0, 1],
      ["microBelief.caution", signal.microBelief.caution, 0, 1],
      ["reaction.score", signal.reaction.score, 0, 1],
    ];
    for (const [name, value, min, max] of checks) {
      if (!inRange(value, min, max)) {
        failures.push(`${name} outside [${min},${max}] at ${step.clockS}s`);
      }
    }
    if (signal.reaction.remainingS < 0) {
      failures.push(`reaction.remainingS negative at ${step.clockS}s`);
    }
    for (const candidate of signal.reaction.candidates) {
      if (!inRange(candidate.score, 0, 1)) {
        failures.push(`reaction candidate score outside [0,1] at ${step.clockS}s`);
      }
    }
    const biasChecks: [string, number, number, number][] = [
      ["idleDwell", signal.behaviorBias.idleDwell, 0.5, 1.5],
      ["walkSpeed", signal.behaviorBias.walkSpeed, 0.5, 1.75],
      ["jumpChance", signal.behaviorBias.jumpChance, 0.2, 1.8],
      ["bubbleChance", signal.behaviorBias.bubbleChance, 0.2, 1.8],
      ["animationPace", signal.behaviorBias.animationPace, 0.75, 1.25],
    ];
    for (const [name, value, min, max] of biasChecks) {
      if (!inRange(value, min, max)) {
        failures.push(`bias ${name} outside [${min},${max}] at ${step.clockS}s`);
      }
    }
  }
  return failures;
}

function validateSchedulerAuthority(trace: ScenarioTraceRecord[]): string[] {
  const failures: string[] = [];
  const activeBubbles = new Map<string, boolean>();
  const airborne = new Map<string, boolean>();
  let lastSchedulerRollAtS = -Infinity;
  let lastBubbleAtS = -Infinity;

  for (const record of trace) {
    const characterId = record.characterId;
    if (record.type === "scheduler_roll") {
      lastSchedulerRollAtS = record.clockS;
      continue;
    }
    if (!characterId) continue;
    const schedulerRollAvailable =
      record.clockS >= lastSchedulerRollAtS - 1e-9 &&
      record.clockS - lastSchedulerRollAtS <= 1 / 30 + 1e-9;

    if (record.type === "jump_started") {
      if (airborne.get(characterId)) {
        failures.push(`jump started while airborne at ${record.clockS}s`);
      }
      if (!schedulerRollAvailable) {
        failures.push(`jump started without scheduler roll at ${record.clockS}s`);
      }
      airborne.set(characterId, true);
    }
    if (record.type === "jump_ended") airborne.set(characterId, false);

    if (record.type === "bubble_started") {
      if (activeBubbles.get(characterId)) {
        failures.push(`bubble started while active at ${record.clockS}s`);
      }
      if (record.clockS - lastBubbleAtS < BUBBLE.GLOBAL_COOLDOWN_S - 1e-9) {
        failures.push(`bubble started inside global cooldown at ${record.clockS}s`);
      }
      if (record.reason !== "greeting" && !schedulerRollAvailable) {
        failures.push(`bubble started without scheduler roll at ${record.clockS}s`);
      }
      activeBubbles.set(characterId, true);
      lastBubbleAtS = record.clockS;
    }
    if (record.type === "bubble_ended") activeBubbles.set(characterId, false);
    if (record.type === "render_handle_destroyed") {
      activeBubbles.delete(characterId);
      airborne.delete(characterId);
    }
  }
  return failures;
}

function characterOrdinal(characterId: string): number {
  const ordinal = Number(characterId.split("-")[characterId.split("-").length - 1]);
  if (!Number.isInteger(ordinal)) throw new Error(`Invalid character identity ${characterId}`);
  return ordinal;
}

function latestStepsByCharacter(steps: ReturnType<typeof scenarioCognitionSteps>) {
  const latest = new Map<number, ReturnType<typeof scenarioCognitionSteps>[number]>();
  for (const step of steps) {
    const ordinal = characterOrdinal(step.characterId);
    const current = latest.get(ordinal);
    if (!current || step.clockS > current.clockS) latest.set(ordinal, step);
  }
  return [...latest.entries()].sort(([left], [right]) => left - right).map(([, step]) => step);
}

function meanPairwiseBiasDistance(steps: ReturnType<typeof scenarioCognitionSteps>): number {
  let total = 0;
  let count = 0;
  for (const [index, left] of steps.entries()) {
    const leftBias = left.appliedBiases as Record<string, number>;
    for (const right of steps.slice(index + 1)) {
      const rightBias = right.appliedBiases as Record<string, number>;
      total += Object.keys(rightBias).reduce(
        (sum, key) => sum + Math.abs((leftBias[key] ?? 0) - (rightBias[key] ?? 0)),
        0,
      );
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

function lateIndividualityGroups(steps: ReturnType<typeof scenarioCognitionSteps>): {
  personalities: number;
  biases: number;
} {
  const personalities = steps.map(
    (step) => (step.behaviorSignal as BehaviorSignal).personality,
  );
  const biases = steps.map((step) => step.appliedBiases as Record<string, number>);
  return {
    personalities: new Set(personalities.map((value) => stableIndividualityKey(value))).size,
    biases: new Set(biases.map((value) => stableIndividualityKey(value))).size,
  };
}

function stableIndividualityKey(value: object): string {
  return Object.entries(value as Record<string, number>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, number]) => `${key}:${number.toFixed(6)}`)
    .join("|");
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildSetAttentionDeterministicReport(
  input: SetAttentionAcceptanceInput,
): SetAttentionAcceptanceReport {
  const scenario = input.soakScenario ?? PHASE2_SOCIAL_SOAK_SCENARIO;
  const onProjections = new Map<string, number[]>();
  const offProjections = new Map<string, number[]>();
  const passDurationsMs: number[] = [];
  let firstInfluenceAtS: number | null = null;
  let firstInfluenceNorm = 0;

  // Exercise facade and JIT paths once so the max budget is not consumed by
  // one-time WebAssembly/optimization overhead.
  runScenario(
    {
      ...scenario,
      name: `${scenario.name}-warmup`,
      durationS: 1.1,
      stimuli: [],
      despawns: [],
      populationCognitionEnabled: true,
    },
    30,
    { createCognitionHandle: input.createCognitionHandle },
  );
  const onResult = runScenario(scenario, 30, {
    createCognitionHandle: withProjectionRecorder(input.createCognitionHandle, onProjections),
    instrumentation: {
      onPopulationPass: (durationMs, summary) => {
        if (summary.eligibleCount === scenario.spawnTimes.length) {
          passDurationsMs.push(durationMs);
        }
        if (
          firstInfluenceAtS === null &&
          summary.enabled &&
          (summary.influenceNorm ?? 0) > 0
        ) {
          firstInfluenceAtS = summary.atS;
          firstInfluenceNorm = summary.influenceNorm ?? 0;
        }
      },
    },
  });
  const onTrace = formatScenarioTraceNdjson(onResult);
  const repeatedTrace = formatScenarioTraceNdjson(
    runScenario(scenario, 30, {
      createCognitionHandle: withProjectionRecorder(input.createCognitionHandle, new Map()),
    }),
  );
  const offResult = runScenario(
    { ...scenario, name: `${scenario.name}-off`, populationCognitionEnabled: false },
    30,
    {
      createCognitionHandle: withProjectionRecorder(
        input.createCognitionHandle,
        offProjections,
      ),
    },
  );

  const sortedCost = [...passDurationsMs].sort((a, b) => a - b);
  const costP95 = sortedCost[Math.floor(sortedCost.length * 0.95)] ?? 0;
  const costMax = sortedCost[sortedCost.length - 1] ?? 0;
  const enabledSpread = projectionSpread(onProjections);
  const baselineSpread = projectionSpread(offProjections);
  const spreadRatio = baselineSpread === 0 ? (enabledSpread === 0 ? 1 : Infinity) : enabledSpread / baselineSpread;

  const passes = onResult.trace.filter(
    (record) => record.type === "population_cognition_pass",
  ) as PopulationPassRecord[];
  const lifecycleCounts = passes.map((pass) => pass.summary?.eligibleCount ?? 0);
  const despawnAtS = scenario.despawns?.[0]?.atS;
  const lastFullMembership = [...passes]
    .reverse()
    .find((pass) => pass.clockS < (despawnAtS ?? -Infinity) && pass.summary?.eligibleCount === scenario.spawnTimes.length);
  const firstPostDespawnMembership = passes.find((pass) =>
    pass.clockS >= (despawnAtS ?? Infinity) &&
    pass.summary?.eligibleCount === scenario.spawnTimes.length - 1,
  );
  const beforeDespawnIds = new Set(
    lastFullMembership?.summary?.postIntegrationSignals.map((signal) => signal.characterId),
  );
  const survivorsUnchanged = Boolean(
    lastFullMembership &&
    firstPostDespawnMembership &&
    firstPostDespawnMembership.summary?.postIntegrationSignals.length === scenario.spawnTimes.length - 1 &&
    firstPostDespawnMembership.summary.postIntegrationSignals.every((signal) =>
      beforeDespawnIds.has(signal.characterId),
    ) &&
    firstPostDespawnMembership.summary.postIntegrationSignals.some((signal) => signal.socialPositivity > 0),
  );
  const lifecycleOk = Boolean(
    lifecycleCounts.includes(scenario.spawnTimes.length) &&
    lifecycleCounts.includes(scenario.spawnTimes.length - 1) &&
    lastFullMembership &&
    firstPostDespawnMembership &&
    survivorsUnchanged,
  );

  const bounded: string[] = [];
  for (const record of onResult.trace) {
    if (record.type !== "population_cognition_pass") continue;
    const summary = record.summary as PopulationPassSummary | undefined;
    if (summary?.influenceNorm != null &&
      !(summary.influenceNorm >= 0 && summary.influenceNorm <= 1)) {
      bounded.push("influenceNorm outside [0,1]");
    }
    const strongest = summary?.strongestContribution;
    if (strongest && !(strongest.value >= -1 && strongest.value <= 1)) {
      bounded.push("strongest contribution outside [-1,1]");
    }
    for (const signal of summary?.postIntegrationSignals ?? []) {
      if (!(signal.socialPositivity !== undefined && signal.socialPositivity >= 0 && signal.socialPositivity <= 1)) {
        bounded.push("post-integration social signal outside [0,1]");
      }
    }
  }

  const finite = validateCognitionValues(onResult.trace);
  const outOfRange = validateBehaviorSignalBounds(onResult.trace);
  const schedulerFailures = [onResult, offResult].flatMap((result) =>
    validateSchedulerAuthority(result.trace),
  );
  const finalSteps = scenarioCognitionSteps(onResult).filter((step) =>
    step.clockS >= scenario.durationS - 0.1,
  );
  const individualValues = new Set(
    finalSteps.map((step) => (step.microBelief as { socialPositivity: number }).socialPositivity),
  );
  const individuality = lateIndividualityGroups(finalSteps);
  const latestOnSteps = latestStepsByCharacter(finalSteps);
  const latestOffSteps = latestStepsByCharacter(
    scenarioCognitionSteps(offResult).filter((step) => step.clockS >= scenario.durationS - 0.1),
  );
  const behaviorSeparationRatio =
    meanPairwiseBiasDistance(latestOffSteps) === 0
      ? meanPairwiseBiasDistance(latestOnSteps) === 0 ? 1 : Infinity
      : meanPairwiseBiasDistance(latestOnSteps) / meanPairwiseBiasDistance(latestOffSteps);

  const gates: SetAttentionGateEvidence[] = [
    {
      name: "five-minute-soak-and-bounds",
      status: scenario.durationS === 300 && finite.length === 0 && outOfRange.length === 0 && bounded.length === 0
        ? "pass" : "failed",
      details: finite.length || outOfRange.length || bounded.length
        ? [...finite, ...outOfRange, ...bounded].slice(0, 3).join("; ")
        : `eight characters; ${scenario.durationS}s virtual soak`,
    },
    {
      name: "byte-identical-replay",
      status: onTrace === repeatedTrace ? "pass" : "failed",
      details: onTrace === repeatedTrace
        ? `social-on traces match exactly; trace digest ${fnv1a32(onTrace)}`
        : `social-on trace diverged; digests ${fnv1a32(onTrace)}/${fnv1a32(repeatedTrace)}`,
    },
    {
      name: "membership-lifecycle",
      status: lifecycleOk ? "pass" : "failed",
      details: lifecycleOk
        ? `despawn at ${despawnAtS}s affected only the next pass; ${scenario.spawnTimes.length - 1} survivors retained social state`
        : `eligible counts ${lifecycleCounts[0]}..${lifecycleCounts[lifecycleCounts.length - 1]}; survivors unchanged=${survivorsUnchanged}`,
    },
    {
      name: "individuality-under-influence",
      status: finalSteps.length > 0 &&
        individuality.personalities > 1 &&
        individuality.biases > 1 &&
        behaviorSeparationRatio >= PHASE2_SET_ATTENTION_THRESHOLDS.behaviorDistanceFractionOfBaseline
        ? "pass"
        : "failed",
      details: `late personality/bias distinct groups ${individuality.personalities}:${individuality.biases}; behavior-distance ratio ${behaviorSeparationRatio.toFixed(4)}; ${individualValues.size} socialPositivity values`,
    },
    {
      name: "projection-spread-retention",
      status: spreadRatio >= PHASE2_SET_ATTENTION_THRESHOLDS.projectionSpreadFractionOfBaseline
        ? "pass" : "failed",
      details: `ratio ${spreadRatio.toFixed(4)} (${enabledSpread.toFixed(5)} / ${baselineSpread.toFixed(5)})`,
    },
    {
      name: "population-pass-budget",
      status: costP95 <= PHASE2_SET_ATTENTION_THRESHOLDS.populationPassP95Ms &&
        costMax <= PHASE2_SET_ATTENTION_THRESHOLDS.populationPassMaxMs
        ? "pass"
        : costP95 <= PHASE2_SET_ATTENTION_THRESHOLDS.populationPassP95Ms * 1.1 &&
          costMax <= PHASE2_SET_ATTENTION_THRESHOLDS.populationPassMaxMs * 1.1
          ? "marginal"
          : "failed",
      details: `p95 ${costP95.toFixed(5)} ms; max ${costMax.toFixed(5)} ms over ${passDurationsMs.length} eight-character passes`,
    },
    {
      name: "gradual-first-influence",
      status: firstInfluenceAtS !== null &&
        firstInfluenceAtS <= PHASE2_SET_ATTENTION_THRESHOLDS.firstInfluenceByS &&
        firstInfluenceNorm < 1
        ? "pass" : "failed",
      details: `first signal influence at ${firstInfluenceAtS ?? "never"}s with norm ${firstInfluenceNorm.toFixed(6)}`,
    },
    {
      name: "scheduler-authority",
      status: schedulerFailures.length === 0 &&
        [onResult, offResult].every((result) =>
          scenarioCognitionSteps(result).every((step) =>
            Object.values(step.appliedBiases as Record<string, number>).every(
              (value) => Number.isFinite(value) && value >= 0.2 && value <= 1.8,
            ),
          ),
        ) ? "pass" : "failed",
      details: schedulerFailures.length === 0
        ? "scheduler-gated jumps/bubbles, cooldowns, airborne rules, active bubbles, and bounded biases remained intact"
        : schedulerFailures.slice(0, 3).join("; "),
    },
  ];

  const humanEvaluation = input.humanEvaluation ?? {
    completed: false,
    perceivedPeerAwarenessStronger: false,
    individualityNotReduced: false,
    calmNotReduced: false,
  };
  const blockers = gates
    .filter((gate) => gate.status !== "pass")
    .map((gate) => `${gate.name}: ${gate.details}`);
  if (!humanEvaluation.completed) {
    blockers.push("human-blind-evaluation: pending");
  } else {
    if (!humanEvaluation.perceivedPeerAwarenessStronger) {
      blockers.push("human-blind-evaluation: peer awareness was not stronger");
    }
    if (!humanEvaluation.individualityNotReduced) {
      blockers.push("human-blind-evaluation: Individuality was reduced");
    }
    if (!humanEvaluation.calmNotReduced) {
      blockers.push("human-blind-evaluation: Calm was reduced");
    }
    if (!humanEvaluation.evidenceUrl) {
      blockers.push("human-blind-evaluation: evidence link is missing");
    }
  }

  return {
    schemaVersion: PHASE2_SET_ATTENTION_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: blockers.length === 0 ? "pass" : "blocked",
    scenario: {
      name: scenario.name,
      durationS: scenario.durationS,
      characters: scenario.spawnTimes.length,
    },
    thresholds: PHASE2_SET_ATTENTION_THRESHOLDS,
    gates,
    humanEvaluation,
    blockers,
  };
}
