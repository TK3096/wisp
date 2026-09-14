import { createGeneratedSpeechHandle } from "./speech/generator";
import {
  MAX_RECENT_EXPRESSIONS,
  SpeechHandle,
  SpeechHandleInit,
  SpeechRequest,
} from "./speech";
import {
  PHASE2_SOCIAL_SOAK_SCENARIO,
  ScenarioDefinition,
  ScenarioResult,
  runScenario,
  scenarioBehaviorDecisions,
  scenarioCognitionSteps,
  scenarioExpressionRecords,
  stableStringify,
} from "./scenarioHarness";

export const SPEECH_SOAK_SCHEMA_VERSION = 1;

/** Accepted by issue #68 and implemented by issue #83. */
export const SPEECH_SOAK_THRESHOLDS = {
  characters: 8,
  durationS: 300,
  renderScheduleHz: 30,
  frameOverheadP95Ms: 0.05,
  speechCausedFrameMaxMs: 5,
  lexiconBudgetBytes: 128 * 1024,
  recentExpressionMax: MAX_RECENT_EXPRESSIONS,
  pairedReplays: 3,
} as const;

export interface SpeechSoakMeasurement {
  readonly count: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly unit: "ms";
}

export interface SpeechSoakEvidence {
  readonly name: string;
  readonly status: "pass" | "failed";
  readonly details: string;
}

export interface SpeechSoakMetrics {
  readonly pairedFrameOverhead: SpeechSoakMeasurement;
  readonly generationCost: SpeechSoakMeasurement;
  readonly generationCalls: number;
  readonly expressions: {
    readonly total: number;
    readonly generated: number;
    readonly substituted: number;
    readonly charactersRepresented: number;
  };
  readonly lexiconBytes: number;
  readonly recentExpressionContext: {
    readonly largestRequest: number;
    readonly acceptedBound: number;
  };
  readonly pairedReplays: number;
}

export interface SpeechSoakAcceptanceReport {
  readonly schemaVersion: typeof SPEECH_SOAK_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly status: "pass" | "failed";
  readonly scenario: {
    readonly name: string;
    readonly durationS: number;
    readonly characters: number;
    readonly renderScheduleHz: number;
  };
  readonly thresholds: typeof SPEECH_SOAK_THRESHOLDS;
  readonly metrics: SpeechSoakMetrics;
  readonly gates: SpeechSoakEvidence[];
  readonly blockers: string[];
}

export interface SpeechSoakAcceptanceInput {
  generatedAt?: string;
  soakScenario?: ScenarioDefinition;
  lexiconBytes: number;
  pairedReplays?: number;
}

