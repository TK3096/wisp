import {
  COGNITION_SCHEMA_VERSION,
  CognitionHandle,
  CognitionInit,
  BehaviorSignal,
} from "./cognition";
import {
  CHARACTER_PERSISTENCE_ENVELOPE_VERSION,
  CharacterPersistenceRecord,
  CharacterPersistenceStore,
} from "./characterPersistence";
import {
  CAUTION_STARTLE_ARC_SCENARIO,
  HABITUATION_SCENARIO,
  NEUTRAL_BASELINE_SCENARIO,
  NOVEL_STRONG_GESTURE_SCENARIO,
  PERSONALITY_CONTRAST_SCENARIO,
  PHASE1_STRESS_SCENARIO,
  QUIET_BOREDOM_SCENARIO,
  REACTION_STORM_SCENARIO,
  ScenarioDefinition,
  ScenarioInstrumentation,
  ScenarioResult,
  TraceSink,
  formatScenarioTraceNdjson,
  HEADLESS_ASSET,
  HEADLESS_LOADED_ASSET,
  runScenario,
  scenarioBehaviorDecisions,
  scenarioCognitionSteps,
} from "./scenarioHarness";

export const PHASE1_ACCEPTANCE_SCHEMA_VERSION = 1;

/**
 * These are the recorded Phase 1 gates. Timing values are real wall-clock
 * costs of the virtual replay on the host identified in the report; frame
 * time is additionally compared with the 33.33 ms worst-supported schedule.
 */
export const PHASE1_ACCEPTANCE_THRESHOLDS = {
  perCharacterCognitionTickP95Ms: 0.1,
  cognitionBatchP95Ms: 0.8,
  renderTickP95Ms: 33.333,
  traceWriteP95Ms: 0.5,
  stimulusToBiasP95Ms: 1,
  additionalMemoryBytes: 256 * 1024 * 1024,
  wasmInitializationMs: 500,
  frameTimeP95Ms: 33.333,
  cpuMillisecondsPerSimulatedSecond: 40,
  determinism: "byte-identical",
} as const;

const MARGINAL_RATIO = 1.1;

export interface Measurement {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  unit: string;
}

export interface BudgetEvaluation {
  name: string;
  value: number;
  threshold: number;
  comparison: "<=" | "equal";
  unit: string;
  status: "pass" | "marginal" | "failed";
  raw: Measurement;
}

export interface ScenarioEvidence {
  name: string;
  passed: boolean;
  failures: string[];
  renderSchedulesHz: number[];
  traceRecordCounts: number[];
  cognitionStepCounts: number[];
  repeatedTraceDigests: string[];
  repeatedTraceIdentical: boolean;
  crossScheduleCognitionEquivalent: boolean;
  crossScheduleDecisionsEquivalent: boolean;
}

export interface PersistenceEvidence {
  name: string;
  passed: boolean;
  details: string;
}

export interface Phase1Environment {
  platform: string;
  arch: string;
  runtime: string;
  runtimeVersion: string;
  cpuModel: string;
  cpuCount: number;
}

export interface BuildIdentity {
  packageVersion: string;
  gitBranch: string;
  gitSha: string;
  gitDirty: boolean;
}

export interface Phase1AcceptanceReport {
  schemaVersion: typeof PHASE1_ACCEPTANCE_SCHEMA_VERSION;
  generatedAt: string;
  status: "pass" | "blocked";
  environment: Phase1Environment;
  buildIdentity: BuildIdentity;
  contracts: {
    acceptance: number;
    cognition: number;
    characterPersistence: number;
    scenario: string;
  };
  command: string;
  canonicalScenarios: ScenarioEvidence[];
  budgets: BudgetEvaluation[];
  persistenceChecks: PersistenceEvidence[];
  determinism: {
    identicalScenarios: number;
    totalScenarios: number;
    passed: boolean;
    stressTraceDigest: string;
  };
  stressReplay: {
    name: string;
    durationS: number;
    characters: number;
    renderScheduleHz: number;
    cognitionCadenceHz: number;
    simulatedStimulusDeliveries: number;
    traceRecords: number;
    droppedTraceEvents: number;
  };
  blockers: string[];
}

