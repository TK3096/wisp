import { describe, expect, it } from "vitest";
import {
  BASELINE_SCENARIO,
  FEEDBACK_REWARD_SCENARIO,
  TONE_WEIGHTED_SPEECH_SCENARIO,
  HABITUATION_SCENARIO,
  NOVEL_STRONG_GESTURE_SCENARIO,
  PHASE1_STRESS_SCENARIO,
  formatScenarioTraceNdjson,
  runScenario,
  LossyTraceWriter,
  scenarioBehaviorDecisions,
  scenarioCognitionSteps,
  SCENARIO_TRACE_SCHEMA_VERSION,
} from "../src/scenarioHarness";
import { EFFECT, GREETINGS, IDLE_LINES } from "../src/config";
import {
  COGNITION_SCHEMA_VERSION,
  CognitionHandle,
  NEUTRAL_BEHAVIOR_SIGNAL,
} from "../src/cognition";

describe("Scenario Harness baseline", () => {
  it("collects optional wall-clock metrics without changing canonical traces", () => {
    const renderTicks: number[] = [];
    const cognitionTicks: number[] = [];
    const stimulusLatencies: number[] = [];
    const run = (withInstrumentation: boolean) =>
      runScenario(BASELINE_SCENARIO, 60, {
        instrumentation: withInstrumentation
          ? {
              onRenderTick: (durationMs) => renderTicks.push(durationMs),
              onCognitionTick: (_id, durationMs) => cognitionTicks.push(durationMs),
              onStimulusToBias: (_id, durationMs) => stimulusLatencies.push(durationMs),
            }
          : undefined,
      });

    const uninstrumented = run(false);
    const instrumented = run(true);
    const withoutMetrics = run(false);

    expect(renderTicks).toHaveLength(Math.ceil(BASELINE_SCENARIO.durationS * 60));
    expect(cognitionTicks.length).toBeGreaterThan(0);
    expect(stimulusLatencies.length).toBeGreaterThanOrEqual(1);
    expect(renderTicks.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
    expect(formatScenarioTraceNdjson(uninstrumented)).toBe(
      formatScenarioTraceNdjson(withoutMetrics),
    );
    expect(formatScenarioTraceNdjson(instrumented)).toBe(
      formatScenarioTraceNdjson(withoutMetrics),
    );
  });

  it("defines the deterministic 120-second, eight-character stress replay", () => {
    expect(PHASE1_STRESS_SCENARIO.durationS).toBe(120);
    expect(PHASE1_STRESS_SCENARIO.spawnTimes).toHaveLength(8);
    expect(PHASE1_STRESS_SCENARIO.personalitySeeds).toHaveLength(8);
    expect(PHASE1_STRESS_SCENARIO.stimuli).toHaveLength(1_190);
    expect(PHASE1_STRESS_SCENARIO.stimuli?.at(-1)?.atS).toBe(119.9);

    const first = runScenario(PHASE1_STRESS_SCENARIO, 30);
    const second = runScenario(PHASE1_STRESS_SCENARIO, 30);
    expect(formatScenarioTraceNdjson(first)).toBe(formatScenarioTraceNdjson(second));
    expect(first.trace.filter((record) => record.type === "character_materialized")).toHaveLength(8);
    expect(first.trace.filter((record) => record.type === "stimulus_observed")).toHaveLength(
      8 * 1_191,
    );
    expect(
      first.trace.filter(
        (record) =>
          record.type === "stimulus_observed" &&
          (record.envelope as { stimulus: { kind: string } }).stimulus.kind === "gesture",
      ),
    ).toHaveLength(8 * 1_190);
  });

  it("replays the current spawn, wander, jump, bubble, and despawn behavior", () => {
    const result = runScenario(BASELINE_SCENARIO, 60);
    const types = new Set(result.trace.map((record) => record.type));

    expect(types).toContain("spawn_effect_started");
    expect(types).toContain("character_materialized");
    expect(types).toContain("animation_changed");
    expect(types).toContain("jump_started");
    expect(types).toContain("bubble_started");
    expect(types).toContain("stimulus_dispatch");
    expect(types).toContain("cognition_step");
    expect(types).toContain("scheduler_roll");
    expect(types).toContain("character_vanished");

    const animations = result.trace
      .filter((record) => record.type === "animation_changed")
      .map((record) => record.to);
    expect(animations).toContain("idle");
    expect(animations).toContain("walk");

    const schedulerRolls = result.trace
      .filter((record) => record.type === "scheduler_roll")
      .map((record) => record.value);
    expect(schedulerRolls).toEqual([0.5, 0.5, 0.1]);

    expect(
      result.trace.find((record) => record.type === "stimulus_dispatch"),
    ).toMatchObject({
      envelope: BASELINE_SCENARIO.stimuli?.[0]?.envelope,
      recipientIds: ["baseline-character-1"],
    });

    const materialized = result.trace.find(
      (record) => record.type === "character_materialized",
    );
    expect(materialized).toMatchObject({
      scenarioName: BASELINE_SCENARIO.name,
      seed: BASELINE_SCENARIO.seed,
      contractVersion: SCENARIO_TRACE_SCHEMA_VERSION,
      characterId: "baseline-character-1",
      archetype: "baseline",
    });
    expect(materialized?.clockS).toBeGreaterThanOrEqual(EFFECT.FRAME_COUNT / EFFECT.FPS);

    const bubbles = result.trace.filter(
      (record) => record.type === "bubble_started",
    );
    expect(bubbles.map((record) => record.reason)).toEqual(["greeting", "idle"]);
    expect(bubbles[0]).toMatchObject({
      text: GREETINGS[0].text,
      characterId: "baseline-character-1",
    });
    expect(bubbles[1]).toMatchObject({
      text: IDLE_LINES[3].text,
      tone: "cheerful",
      characterId: "baseline-character-1",
    });
  });

  it("records canonical NDJSON traces without exposing Cognition State internals", () => {
    const first = runScenario(BASELINE_SCENARIO, 60);
    const second = runScenario(BASELINE_SCENARIO, 60);
    const cognitionStep = first.trace.find(
      (record) => record.type === "cognition_step",
    );

    expect(cognitionStep).toMatchObject({
      behaviorSignal: {
        affect: { surprise: 0, valence: 0, arousal: 0 },
        behaviorBias: {
          idleDwell: 1,
          walkSpeed: 1,
          jumpChance: 1,
          bubbleChance: 1,
          animationPace: 1,
        },
      },
      appliedBiases: {
        idleDwell: 1,
        walkSpeed: 1,
        jumpChance: 1,
        bubbleChance: 1,
        animationPace: 1,
      },
    });
    expect(cognitionStep?.cognitionState).toMatchObject({
      schemaVersion: COGNITION_SCHEMA_VERSION,
      digest: expect.stringMatching(/^[0-9a-f]{8}$/),
      bytes: 4,
    });
    expect(Object.keys(cognitionStep ?? {})).not.toContain("cognition");

    const firstTrace = formatScenarioTraceNdjson(first);
    const secondTrace = formatScenarioTraceNdjson(second);
    expect(firstTrace.endsWith("\n")).toBe(true);
    expect(firstTrace.split("\n").filter(Boolean)).toHaveLength(first.trace.length);
    expect(secondTrace).toBe(firstTrace);
  });

  it("produces equivalent cognition and behavior decisions at 30, 60, and 120 fps", () => {
    const cognitionSteps: unknown[][] = [];
    const decisions: unknown[][] = [];

    for (const framesPerSecond of [30, 60, 120]) {
      const result = runScenario(BASELINE_SCENARIO, framesPerSecond);
      cognitionSteps.push(scenarioCognitionSteps(result));
      decisions.push(scenarioBehaviorDecisions(result));
    }

    expect(cognitionSteps[1]).toEqual(cognitionSteps[0]);
    expect(cognitionSteps[2]).toEqual(cognitionSteps[0]);
    expect(decisions[1]).toEqual(decisions[0]);
    expect(decisions[2]).toEqual(decisions[0]);
  });

  it("shows legible differences from contrasting personality seeds without moving scheduler ownership", () => {
    const createCognitionHandle = ({
      personalitySeed,
    }: {
      personalitySeed: number;
    }): CognitionHandle => ({
      observe() {},
      toneSeed: () => ({
        personality: NEUTRAL_BEHAVIOR_SIGNAL.personality,
        affect: NEUTRAL_BEHAVIOR_SIGNAL.affect,
      }),
      tick() {
        const active = personalitySeed === 0;
        return {
          personality: NEUTRAL_BEHAVIOR_SIGNAL.personality,
          affect: { surprise: 0, valence: 0, arousal: 0 },
          temporalSurprise: NEUTRAL_BEHAVIOR_SIGNAL.temporalSurprise,
          microBelief: NEUTRAL_BEHAVIOR_SIGNAL.microBelief,
          reaction: NEUTRAL_BEHAVIOR_SIGNAL.reaction,
          behaviorBias: active
            ? {
                idleDwell: 0.5,
                walkSpeed: 1.5,
                jumpChance: 1,
                bubbleChance: 1,
                animationPace: 1,
              }
            : {
                idleDwell: 1.5,
                walkSpeed: 0.5,
                jumpChance: 0,
                bubbleChance: 0,
                animationPace: 1,
              },
        };
      },
      noteExpression() {},
      snapshot() {
        return {
          schemaVersion: COGNITION_SCHEMA_VERSION,
          characterId: "ignored",
          cognition: null,
        };
      },
      restore() {},
    });
    const scenarioWithSeed = (personalitySeed: number) => ({
      ...BASELINE_SCENARIO,
      name: `personality-${personalitySeed}`,
      personalitySeeds: [personalitySeed],
    });
    const quick = runScenario(scenarioWithSeed(0), 60, { createCognitionHandle });
    const deliberate = runScenario(scenarioWithSeed(4294967295), 60, {
      createCognitionHandle,
    });
    const quickDecisions = scenarioBehaviorDecisions(quick);
    const deliberateDecisions = scenarioBehaviorDecisions(deliberate);

    const walkCount = (decisions: ReturnType<typeof scenarioBehaviorDecisions>) =>
      decisions.filter(
        (decision) =>
          decision.type === "animation_changed" && decision.to === "walk",
      ).length;
    expect(walkCount(quickDecisions)).toBeGreaterThan(walkCount(deliberateDecisions));
    expect(quickDecisions.some((decision) => decision.type === "jump_started")).toBe(true);
    expect(deliberateDecisions.some((decision) => decision.type === "jump_started")).toBe(false);
    expect(quickDecisions.some((decision) => decision.type === "bubble_started" && decision.reason === "idle")).toBe(true);
    expect(deliberateDecisions.some((decision) => decision.type === "bubble_started" && decision.reason === "idle")).toBe(false);
  });

  it("writes traces without blocking and drops oldest queued lines under pressure", async () => {
    const written: string[] = [];
    let releaseFirstWrite!: () => void;
    const sink = (line: string) => {
      written.push(line);
      if (written.length === 1) {
        return new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
    };
    const writer = new LossyTraceWriter(sink, { maxQueuedLines: 2 });

    writer.write({ id: 1 });
    writer.write({ id: 2 });
    writer.write({ id: 3 });
    writer.write({ id: 4 });

    expect(written).toEqual(['{"id":1}\n']);
    expect(writer.droppedLines).toBe(1);

    releaseFirstWrite();
    await writer.flush();

    expect(written).toEqual(['{"id":1}\n', '{"id":3}\n', '{"id":4}\n']);
    expect(writer.droppedLines).toBe(1);
  });

  it("keeps the replay running while its configured trace sink is blocked", async () => {
    const written: string[] = [];
    let releaseFirstWrite!: () => void;
    const result = runScenario(BASELINE_SCENARIO, 60, {
      maxQueuedTraceLines: 2,
      traceSink: (line) => {
        written.push(line);
        if (written.length === 1) {
          return new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
          });
        }
      },
    });

    expect(result.trace.length).toBeGreaterThan(3);
    expect(written).toHaveLength(1);
    expect(result.traceWriter?.droppedLines).toBeGreaterThan(0);

    releaseFirstWrite();
    await result.traceWriter?.flush();

    expect(written).toHaveLength(result.trace.length - result.traceWriter.droppedLines);
  });
});

