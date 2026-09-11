import { describe, expect, it } from "vitest";
import { stableStringify } from "../src/scenarioHarness";
import { COGNITION_LIVE_DEFAULT_ENABLED } from "../src/config";
import {
  DEFAULT_HUMAN_EVALUATION_CRITERIA,
  HUMAN_EVALUATION_DIMENSIONS,
  assignmentDigest,
  createHumanEvaluationPlan,
  evaluateHumanResults,
  replayIdentity,
  type HumanEvaluationDimension,
  type HumanEvaluationResponse,
} from "../src/humanEvaluation";

const perfectScores = Object.fromEntries(
  HUMAN_EVALUATION_DIMENSIONS.map((dimension) => [dimension, 5]),
) as Record<HumanEvaluationDimension, 1 | 2 | 3 | 4 | 5>;

function responseFor(
  evaluatorId: string,
  overrides: Partial<HumanEvaluationResponse> = {},
): HumanEvaluationResponse {
  const plan = createHumanEvaluationPlan({
    studyId: "issue-58",
    evaluatorIds: ["evaluator-1", "evaluator-2", "evaluator-3"],
    assignmentSeed: 58,
    criteria: { ...DEFAULT_HUMAN_EVALUATION_CRITERIA, acceptedByProductOwner: true },
  });
  const kit = plan.publicPlan.kits.find((item) => item.evaluatorId === evaluatorId)!;
  const privateAssignment = plan.privatePlan.assignments.find(
    item => item.evaluatorId === evaluatorId,
  )!;
  return {
    evaluatorId,
    ratings: kit.comparisons.flatMap(comparison =>
      comparison.replays.map(replay => ({ replayId: replay.replayId, scores: perfectScores })),
    ),
    pairPreferredReplayIds: kit.comparisons.map(
      (_, index) => privateAssignment.assignments[index]!.replayIds.cognition,
    ),
    preferredReplayId: privateAssignment.assignments[0]!.replayIds.cognition,
    principalReactionDescriptions: Object.fromEntries(
      kit.scenarioOrder.map((_, index) => [`S${index + 1}`, "redacted response"]),
    ),
    principalReactionCorrect: Object.fromEntries(
      kit.scenarioOrder.map((_, index) => [`S${index + 1}`, true]),
    ),
    safetyReports: [],
    ...overrides,
  };
}