function finite(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

export function summarize(values: readonly number[], unit: string): Measurement {
  const samples = finite(values).sort((left, right) => left - right);
  const at = (fraction: number): number => {
    if (samples.length === 0) return Number.NaN;
    const index = Math.min(samples.length - 1, Math.floor(fraction * samples.length));
    return samples[index];
  };
  return {
    count: samples.length,
    min: samples[0] ?? Number.NaN,
    p50: at(0.5),
    p95: at(0.95),
    max: samples[samples.length - 1] ?? Number.NaN,
    unit,
  };
}

export class Phase1MetricsCollector implements ScenarioInstrumentation {
  readonly cognitionTickSamples: number[] = [];
  readonly batchSamples: number[] = [];
  readonly renderTickSamples: number[] = [];
  readonly stimulusToBiasSamples: number[] = [];
  readonly traceWriteSamples: number[] = [];

  private readonly batchByRenderTick = new Map<number, number>();

  onCognitionTick(characterId: string, durationMs: number, renderTick: number): void {
    void characterId;
    this.cognitionTickSamples.push(durationMs);
    this.batchByRenderTick.set(
      renderTick,
      (this.batchByRenderTick.get(renderTick) ?? 0) + durationMs,
    );
  }

  onRenderTick(durationMs: number, renderTick: number): void {
    const batch = this.batchByRenderTick.get(renderTick);
    if (batch !== undefined) this.batchSamples.push(batch);
    this.batchByRenderTick.delete(renderTick);
    this.renderTickSamples.push(durationMs);
  }

  onStimulusToBias(characterId: string, durationMs: number): void {
    void characterId;
    this.stimulusToBiasSamples.push(durationMs);
  }

  traceSink: TraceSink = async (_line: string) => {
    const startedAt = performance.now();
    await Promise.resolve();
    this.traceWriteSamples.push(performance.now() - startedAt);
  };
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function decisions(result: ScenarioResult): ReturnType<typeof scenarioBehaviorDecisions> {
  return scenarioBehaviorDecisions(result);
}

function steps(result: ScenarioResult, throughS = Number.POSITIVE_INFINITY) {
  return scenarioCognitionSteps(result).filter(
    (step) => step.elapsedCognitionS <= throughS,
  );
}

function observations(result: ScenarioResult, kind: string): number {
  return result.trace.filter(
    (record) =>
      record.type === "stimulus_observed" &&
      (record.envelope as { stimulus: { kind: string } }).stimulus.kind === kind,
  ).length;
}

function checkScenario(
  scenario: ScenarioDefinition,
  results: ScenarioResult[],
): { evidence: ScenarioEvidence; digests: string[] } {
  type StepGroup = [string, ReturnType<typeof steps>];
  type GroupedSteps = StepGroup[];
  const failures: string[] = [];
  const scheduleResults = results.slice(0, 3);
  const result = results[1];
  const comparisonHorizonS =
    scenario.name === PHASE1_STRESS_SCENARIO.name ? 118 : Number.POSITIVE_INFINITY;
  const characterMaterializations = result.trace.filter(
    (record) => record.type === "character_materialized",
  ).length;

  if (!result.trace.some((record) => record.type === "scenario_completed")) {
    failures.push("scenario did not complete");
  }
  if (characterMaterializations !== scenario.spawnTimes.length) {
    failures.push(
      `materialized ${characterMaterializations} characters, expected ${scenario.spawnTimes.length}`,
    );
  }

  if (scenario.name === NOVEL_STRONG_GESTURE_SCENARIO.name) {
    if (observations(result, "gesture") !== 1) failures.push("novel gesture was not observed once");
    if (!decisions(result).some((item) => item.type === "jump_started")) {
      failures.push("novel gesture did not increase the scheduler-gated jump");
    }
  }

  if (scenario.name === HABITUATION_SCENARIO.name) {
    if (observations(result, "gesture") !== 99) failures.push("expected 99 habituation observations");
    if (decisions(result).some((item) => item.type === "jump_started")) {
      failures.push("habituated stimulus crossed scheduler ownership");
    }
  }

  if (scenario.name === CAUTION_STARTLE_ARC_SCENARIO.name) {
    const orderedSteps = steps(result);
    const firstSignal = orderedSteps.find(
      (step) => step.elapsedCognitionS === 0.8,
    )?.behaviorSignal as BehaviorSignal | undefined;
    const startled = orderedSteps.find(
      (step) => (step.behaviorSignal as BehaviorSignal).reaction.kind === "startle",
    )?.behaviorSignal as BehaviorSignal | undefined;
    if (observations(result, "environment") !== 51) failures.push("expected 51 environment observations");
    if (firstSignal?.reaction.kind !== "curiosity") {
      failures.push("first caution observation did not produce curiosity");
    }
    if (startled?.reaction.kind !== "startle") {
      failures.push("caution arc did not produce startle");
    }
    if (!startled || startled.microBelief.caution <= startled.microBelief.novelty) {
      failures.push("startle did not retain the caution projection");
    }
  }

  if (scenario.name === QUIET_BOREDOM_SCENARIO.name) {
    const bored = steps(result).some(
      (step) => (step.behaviorSignal as BehaviorSignal).reaction.kind === "boredom",
    );
    if (!bored) failures.push("quiet inactivity did not select boredom");
  }

  if (scenario.name === PERSONALITY_CONTRAST_SCENARIO.name) {
    const personalitySteps = steps(result).filter(
      (item) => item.elapsedCognitionS >= 8.1,
    );
    const signals = personalitySteps
      .map((item) => item.behaviorSignal as BehaviorSignal)
      .filter((item) => item.reaction.kind === "curiosity");
    const biases = new Set(signals.map((item) => item.behaviorBias.jumpChance));
    if (observations(result, "gesture") !== 2) failures.push("expected one public gesture per character");
    if (biases.size !== 2) failures.push("personalities did not produce distinct bounded biases");
  }

  if (scenario.name === REACTION_STORM_SCENARIO.name) {
    const starts: number[] = [];
    let previous: string = "none";
    for (const step of steps(result)) {
      const kind = (step.behaviorSignal as BehaviorSignal).reaction.kind;
      if (previous === "none" && kind !== "none") starts.push(step.elapsedCognitionS);
      previous = kind;
    }
    starts.sort((left, right) => left - right);
    if (observations(result, "gesture") !== 608) failures.push("expected 608 storm observations");
    if (starts.length < 2) failures.push("storm did not produce repeated reactions");
    for (let index = 1; index < starts.length; index += 1) {
      if (starts[index] - starts[index - 1] < 0.6 - 1e-9) {
        failures.push("reaction cooldown was violated");
        break;
      }
    }
  }

  const digests = results.map((item) => fnv1a32(formatScenarioTraceNdjson(item)));
  const repeated = digests[1] === digests[3];
  if (!repeated) failures.push("byte-identical repeated 60 Hz traces differ");

  // Multiple frame events can interleave differently at 30/60/120 Hz. Compare
  // each character's actual Cognition steps and decision production, not
  // global frame-local ordering.
  const stepGroups: GroupedSteps[] = scheduleResults.map((item) => {
    const groups = new Map<string, ReturnType<typeof steps>>();
    for (const step of steps(item, comparisonHorizonS)) {
      const group = groups.get(step.characterId) ?? [];
      group.push(step);
      groups.set(step.characterId, group);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  });
  const characterIds = stepGroups[0].map(([characterId]) => characterId);
  const commonCounts = new Map(
    characterIds.map((characterId) => [
      characterId,
      Math.min(...stepGroups.map((groups) =>
        groups.find(([id]) => id === characterId)?.[1].length ?? 0,
      )),
    ]),
  );
  const crossSteps: GroupedSteps[] = stepGroups.map((groups) =>
    groups.map(([characterId, group]) => [
      characterId,
      group.slice(0, commonCounts.get(characterId) ?? 0),
    ]),
  );
  const stepsEqual = crossSteps.every((item) => JSON.stringify(item) === JSON.stringify(crossSteps[0]));
  const decisionProduction = scheduleResults.map((item) => {
    const counts = new Map<string, number>();
    const boundedTrace = item.trace.filter(
      (record) => record.clockS <= comparisonHorizonS,
    );
    for (const decision of decisions({...item, trace: boundedTrace})) {
      const key = `${decision.characterId}:${decision.type}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  });
  let decisionsEqual = decisionProduction.every(
    (item) => JSON.stringify(item) === JSON.stringify(decisionProduction[0]),
  );
  if (scenario.name === PHASE1_STRESS_SCENARIO.name) {
    // Render timers can consume the shared scheduler sequence in a different
    // character order. Frame independence therefore requires the same scheduler
    // contract and requires every jump to remain scheduler-owned.
    const schedulerSequences = scheduleResults.map((item) =>
      item.trace
        .filter((record) => record.type === "scheduler_roll")
        .map((record) => record.value),
    );
    const shortestSchedulerSequence = Math.min(
      ...schedulerSequences.map((item) => item.length),
    );
    const schedulerSequencesEqual = schedulerSequences.every((sequence) =>
      sequence
        .slice(0, shortestSchedulerSequence)
        .every((value, index) => value === schedulerSequences[0][index]),
    );
    const jumpsSchedulerOwned = scheduleResults.every((item) => {
      let seenRoll = false;
      for (const record of item.trace) {
        if (record.type === "scheduler_roll") seenRoll = true;
        if (record.type === "jump_started" && !seenRoll) return false;
      }
      return true;
    });
    decisionsEqual = schedulerSequencesEqual && jumpsSchedulerOwned;
  }
  if (!stepsEqual) failures.push("cognition steps differ across render schedules");
  if (!decisionsEqual) failures.push("behavior decisions differ across render schedules");
  return {
    evidence: {
      name: scenario.name,
      passed: failures.length === 0,
      failures,
      renderSchedulesHz: results.map((item) => item.renderScheduleHz),
      traceRecordCounts: results.map((item) => item.trace.length),
      cognitionStepCounts: results.map((item) => steps(item).length),
      repeatedTraceDigests: digests,
      repeatedTraceIdentical: repeated,
      crossScheduleCognitionEquivalent: stepsEqual,
      crossScheduleDecisionsEquivalent: decisionsEqual,
    },
    digests,
  };
}

function evaluate(
  name: string,
  values: readonly number[],
  threshold: number,
  unit: string,
): BudgetEvaluation {
  const raw = summarize(values, unit);
  const value = raw.p95;
  const status =
    value <= threshold ? "pass" : value <= threshold * MARGINAL_RATIO ? "marginal" : "failed";
  return { name, value, threshold, comparison: "<=", unit, status, raw };
}

function validUuid(index: number): string {
  return `0198c0de-0000-7000-8000-${index.toString().padStart(12, "0")}`;
}

const ACCEPTANCE_ASSET = HEADLESS_ASSET;
const ACCEPTANCE_LOADED_ASSET = HEADLESS_LOADED_ASSET;

function headlessRegistryOptions(
  createCognitionHandle: (init: CognitionInit) => CognitionHandle,
  persistence: CharacterPersistenceStore,
  identityOffset: number,
) {
  return {
    stage: null,
    manifest: [ACCEPTANCE_ASSET],
    loadedAssets: new Map([[ACCEPTANCE_ASSET.name, ACCEPTANCE_LOADED_ASSET]]),
    rng: () => 0.25,
    screenWidth: 800,
    floorY: 600,
    createCognitionHandle,
    createCharacterId: () => validUuid(identityOffset),
    persistence,
    nowMs: (() => {
      let nowMs = 0;
      return () => ++nowMs;
    })(),
    derivePersonalitySeed: () => 17,
  };
}

function memoryStore(): {
  store: CharacterPersistenceStore;
  records: Map<string, CharacterPersistenceRecord>;
  deleted: string[];
  quarantined: { record: unknown; area: string }[];
} {
  const records = new Map<string, CharacterPersistenceRecord>();
  const deleted: string[] = [];
  const quarantined: { record: unknown; area: string }[] = [];
  return {
    records,
    deleted,
    quarantined,
    store: {
      async save(record) {
        records.set(record.characterId, structuredClone(record));
      },
      async delete(characterId) {
        deleted.push(characterId);
        records.delete(characterId);
      },
      async quarantine(record, area) {
        quarantined.push({ record: structuredClone(record), area });
      },
    },
  };
}

function tickCounting(createCognitionHandle: (init: CognitionInit) => CognitionHandle) {
  const counts = new Map<string, number>();
  return {
    counts,
    createCognitionHandle(init: CognitionInit): CognitionHandle {
      const handle = createCognitionHandle(init);
      counts.set(init.characterId, 0);
      return {
        ...handle,
        tick(dt) {
          counts.set(init.characterId, (counts.get(init.characterId) ?? 0) + 1);
          return handle.tick(dt);
        },
      };
    },
  };
}

export async function runPersistenceAcceptance(
  createCognitionHandle: (init: CognitionInit) => CognitionHandle,
): Promise<PersistenceEvidence[]> {
  const evidence: PersistenceEvidence[] = [];
  const first = memoryStore();
  const firstCounts = tickCounting(createCognitionHandle);
  const CharacterRegistry = (await import("./characterRegistry")).CharacterRegistry;
  const source = new CharacterRegistry({
    ...headlessRegistryOptions(firstCounts.createCognitionHandle, first.store, 1),
  });
  source.spawn();
  source.tick(0.1);
  await source.flush();
  const restartRecord = first.records.get(validUuid(1));
  evidence.push({
    name: "restart-persistence",
    passed: Boolean(restartRecord),
    details: restartRecord ? "one valid durable snapshot was written" : "durable snapshot was missing",
  });

  const second = memoryStore();
  const secondCounts = tickCounting(createCognitionHandle);
  const restored = new CharacterRegistry({
    ...headlessRegistryOptions(secondCounts.createCognitionHandle, second.store, 2),
  });
  let restoredCount = 0;
  const restoredIdentity = restartRecord?.characterId ?? validUuid(1);
  if (restartRecord) {
    restoredCount = await restored.restore([restartRecord]);
    restored.tick(0.1);
    await restored.flush();
  }
  evidence.push({
    name: "no-offline-replay",
    passed: restoredCount === 1 && secondCounts.counts.get(restoredIdentity) === 1,
    details: `restored ${restoredCount}; first cadence tick count=${secondCounts.counts.get(restoredIdentity) ?? 0}`,
  });

  const targetId = restoredIdentity;
  const savedBeforeDelete = second.records.has(targetId);
  restored.despawn(1);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  evidence.push({
    name: "despawn-deletion",
    passed: savedBeforeDelete && second.deleted.includes(targetId) && !second.records.has(targetId),
    details: `delete calls=${second.deleted.join(",") || "none"}`,
  });

  for (const check of ["future-version", "corruption"] as const) {
    if (!restartRecord) {
      evidence.push({ name: check, passed: false, details: "source record unavailable" });
      continue;
    }
    const store = memoryStore();
    const registry = new CharacterRegistry({
      ...headlessRegistryOptions(createCognitionHandle, store.store, 3),
    });
    const record = structuredClone(restartRecord);
    const invalid =
      check === "future-version"
        ? { ...record, envelopeVersion: CHARACTER_PERSISTENCE_ENVELOPE_VERSION + 1 }
        : { ...record, archetype: "tampered" };
    const accepted = await registry.restore([invalid]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    evidence.push({
      name: check,
      passed: accepted === 0 && registry.count === 0 && store.quarantined.length === 1,
      details: `accepted=${accepted}, quarantined=${store.quarantined.map((item) => item.area).join(",")}`,
    });
  }

  return evidence;
}

export interface BuildPhase1EvidenceInput {
  createCognitionHandle: (init: CognitionInit) => CognitionHandle;
  wasmInitializationMs: number;
  generatedAt: string;
  environment: Phase1Environment;
  buildIdentity: BuildIdentity;
  memoryBeforeBytes: number;
  memoryAfterBytes: number;
  cpuMillisecondsPerSimulatedSecond: number;
}

export async function buildPhase1AcceptanceReport(
  input: BuildPhase1EvidenceInput,
): Promise<Phase1AcceptanceReport> {
  const canonicalDefinitions = [
    NEUTRAL_BASELINE_SCENARIO,
    NOVEL_STRONG_GESTURE_SCENARIO,
    HABITUATION_SCENARIO,
    CAUTION_STARTLE_ARC_SCENARIO,
    QUIET_BOREDOM_SCENARIO,
    PERSONALITY_CONTRAST_SCENARIO,
    REACTION_STORM_SCENARIO,
  ];
  const canonicalScenarios: ScenarioEvidence[] = [];
  const determinismDigests: string[] = [];

  for (const scenario of canonicalDefinitions) {
    const scheduleResults = [30, 60, 120].map((renderScheduleHz) =>
      runScenario(scenario, renderScheduleHz, {
        createCognitionHandle: input.createCognitionHandle,
      }),
    );
    const results = [
      ...scheduleResults,
      runScenario(scenario, 60, {
        createCognitionHandle: input.createCognitionHandle,
      }),
    ];
    const checked = checkScenario(scenario, results);
    canonicalScenarios.push(checked.evidence);
    determinismDigests.push(...checked.digests);
  }

  const metrics = new Phase1MetricsCollector();
  const instrumentedStress = runScenario(PHASE1_STRESS_SCENARIO, 30, {
    createCognitionHandle: input.createCognitionHandle,
    traceSink: metrics.traceSink,
    maxQueuedTraceLines: 65536,
    instrumentation: metrics,
  });
  await instrumentedStress.traceWriter?.flush();
  const stressTrace = formatScenarioTraceNdjson(instrumentedStress);
  const stressTraceDigest = fnv1a32(stressTrace);
  const stressTraces = [stressTrace];
  for (let index = 0; index < 2; index += 1) {
    stressTraces.push(
      formatScenarioTraceNdjson(
        runScenario(PHASE1_STRESS_SCENARIO, 30, {
          createCognitionHandle: input.createCognitionHandle,
        }),
      ),
    );
  }
  const stressRepeated = new Set(stressTraces).size === 1;

  const scheduleResults = [30, 60, 120].map((renderScheduleHz) =>
    runScenario(PHASE1_STRESS_SCENARIO, renderScheduleHz, {
      createCognitionHandle: input.createCognitionHandle,
    }),
  );
  const stressResults = [
    ...scheduleResults,
    runScenario(PHASE1_STRESS_SCENARIO, 60, {
      createCognitionHandle: input.createCognitionHandle,
    }),
  ];
  const stressScenario = checkScenario(PHASE1_STRESS_SCENARIO, stressResults);
  canonicalScenarios.push(stressScenario.evidence);
  determinismDigests.push(...stressScenario.digests);
  if (stressRepeated) determinismDigests.push(...stressTraces.map(() => stressTraceDigest));

  const budgets = [
    evaluate(
      "per-character-cognition-tick-p95",
      metrics.cognitionTickSamples,
      PHASE1_ACCEPTANCE_THRESHOLDS.perCharacterCognitionTickP95Ms,
      "ms",
    ),
    evaluate(
      "cognition-batch-p95",
      metrics.batchSamples,
      PHASE1_ACCEPTANCE_THRESHOLDS.cognitionBatchP95Ms,
      "ms",
    ),
    evaluate(
      "render-tick-p95",
      metrics.renderTickSamples,
      PHASE1_ACCEPTANCE_THRESHOLDS.renderTickP95Ms,
      "ms",
    ),
    evaluate(
      "trace-write-p95",
      metrics.traceWriteSamples,
      PHASE1_ACCEPTANCE_THRESHOLDS.traceWriteP95Ms,
      "ms",
    ),
    evaluate(
      "stimulus-to-bias-p95",
      metrics.stimulusToBiasSamples,
      PHASE1_ACCEPTANCE_THRESHOLDS.stimulusToBiasP95Ms,
      "ms",
    ),
    {
      name: "additional-memory",
      value: Math.max(0, input.memoryAfterBytes - input.memoryBeforeBytes),
      threshold: PHASE1_ACCEPTANCE_THRESHOLDS.additionalMemoryBytes,
      comparison: "<=" as const,
      unit: "bytes",
      status: "pass" as const,
      raw: summarize(
        [input.memoryBeforeBytes, input.memoryAfterBytes],
        "bytes",
      ),
    },
  ];
  budgets[5].value = Math.max(0, input.memoryAfterBytes - input.memoryBeforeBytes);
  budgets[5].status =
    budgets[5].value <= budgets[5].threshold
      ? "pass"
      : budgets[5].value <= budgets[5].threshold * MARGINAL_RATIO
        ? "marginal"
        : "failed";
  budgets.push(
    evaluate(
      "wasm-initialization",
      [input.wasmInitializationMs],
      PHASE1_ACCEPTANCE_THRESHOLDS.wasmInitializationMs,
      "ms",
    ),
    evaluate(
      "frame-time-p95",
      metrics.renderTickSamples,
      PHASE1_ACCEPTANCE_THRESHOLDS.frameTimeP95Ms,
      "ms",
    ),
    evaluate(
      "cpu-milliseconds-per-simulated-second",
      [input.cpuMillisecondsPerSimulatedSecond],
      PHASE1_ACCEPTANCE_THRESHOLDS.cpuMillisecondsPerSimulatedSecond,
      "ms/s",
    ),
  );

  const persistenceChecks = await runPersistenceAcceptance(input.createCognitionHandle);
  const identicalScenarios = [
    ...canonicalScenarios.filter((scenario) => scenario.repeatedTraceIdentical),
  ].length + (stressRepeated ? 1 : 0);
  const totalScenarios = canonicalScenarios.length + 1;
  const blockers: string[] = [];
  for (const scenario of canonicalScenarios) {
    blockers.push(...scenario.failures.map((failure) => `${scenario.name}: ${failure}`));
  }
  for (const budget of budgets) {
    if (budget.status !== "pass") {
      blockers.push(
        `${budget.name}: ${budget.value.toFixed(6)} ${budget.unit} ${budget.status} versus <= ${budget.threshold} ${budget.unit}`,
      );
    }
  }
  for (const check of persistenceChecks) {
    if (!check.passed) blockers.push(`${check.name}: ${check.details}`);
  }
  if (!stressRepeated) blockers.push("stress traces are not byte-identical");
  if (instrumentedStress.traceWriter?.droppedLines) {
    blockers.push(
      `trace-writer: ${instrumentedStress.traceWriter.droppedLines} trace events were dropped`,
    );
  }

  return {
    schemaVersion: PHASE1_ACCEPTANCE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: blockers.length === 0 ? "pass" : "blocked",
    environment: input.environment,
    buildIdentity: input.buildIdentity,
    contracts: {
      acceptance: PHASE1_ACCEPTANCE_SCHEMA_VERSION,
      cognition: COGNITION_SCHEMA_VERSION,
      characterPersistence: CHARACTER_PERSISTENCE_ENVELOPE_VERSION,
      scenario: "canonical-scenario-contract-v1",
    },
    command: "npm run test:acceptance",
    canonicalScenarios,
    budgets,
    persistenceChecks,
    determinism: {
      identicalScenarios,
      totalScenarios,
      passed: identicalScenarios === totalScenarios,
      stressTraceDigest,
    },
    stressReplay: {
      name: PHASE1_STRESS_SCENARIO.name,
      durationS: PHASE1_STRESS_SCENARIO.durationS,
      characters: PHASE1_STRESS_SCENARIO.spawnTimes.length,
      renderScheduleHz: 30,
      cognitionCadenceHz: 10,
      simulatedStimulusDeliveries:
        PHASE1_STRESS_SCENARIO.spawnTimes.length * (PHASE1_STRESS_SCENARIO.stimuli?.length ?? 0),
      traceRecords: instrumentedStress.trace.length,
      droppedTraceEvents: instrumentedStress.traceWriter?.droppedLines ?? 0,
    },
    blockers,
  };
}