describe("Temporal Derivative acceptance scenarios", () => {
  const sigmoid = (value: number): number =>
    value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

  /** Deterministic TypeScript reference used to test harness wiring, not math. */
  function createTemporalMockCognition(): CognitionHandle {
    let observation = [0, 1, 0];
    let fast = [0, 1, 0];
    let slow = [0, 1, 0];
    let surprise = 0;
    let arousal = 0;

    const summary = () => {
      const derivativeNorm = Math.sqrt(
        fast.reduce((total, value, index) => total + (value - slow[index]) ** 2, 0),
      );
      const gate = sigmoid(4 * derivativeNorm);
      return {
        derivativeNorm,
        gate,
        centeredEnergy: Math.min(1, Math.max(0, 2.6 * (gate - 0.5))),
      };
    };

    return {
      observe(stimulus) {
        if (stimulus.kind === "gesture") observation[0] = stimulus.confidence;
      },
      toneSeed: () => ({
        personality: NEUTRAL_BEHAVIOR_SIGNAL.personality,
        affect: NEUTRAL_BEHAVIOR_SIGNAL.affect,
      }),
      tick(dt) {
        const previousEnergy = summary().centeredEnergy;
        fast = fast.map((value, index) => value + 0.3 * (observation[index] - value));
        slow = slow.map((value, index) => value + 0.03 * (observation[index] - value));
        const temporal = summary();
        const rise = Math.max(0, temporal.centeredEnergy - previousEnergy);
        surprise = Math.min(1, surprise * Math.exp(-dt / 0.65) + rise);
        arousal = Math.min(1, arousal * Math.exp(-dt / 1.5) + rise);

        return {
          affect: { surprise, valence: 0, arousal },
          personality: NEUTRAL_BEHAVIOR_SIGNAL.personality,
          temporalSurprise: temporal,
          microBelief: NEUTRAL_BEHAVIOR_SIGNAL.microBelief,
          reaction: NEUTRAL_BEHAVIOR_SIGNAL.reaction,
          behaviorBias: {
            idleDwell: 1,
            walkSpeed: 1,
            jumpChance: Math.min(1.8, 0.9346 * (1 + 0.55 * surprise)),
            bubbleChance: 1,
            animationPace: 1,
          },
        };
      },
      noteExpression() {},
      snapshot() {
        return {
          schemaVersion: COGNITION_SCHEMA_VERSION,
          characterId: "temporal-mock",
          cognition: null,
        };
      },
      restore() {},
    };
  }

  /**
   * Event-ordered trace projection. Frame-local interleaving between render
   * ticks legitimately differs by frame rate; stimulus and scheduler order
   * must not.
   */
  function stableTraceEvents(
    records: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return records
      .filter((record) =>
        ["stimulus_dispatch", "stimulus_observed", "scheduler_roll"].includes(
          record.type as string,
        ),
      )
      .map((record) => ({
        type: record.type,
        characterId: record.characterId,
        envelope: record.envelope,
        rollIndex: record.rollIndex,
        value: record.value,
      }));
  }

  it("records a novel gesture reaction that only the scheduler can turn into a jump", () => {
    const result = runScenario(NOVEL_STRONG_GESTURE_SCENARIO, 60, {
      createCognitionHandle: createTemporalMockCognition,
    });
    const steps = scenarioCognitionSteps(result);
    const gestureDispatch = result.trace.find(
      (record) => record.type === "stimulus_dispatch",
    );
    const schedulerRoll = result.trace.find(
      (record) => record.type === "scheduler_roll",
    );
    const schedulerRollIndex = result.trace.findIndex(
      (record) => record.type === "scheduler_roll",
    );
    const jumpStartedIndex = result.trace.findIndex(
      (record) => record.type === "jump_started",
    );
    const beforeGesture = steps.find(
      (step) => (step.elapsedCognitionS ?? 0) < 20,
    ) as (typeof steps)[number];
    const rollStep = steps.find((step) => step.elapsedCognitionS >= 20);

    expect(gestureDispatch).toMatchObject({
      envelope: NOVEL_STRONG_GESTURE_SCENARIO.stimuli?.[0]?.envelope,
      recipientIds: ["novel-strong-gesture-character-1"],
    });
    expect(rollStep?.temporalSurprise).toMatchObject({
      derivativeNorm: expect.any(Number),
      gate: expect.any(Number),
      centeredEnergy: expect.any(Number),
    });
    expect(rollStep?.boundedReaction).toMatchObject({
      surpriseEnergy: expect.any(Number),
      behaviorBias: expect.any(Object),
    });
    expect(
      rollStep?.behaviorSignal.behaviorBias.jumpChance,
    ).toBeGreaterThan(beforeGesture.behaviorSignal.behaviorBias.jumpChance);
    expect(rollStep?.behaviorSignal.behaviorBias.jumpChance).toBeGreaterThanOrEqual(1);
    expect(schedulerRoll).toMatchObject({ value: 0.99 });
    expect(
      (schedulerRoll?.clockS ?? Infinity) > (gestureDispatch?.clockS ?? -Infinity),
    ).toBe(true);
    expect(jumpStartedIndex).toBeGreaterThan(schedulerRollIndex);
  });

  it("declines the same roll after habituation while the gesture keeps arriving", () => {
    const result = runScenario(HABITUATION_SCENARIO, 60, {
      createCognitionHandle: createTemporalMockCognition,
    });
    const steps = scenarioCognitionSteps(result);
    const surprises = steps.map(
      (step) =>
        (step.behaviorSignal as { affect: { surprise: number } }).affect.surprise,
    );
    const gestureObservations = result.trace.filter(
      (record) =>
        record.type === "stimulus_observed" &&
        (record.envelope as { stimulus: { kind: string } }).stimulus.kind ===
          "gesture",
    );
    const schedulerRolls = result.trace.filter(
      (record) => record.type === "scheduler_roll",
    );
    const rollStep = steps.find((step) => step.elapsedCognitionS >= 20);

    expect(gestureObservations).toHaveLength(99);
    expect(Math.max(...surprises)).toBeGreaterThan(0.3);
    expect(surprises[surprises.length - 1]).toBeLessThan(0.05);
    expect(schedulerRolls.map((record) => record.value)).toEqual([0.99, 0.95]);
    expect(rollStep?.behaviorSignal.behaviorBias.jumpChance).toBeLessThan(0.95);
    expect(
      scenarioBehaviorDecisions(result).some(
        (decision) => decision.type === "jump_started",
      ),
    ).toBe(false);
  });

  it("makes a novel gesture visibly stronger than the habituated repetition", () => {
    const options = { createCognitionHandle: createTemporalMockCognition };
    const novel = runScenario(NOVEL_STRONG_GESTURE_SCENARIO, 60, options);
    const habituated = runScenario(HABITUATION_SCENARIO, 60, options);

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

  it("replays both acceptance scenarios equivalently at 30, 60, and 120 fps", () => {
    for (const scenario of [
      NOVEL_STRONG_GESTURE_SCENARIO,
      HABITUATION_SCENARIO,
    ]) {
      const cognitionSteps: unknown[][] = [];
      const decisions: unknown[][] = [];
      const stableEvents: Record<string, unknown>[][] = [];

      for (const framesPerSecond of [30, 60, 120]) {
        const result = runScenario(scenario, framesPerSecond, {
          createCognitionHandle: createTemporalMockCognition,
        });
        cognitionSteps.push(scenarioCognitionSteps(result));
        decisions.push(scenarioBehaviorDecisions(result));
        stableEvents.push(stableTraceEvents(result.trace));
      }

      expect(cognitionSteps[1]).toEqual(cognitionSteps[0]);
      expect(cognitionSteps[2]).toEqual(cognitionSteps[0]);
      expect(decisions[1]).toEqual(decisions[0]);
      expect(decisions[2]).toEqual(decisions[0]);
      expect(stableEvents[1]).toEqual(stableEvents[0]);
      expect(stableEvents[2]).toEqual(stableEvents[0]);
    }
  });
});

describe("reward and tone acceptance scenarios", () => {
  function createRewardMockCognition(): CognitionHandle {
    let clockS = 0;
    let cue: { feedback: "delight" | "dismiss"; expiresAtS: number } | null = null;
    const drift = { energy: 0, sociability: 0 };

    const signal = () => ({
      ...NEUTRAL_BEHAVIOR_SIGNAL,
      personality: {
        ...NEUTRAL_BEHAVIOR_SIGNAL.personality,
        energy: NEUTRAL_BEHAVIOR_SIGNAL.personality.energy + drift.energy,
        sociability: NEUTRAL_BEHAVIOR_SIGNAL.personality.sociability + drift.sociability,
      },
    });

    return {
      observe(stimulus) {
        if (stimulus.kind === "feedback") {
          cue = { feedback: stimulus.feedback, expiresAtS: clockS + 2 };
        }
      },
      toneSeed: () => {
        const current = signal();
        return { personality: current.personality, affect: current.affect };
      },
      tick(dt) {
        clockS += dt;
        if (cue && clockS > cue.expiresAtS) cue = null;
        return signal();
      },
      noteExpression() {
        if (!cue) return;
        const direction = cue.feedback === "delight" ? 1 : -1;
        drift.energy = Math.max(-0.08, Math.min(0.08, drift.energy + direction * 0.04));
        drift.sociability = Math.max(
          -0.08,
          Math.min(0.08, drift.sociability + direction * 0.04),
        );
        cue = null;
      },
      snapshot() {
        return {
          schemaVersion: COGNITION_SCHEMA_VERSION,
          characterId: "reward-mock",
          cognition: null,
        };
      },
      restore() {},
    };
  }

  const nextStepAfter = (
    result: ReturnType<typeof runScenario>,
    clockS: number,
  ) =>
    result.trace.find(
      (record) => record.type === "cognition_step" && record.clockS > clockS,
    );

  it("demonstrates cap, dismissal reversal, and expired-window no-credit", () => {
    const result = runScenario(FEEDBACK_REWARD_SCENARIO, 60, {
      createCognitionHandle: createRewardMockCognition,
    });

    expect(
      result.trace.filter((record) => record.type === "stimulus_dispatch"),
    ).toHaveLength(4);
    expect(
      result.trace.filter((record) => record.type === "expression_noted"),
    ).toHaveLength(4);

    const before = [...result.trace]
      .reverse()
      .find(
        (record) =>
          record.type === "cognition_step" && record.clockS < 30.7166,
      );
    const credited = nextStepAfter(result, 30.7166);
    const capped = nextStepAfter(result, 44.7166);
    const dismissed = nextStepAfter(result, 58.7166);

    expect(before?.behaviorSignal).toMatchObject({
      personality: { energy: 0.5, sociability: 0.5 },
    });
    expect(credited?.behaviorSignal).toMatchObject({
      personality: { energy: 0.54, sociability: 0.54 },
    });
    // The cue at 30.1s expired; the capped event then dismissal reverses one.
    expect(capped?.behaviorSignal).toMatchObject({
      personality: { energy: 0.58, sociability: 0.58 },
    });
    expect(dismissed?.behaviorSignal).toMatchObject({
      personality: { energy: 0.54, sociability: 0.54 },
    });
  });

  it("demonstrates deterministic personality/affect-weighted tone selection", () => {
    const first = runScenario(TONE_WEIGHTED_SPEECH_SCENARIO, 60);
    const second = runScenario(TONE_WEIGHTED_SPEECH_SCENARIO, 60);
    const idle = first.trace.find(
      (record) =>
        record.type === "bubble_started" && record.reason === "idle",
    );

    expect(idle).toMatchObject({ tone: "grumpy" });
    expect(scenarioBehaviorDecisions(first)).toEqual(
      scenarioBehaviorDecisions(second),
    );
  });
});