describe("blind human A/B evaluation plan", () => {
  it("records the issue #58 experimental activation waiver", () => {
    expect(COGNITION_LIVE_DEFAULT_ENABLED).toBe(true);
    const plan = createHumanEvaluationPlan({
      studyId: "issue-58",
      evaluatorIds: ["evaluator-1", "evaluator-2", "evaluator-3"],
      assignmentSeed: 58,
    });
    expect(plan.publicPlan.manifest.liveCognitionDefaultEnabled).toBe(true);
    expect(plan.publicPlan.manifest.status).toBe(
      "activated-by-waiver-human-evaluation-open",
    );
    expect(plan.publicPlan.manifest.activationWaiver?.confirmedByProductOwner).toBe(
      true,
    );
  });

  it("requires three independent evaluators", () => {
    expect(() =>
      createHumanEvaluationPlan({
        studyId: "issue-58",
        evaluatorIds: ["solo-developer"],
        assignmentSeed: 58,
      }),
    ).toThrow("human evaluation requires at least three evaluator IDs");
  });

  it("creates deterministic kits while keeping arms private", () => {
    const input = {
      studyId: "issue-58",
      evaluatorIds: ["evaluator-1", "evaluator-2", "evaluator-3"],
      assignmentSeed: 58,
    };
    const first = createHumanEvaluationPlan(input);
    const second = createHumanEvaluationPlan(input);
    expect(stableStringify(first.publicPlan)).toBe(stableStringify(second.publicPlan));
    expect(stableStringify(first.privatePlan)).toBe(stableStringify(second.privatePlan));

    const serialized = stableStringify(first.publicPlan);
    expect(serialized).not.toContain('"baseline"');
    expect(serialized).not.toContain('"cognition"');

    for (const kit of first.publicPlan.kits) {
      expect([...kit.scenarioOrder].sort()).toEqual([
        "boredom-gate",
        "caution-gate",
        "habituation-gate",
        "personality-gate",
      ]);
      expect(kit.comparisons).toHaveLength(kit.scenarioOrder.length);
      for (const comparison of kit.comparisons) {
        expect(comparison.replays.map(replay => replay.label)).toEqual([
          "Replay 1",
          "Replay 2",
        ]);
        expect(comparison.replays[0]!.durationS).toBe(comparison.replays[1]!.durationS);
        expect(comparison.replays[0]!.replayId).not.toBe(comparison.replays[1]!.replayId);
      }
    }
  });

  it("binds assignments to a digest without exposing the arm mapping", async () => {
    const plan = createHumanEvaluationPlan({
      studyId: "issue-58",
      evaluatorIds: ["evaluator-1", "evaluator-2", "evaluator-3"],
      assignmentSeed: 58,
    });
    const digest = await assignmentDigest(plan.privatePlan);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(plan.publicPlan)).not.toContain("assignmentSeed");
  });

  it("blocks until all accepted human gates pass", async () => {
    const plan = createHumanEvaluationPlan({
      studyId: "issue-58",
      evaluatorIds: ["evaluator-1", "evaluator-2", "evaluator-3"],
      assignmentSeed: 58,
      criteria: { ...DEFAULT_HUMAN_EVALUATION_CRITERIA, acceptedByProductOwner: true },
    });
    plan.publicPlan.manifest.assignmentDigest = await assignmentDigest(
      plan.privatePlan,
    );
    const passing = ["evaluator-1", "evaluator-2", "evaluator-3"].map(evaluatorId =>
      responseFor(evaluatorId),
    );
    expect(
      (await evaluateHumanResults({ ...plan, responses: passing })).passed,
    ).toBe(true);

    const incomplete = await evaluateHumanResults({
      ...plan,
      responses: passing.slice(0, 1),
    });
    expect(incomplete.passed).toBe(false);
    expect(incomplete.blockers).toContain(
      "requires at least 3 human evaluators; received 1",
    );

    const safetyReplayId = plan.publicPlan.kits[0]!.comparisons[0]!.replays[0]!.replayId;
    const withSafety = await evaluateHumanResults({
      ...plan,
      responses: passing.map((response, index) =>
        index === 0
          ? {
              ...response,
              safetyReports: [{ replayId: safetyReplayId, concern: "noisy" as const }],
            }
          : response,
      ),
    });
    expect(withSafety.passed).toBe(false);
    expect(withSafety.blockers).toContain(
      `at least one evaluator reported noisy or disturbing behavior for: ${plan.publicPlan.kits[0]!.scenarioOrder[0]}`,
    );

    await expect(
      evaluateHumanResults({
        ...plan,
        responses: [passing[0]!, passing[0]!, passing[1]!],
      }),
    ).rejects.toThrow("evaluator responses must be unique");

    const tamperedManifest = structuredClone(plan);
    tamperedManifest.publicPlan.manifest.assignmentDigest = "0".repeat(64);
    await expect(
      evaluateHumanResults({ ...tamperedManifest, responses: passing }),
    ).rejects.toThrow("private assignments do not match the published digest");
  });

  it("maps private replay identities only for its own evaluator", () => {
    const plan = createHumanEvaluationPlan({
      studyId: "issue-58",
      evaluatorIds: ["evaluator-1", "evaluator-2", "evaluator-3"],
      assignmentSeed: 58,
    });
    const kit = plan.publicPlan.kits[0]!;
    const replayId = kit.comparisons[0]!.replays[0]!.replayId;
    const identity = replayIdentity(plan.privatePlan, "evaluator-1", replayId);
    expect(identity).toBeDefined();
    expect(replayIdentity(plan.privatePlan, "evaluator-2", replayId)).toBeUndefined();
    expect(["baseline", "cognition"]).toContain(identity!.arm);
  });
});
