import { describe, expect, it } from "vitest";
import {
  BASELINE_SCENARIO,
  formatScenarioTraceNdjson,
  runScenario,
  LossyTraceWriter,
  scenarioBehaviorDecisions,
  scenarioCognitionSteps,
} from "../src/scenarioHarness";
import { EFFECT, GREETINGS, IDLE_LINES } from "../src/config";
import { COGNITION_SCHEMA_VERSION } from "../src/cognition";

describe("Scenario Harness baseline", () => {
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
      contractVersion: COGNITION_SCHEMA_VERSION,
      characterId: "baseline-character-1",
      archetype: "baseline",
    });
    expect(materialized?.clockS).toBeGreaterThanOrEqual(EFFECT.FRAME_COUNT / EFFECT.FPS);

    const bubbles = result.trace.filter(
      (record) => record.type === "bubble_started",
    );
    expect(bubbles.map((record) => record.reason)).toEqual(["greeting", "idle"]);
    expect(bubbles[0]).toMatchObject({
      text: GREETINGS[0],
      characterId: "baseline-character-1",
    });
    expect(bubbles[1]).toMatchObject({
      text: IDLE_LINES[1],
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
