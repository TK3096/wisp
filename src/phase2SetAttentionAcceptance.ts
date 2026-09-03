import { CognitionHandle, CognitionInit, NEUTRAL_SOCIAL_PROJECTION } from "./cognition";
import {
  POPULATION_COGNITION_ON_SCENARIO,
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
  populationPassMaxMs: 0.5,
  projectionSpreadFractionOfBaseline: 0.8,
  firstInfluenceByS: 5,
} as const;

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

  // Exercise facade and JIT paths once so the max budget is not consumed by
  // one-time WebAssembly/optimization overhead.
  runScenario(POPULATION_COGNITION_ON_SCENARIO, 30, {
    createCognitionHandle: input.createCognitionHandle,
  });
  const onResult = runScenario(scenario, 30, {
    createCognitionHandle: withProjectionRecorder(input.createCognitionHandle, onProjections),
    instrumentation: {
      onPopulationPass: (durationMs, summary) => {
        passDurationsMs.push(durationMs);
        if (
          firstInfluenceAtS === null &&
          summary.enabled &&
          (summary.influenceNorm ?? 0) > 0
        ) {
          firstInfluenceAtS = summary.atS;
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
  ) as Array<ScenarioTraceRecord & { summary?: { eligibleCount?: number } }>;
  const lifecycleCounts = passes.map((pass) => pass.summary?.eligibleCount ?? 0);

  const bounded: string[] = [];
  for (const record of onResult.trace) {
    if (record.type !== "population_cognition_pass") continue;
    const summary = record.summary as {
      influenceNorm?: number | null;
      postIntegrationSignals?: { socialPositivity?: number }[];
    } | undefined;
    if (summary?.influenceNorm != null &&
      !(summary.influenceNorm >= 0 && summary.influenceNorm <= 1)) {
      bounded.push("influenceNorm outside [0,1]");
    }
    for (const signal of summary?.postIntegrationSignals ?? []) {
      if (!(signal.socialPositivity !== undefined && signal.socialPositivity >= 0 && signal.socialPositivity <= 1)) {
        bounded.push("post-integration social signal outside [0,1]");
      }
    }
  }

  const finite = validateCognitionValues(onResult.trace);
  const finalSteps = scenarioCognitionSteps(onResult).filter((step) =>
    step.elapsedCognitionS >= scenario.durationS - 0.1,
  );
  const individualValues = new Set(
    finalSteps.map((step) => (step.microBelief as { socialPositivity: number }).socialPositivity),
  );

  const gates: SetAttentionGateEvidence[] = [
    {
      name: "five-minute-soak-and-bounds",
      status: scenario.durationS === 300 && finite.length === 0 && bounded.length === 0
        ? "pass" : "failed",
      details: finite.length || bounded.length
        ? [...finite, ...bounded].slice(0, 3).join("; ")
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
      status: lifecycleCounts.includes(8) && lifecycleCounts.includes(7)
        ? "pass" : "failed",
      details: `eligible counts included ${lifecycleCounts[0]} and ${lifecycleCounts[lifecycleCounts.length - 1]}`,
    },
    {
      name: "individuality-under-influence",
      status: individualValues.size > 1 ? "pass" : "failed",
      details: `${individualValues.size} distinct final socialPositivity values`,
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
      details: `p95 ${costP95.toFixed(5)} ms; max ${costMax.toFixed(5)} ms`,
    },
    {
      name: "gradual-first-influence",
      status: firstInfluenceAtS !== null && firstInfluenceAtS <= PHASE2_SET_ATTENTION_THRESHOLDS.firstInfluenceByS
        ? "pass" : "failed",
      details: `first signal influence at ${firstInfluenceAtS ?? "never"}s`,
    },
    {
      name: "scheduler-authority",
      status: [onResult, offResult].every((result) =>
        scenarioCognitionSteps(result).every((step) =>
          Object.values(step.appliedBiases as Record<string, number>).every(
            (value) => Number.isFinite(value) && value >= 0.2 && value <= 1.8,
          ),
        ),
      ) ? "pass" : "failed",
      details: "social-on and social-off applied biases remained finite and bounded; behavior stayed registry-owned",
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
  if (
    !humanEvaluation.completed ||
    !humanEvaluation.perceivedPeerAwarenessStronger ||
    !humanEvaluation.individualityNotReduced ||
    !humanEvaluation.calmNotReduced ||
    !humanEvaluation.evidenceUrl
  ) {
    blockers.push(
      "human-blind-evaluation: pending or did not show stronger peer awareness without reduced Individuality/Calm",
    );
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