interface RunCollection {
  readonly frameDurationsMs: number[];
  readonly generationCostsByKey: Map<string, number[]>;
  largestRequestContext: number;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

function measure(values: readonly number[]): SpeechSoakMeasurement {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  return {
    count: finite.length,
    min: finite[0] ?? Number.NaN,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    max: finite[finite.length - 1] ?? Number.NaN,
    unit: "ms",
  };
}

function evidence(
  name: string,
  passed: boolean,
  details: string,
): SpeechSoakEvidence {
  return {
    name,
    status: passed ? "pass" : "failed",
    details,
  };
}

function newCollection(frameCount: number): RunCollection {
  return {
    frameDurationsMs: new Array<number>(frameCount),
    generationCostsByKey: new Map(),
    largestRequestContext: 0,
  };
}

function instrumentedGeneratedSpeech(
  init: SpeechHandleInit,
  collection: RunCollection,
): SpeechHandle {
  const inner = createGeneratedSpeechHandle(init);
  const recordCost = (
    request: SpeechRequest,
    durationMs: number,
  ): void => {
    collection.largestRequestContext = Math.max(
      collection.largestRequestContext,
      request.context.recentExpressions.length,
    );
    const key = `${init.characterId}:${request.seed}`;
    const costs = collection.generationCostsByKey.get(key) ?? [];
    costs.push(durationMs);
    collection.generationCostsByKey.set(key, costs);
  };

  return {
    voiceProfileVersion: inner.voiceProfileVersion,
    generateWithAttemptCount(request: SpeechRequest) {
      const startedAtMs = performance.now();
      const attempt = inner.generateWithAttemptCount?.(request) ?? {
        expression: null,
        attempts: 1,
      };
      recordCost(request, performance.now() - startedAtMs);
      return attempt;
    },
    generate(request: SpeechRequest) {
      return this.generateWithAttemptCount?.(request).expression ?? null;
    },
  };
}

function expressionOpportunities(result: ScenarioResult): unknown[] {
  return scenarioExpressionRecords(result).map((record) => ({
    characterId: record.characterId,
    occasion: record.occasion,
    expressionOrdinal: record.expressionOrdinal,
  }));
}

function behaviorShape(result: ScenarioResult): unknown[] {
  return scenarioBehaviorDecisions(result).map((decision) =>
    decision.type === "bubble_started"
      ? {
          type: decision.type,
          characterId: decision.characterId,
          reason: decision.reason,
        }
      : decision,
  );
}

function traceDigest(result: ScenarioResult): string {
  // Hash the canonical serialization incrementally to avoid retaining another
  // full five-minute trace string while the acceptance replay is in scope.
  let digestState = 0x811c9dc5;
  for (const record of result.trace) {
    const line = stableStringify(record);
    for (let index = 0; index < line.length; index += 1) {
      digestState ^= line.charCodeAt(index);
      digestState = Math.imul(digestState, 0x01000193);
    }
    digestState ^= 0x0a;
    digestState = Math.imul(digestState, 0x01000193);
  }
  return (digestState >>> 0).toString(16).padStart(8, "0");
}

function cognitionDigest(result: ScenarioResult): string {
  let digestState = 0x811c9dc5;
  for (const step of scenarioCognitionSteps(result)) {
    const line = stableStringify(step);
    for (let index = 0; index < line.length; index += 1) {
      digestState ^= line.charCodeAt(index);
      digestState = Math.imul(digestState, 0x01000193);
    }
    digestState ^= 0x0a;
    digestState = Math.imul(digestState, 0x01000193);
  }
  return (digestState >>> 0).toString(16).padStart(8, "0");
}

function perExpressionCosts(
  collection: RunCollection,
): number[] {
  return [...collection.generationCostsByKey.values()].map((costs) =>
    Math.min(...costs),
  );
}

/**
 * Replay the accepted five-minute soak as paired speech-on/speech-off runs.
 * Multiple pairs take the minimum matched-frame delta and the minimum cost for
 * each deterministic expression: host scheduling and GC remain outside the
 * speech attribution while still exercising the full five-minute soak. Wall
 * times never enter Scenario Harness traces.
 */
export function buildSpeechPerformanceSoakReport(
  input: SpeechSoakAcceptanceInput,
): SpeechSoakAcceptanceReport {
  const scenario = input.soakScenario ?? PHASE2_SOCIAL_SOAK_SCENARIO;
  const pairedReplays = input.pairedReplays ??
    SPEECH_SOAK_THRESHOLDS.pairedReplays;
  const frameCount = Math.ceil(
    scenario.durationS * SPEECH_SOAK_THRESHOLDS.renderScheduleHz,
  );
  // Warm the generator and timing path before the measured paired replays.
  runScenario(
    {
      ...scenario,
      name: `${scenario.name}-speech-warmup`,
      durationS: 2.2,
      stimuli: [],
      despawns: [],
    },
    SPEECH_SOAK_THRESHOLDS.renderScheduleHz,
    { createSpeechHandle: createGeneratedSpeechHandle },
  );

  const collections: RunCollection[] = [];
  const minimumMatchedOverhead = new Array<number>(frameCount).fill(
    Number.POSITIVE_INFINITY,
  );
  let primaryOnResult: ScenarioResult | null = null;
  let primaryOnDigest = "";
  let repeatedOnDigest = "";
  let firstOffResult: ScenarioResult | null = null;

  for (let replay = 0; replay < pairedReplays; replay += 1) {
    const onCollection = newCollection(frameCount);
    collections.push(onCollection);
    const onResult = runScenario(scenario, SPEECH_SOAK_THRESHOLDS.renderScheduleHz, {
      createSpeechHandle: (init) =>
        instrumentedGeneratedSpeech(init, onCollection),
      instrumentation: {
        onRenderTick: (durationMs, renderTick) => {
          onCollection.frameDurationsMs[renderTick] = durationMs;
        },
      },
    });
    const onDigest = traceDigest(onResult);
    if (replay === 0) {
      primaryOnResult = onResult;
      primaryOnDigest = onDigest;
    } else if (replay === 1) {
      repeatedOnDigest = onDigest;
    }

    const offFrames = new Array<number>(frameCount);
    const offResult = runScenario(scenario, SPEECH_SOAK_THRESHOLDS.renderScheduleHz, {
      instrumentation: {
        onRenderTick: (durationMs, renderTick) => {
          offFrames[renderTick] = durationMs;
        },
      },
    });
    if (replay === 0) firstOffResult = offResult;

    for (let renderTick = 0; renderTick < frameCount; renderTick += 1) {
      minimumMatchedOverhead[renderTick] = Math.min(
        minimumMatchedOverhead[renderTick],
        onCollection.frameDurationsMs[renderTick] -
          offFrames[renderTick],
      );
    }
  }

  const primary = primaryOnResult;
  const off = firstOffResult;
  if (!primary || !off) throw new Error("Speech soak did not complete a paired replay");

  const frameOverhead = minimumMatchedOverhead
    .filter(Number.isFinite)
    .map((overhead) => Math.max(0, overhead));
  const generationCosts = collections.flatMap(perExpressionCosts);
  const expressions = scenarioExpressionRecords(primary);
  const characterOrdinals = new Map<string, number>();
  for (const expression of expressions) {
    characterOrdinals.set(
      expression.characterId,
      Math.max(
        characterOrdinals.get(expression.characterId) ?? 0,
        expression.expressionOrdinal,
      ),
    );
  }
  const generatedCount = expressions.filter(
    (expression) => expression.status === "generated",
  ).length;
  const largestRequestContext = Math.max(
    0,
    ...collections.map((collection) => collection.largestRequestContext),
  );
  const pairedOverheadMeasurement = measure(frameOverhead);
  const generationMeasurement = measure(generationCosts);
  const frameP95Pass = pairedOverheadMeasurement.p95 <=
    SPEECH_SOAK_THRESHOLDS.frameOverheadP95Ms;
  const speechFrameMaxPass = pairedOverheadMeasurement.max <=
      SPEECH_SOAK_THRESHOLDS.speechCausedFrameMaxMs &&
    generationMeasurement.max <= SPEECH_SOAK_THRESHOLDS.speechCausedFrameMaxMs;
  const sizePass = input.lexiconBytes <= SPEECH_SOAK_THRESHOLDS.lexiconBudgetBytes;
  const contextPass = largestRequestContext + 1 <=
    SPEECH_SOAK_THRESHOLDS.recentExpressionMax;
  const materialized = primary.trace.filter(
    (record) => record.type === "character_materialized",
  ).length;
  const soakShapePass = materialized === SPEECH_SOAK_THRESHOLDS.characters &&
    primary.scenario.durationS === SPEECH_SOAK_THRESHOLDS.durationS;
  const opportunitiesPass = expressionOpportunities(primary).length > 0 &&
    stableStringify(expressionOpportunities(primary)) ===
      stableStringify(expressionOpportunities(off)) &&
    stableStringify(behaviorShape(primary)) === stableStringify(behaviorShape(off));
  const cognitionPass = cognitionDigest(primary) === cognitionDigest(off);
  const generatedActivePass = generatedCount > 0 &&
    characterOrdinals.size === SPEECH_SOAK_THRESHOLDS.characters &&
    [...characterOrdinals.values()].every((ordinal) => ordinal > 0);

  const gates: SpeechSoakEvidence[] = [
    evidence(
      "deterministic-speech-on-replay",
      primaryOnDigest === repeatedOnDigest,
      `canonical speech-on digest ${primaryOnDigest}; repeat digest ${repeatedOnDigest}`,
    ),
    evidence(
      "five-minute-eight-character-soak",
      soakShapePass,
      `${materialized} characters for ${primary.scenario.durationS}s`,
    ),
    evidence(
      "speech-independent-behavior",
      opportunitiesPass && cognitionPass,
      `matched ${expressions.length} opportunities; cognition ${
        cognitionPass ? "identical" : "different"
      }`,
    ),
    evidence(
      "generated-speech-active",
      generatedActivePass,
      `${generatedCount}/${expressions.length} generated across ${characterOrdinals.size} voices`,
    ),
    evidence(
      "paired-frame-overhead-p95",
      frameP95Pass,
      `p95 ${pairedOverheadMeasurement.p95.toFixed(6)} ms <= ${
        SPEECH_SOAK_THRESHOLDS.frameOverheadP95Ms
      } ms`,
    ),
    evidence(
      "no-speech-caused-frame-budget-breach",
      speechFrameMaxPass,
      `paired-frame max ${pairedOverheadMeasurement.max.toFixed(6)} ms; expression-cost max ${
        generationMeasurement.max.toFixed(6)
      } ms <= ${SPEECH_SOAK_THRESHOLDS.speechCausedFrameMaxMs} ms`,
    ),
    evidence(
      "packaged-lexicon-budget",
      sizePass,
      `${input.lexiconBytes} bytes <= ${SPEECH_SOAK_THRESHOLDS.lexiconBudgetBytes} bytes`,
    ),
    evidence(
      "bounded-recent-expression-context",
      contextPass,
      `largest request context ${largestRequestContext}; accepted bound ${
        SPEECH_SOAK_THRESHOLDS.recentExpressionMax
      }`,
    ),
  ];
  const blockers = gates
    .filter((gate) => gate.status === "failed")
    .map((gate) => `${gate.name}: ${gate.details}`);

  return {
    schemaVersion: SPEECH_SOAK_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: blockers.length === 0 ? "pass" : "failed",
    scenario: {
      name: scenario.name,
      durationS: scenario.durationS,
      characters: scenario.spawnTimes.length,
      renderScheduleHz: SPEECH_SOAK_THRESHOLDS.renderScheduleHz,
    },
    thresholds: SPEECH_SOAK_THRESHOLDS,
    metrics: {
      pairedFrameOverhead: pairedOverheadMeasurement,
      generationCost: generationMeasurement,
      generationCalls: collections.reduce(
        (total, collection) =>
          total +
          [...collection.generationCostsByKey.values()].reduce(
            (calls, costs) => calls + costs.length,
            0,
          ),
        0,
      ),
      expressions: {
        total: expressions.length,
        generated: generatedCount,
        substituted: expressions.length - generatedCount,
        charactersRepresented: characterOrdinals.size,
      },
      lexiconBytes: input.lexiconBytes,
      recentExpressionContext: {
        largestRequest: largestRequestContext,
        acceptedBound: SPEECH_SOAK_THRESHOLDS.recentExpressionMax,
      },
      pairedReplays,
    },
    gates,
    blockers,
  };
}
