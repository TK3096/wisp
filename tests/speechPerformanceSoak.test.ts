import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SPEECH_SOAK_THRESHOLDS,
  buildSpeechPerformanceSoakReport,
} from "../src/speechPerformanceSoak";

describe("generated Speech performance soak", () => {
  it("pins the accepted deterministic scenario shape and budgets", () => {
    expect(SPEECH_SOAK_THRESHOLDS).toMatchObject({
      characters: 8,
      durationS: 300,
      renderScheduleHz: 30,
      frameOverheadP95Ms: 0.05,
      speechCausedFrameMaxMs: 5,
      lexiconBudgetBytes: 128 * 1024,
      recentExpressionMax: 8,
      pairedReplays: 3,
    });
    expect(statSync("src/speech/lexicon.json").size).toBeLessThanOrEqual(
      SPEECH_SOAK_THRESHOLDS.lexiconBudgetBytes,
    );
  });

  it("passes paired speech-on/speech-off five-minute acceptance gates", () => {
    const report = buildSpeechPerformanceSoakReport({
      generatedAt: "2026-01-01T00:00:00.000Z",
      lexiconBytes: statSync("src/speech/lexicon.json").size,
    });

    expect(report.scenario).toEqual({
      name: "phase2-social-soak-8x300",
      durationS: 300,
      characters: 8,
      renderScheduleHz: 30,
    });
    expect(report.metrics.pairedReplays).toBe(3);
    expect(report.metrics.pairedFrameOverhead.count).toBe(9_000);
    expect(report.metrics.pairedFrameOverhead.p95).toBeLessThanOrEqual(0.05);
    expect(report.metrics.pairedFrameOverhead.max).toBeLessThanOrEqual(5);
    expect(report.metrics.generationCost.max).toBeLessThanOrEqual(5);
    expect(report.metrics.lexiconBytes).toBeLessThanOrEqual(128 * 1024);
    expect(report.metrics.recentExpressionContext).toEqual({
      largestRequest: expect.any(Number),
      acceptedBound: 8,
    });
    expect(report.metrics.recentExpressionContext.largestRequest).toBeLessThan(8);

    const gateByName = new Map(report.gates.map((gate) => [gate.name, gate]));
    for (const name of [
      "deterministic-speech-on-replay",
      "five-minute-eight-character-soak",
      "speech-independent-behavior",
      "generated-speech-active",
      "paired-frame-overhead-p95",
      "no-speech-caused-frame-budget-breach",
      "packaged-lexicon-budget",
      "bounded-recent-expression-context",
    ]) {
      expect(gateByName.get(name)?.status).toBe("pass");
    }
    expect(report.blockers).toEqual([]);
    expect(report.status).toBe("pass");

    const outputPath = process.env.SPEECH_SOAK_OUTPUT;
    if (outputPath) {
      mkdirSync(new URL(".", `file://${outputPath}`).pathname, { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  }, 60_000);
});
