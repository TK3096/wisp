import { stableStringify } from "./scenarioHarness";
import { HUMAN_EVALUATION_SCENARIO_DEFINITIONS } from "./humanEvaluationScenarios";

export const HUMAN_EVALUATION_DIMENSIONS = [
  "Alive/Aware",
  "Individuality",
  "Appropriateness",
  "Variation",
  "Calm",
] as const;

export type HumanEvaluationDimension =
  (typeof HUMAN_EVALUATION_DIMENSIONS)[number];

export type HumanEvaluationArm = "baseline" | "cognition";

export interface HumanEvaluationScenario {
  id: string;
  title: string;
  durationS: number;
  principalReaction: string;
  visibleDelta: {
    event: "jump_started" | "bubble_started";
    baselineCount: number;
    cognitionCount: number;
  };
}

export interface HumanEvaluationCriteria {
  minimumEvaluators: 3;
  medianCognitionDimensionMinimum: 4;
  cognitionOverallPreferenceMinimum: 2;
  correctPrincipalReactionMinimum: 2;
  noisyOrDisturbingAllowed: false;
  /** #58 asks for accepted thresholds; the product owner must confirm these. */
  acceptedByProductOwner: boolean;
}

export interface PublicHumanReplay {
  replayId: string;
  label: `Replay ${1 | 2}`;
  durationS: number;
  tracePath?: string;
  viewerPath?: string;
  traceSha256?: string;
}

export interface PublicScenarioComparison {
  scenarioCode: string;
  replays: [PublicHumanReplay, PublicHumanReplay];
}

export interface PublicEvaluatorKit {
  evaluatorId: string;
  scenarioOrder: string[];
  comparisons: PublicScenarioComparison[];
}

export interface PrivateScenarioAssignment {
  scenarioId: string;
  firstReplayArm: HumanEvaluationArm;
  replayIds: Record<HumanEvaluationArm, string>;
}

export interface PrivateEvaluatorAssignment {
  evaluatorId: string;
  scenarioOrder: string[];
  assignments: PrivateScenarioAssignment[];
}

export interface PrivateHumanEvaluationPlan {
  studyId: string;
  assignmentSeed: number;
  assignments: PrivateEvaluatorAssignment[];
}

export interface HumanEvaluationStudyManifest {
  schemaVersion: 1;
  issue: 58;
  studyId: string;
  assignmentDigest: string;
  evaluatorIds: string[];
  criteria: HumanEvaluationCriteria;
  replayDurationSByScenario: Record<string, number>;
  replayAssets: Array<{
    replayId: string;
    path: string;
    viewerPath: string;
    sha256: string;
  }>;
  liveCognitionDefaultEnabled: boolean;
  status:
    | "awaiting-human-evaluations"
    | "activated-by-waiver-human-evaluation-open";
  activationWaiver?: {
    confirmedByProductOwner: boolean;
    issue: 58;
    reason:
      "Experimental default-on rollout authorized despite incomplete human evaluation.";
    revertCondition:
      "Revert if later evaluation reports noisy/disturbing behavior or cognition remains worse than baseline.";
  };
  soloDeveloperLimitation:
    "The sole developer cannot serve as all three independent evaluators.";
}

export interface PublicHumanEvaluationPlan {
  manifest: HumanEvaluationStudyManifest;
  kits: PublicEvaluatorKit[];
}

export interface HumanScenarioReplay {
  scenarioId: string;
  arm: HumanEvaluationArm;
  replayId: string;
  durationS: number;
  tracePath: string;
  viewerPath: string;
  traceSha256: string;
}

export interface HumanEvaluationStudyAssets {
  scenarios: HumanEvaluationScenario[];
  replaysByScenario: Record<
    string,
    Record<HumanEvaluationArm, HumanScenarioReplay>
  >;
}

export interface HumanEvaluationRating {
  replayId: string;
  scores: Record<HumanEvaluationDimension, 1 | 2 | 3 | 4 | 5>;
}

export interface HumanEvaluationResponse {
  evaluatorId: string;
  ratings: HumanEvaluationRating[];
  pairPreferredReplayIds: string[];
  preferredReplayId: string;
  principalReactionDescriptions: Record<string, string>;
  /** Entered by the study administrator after blind free-text coding. */
  principalReactionCorrect: Record<string, boolean>;
  safetyReports: Array<{
    replayId: string;
    concern: "noisy" | "disturbing";
    note?: string;
  }>;
}

export interface HumanEvaluationGateResult {
  passed: boolean;
  medianCognitionScores: Record<HumanEvaluationDimension, number>;
  cognitionOverallPreferences: number;
  correctPrincipalReactionsByScenario: Record<string, number>;
  noisyOrDisturbingReports: number;
  noisyOrDisturbingScenarios: string[];
  blockers: string[];
}

export const DEFAULT_HUMAN_EVALUATION_CRITERIA: HumanEvaluationCriteria = {
  minimumEvaluators: 3,
  medianCognitionDimensionMinimum: 4,
  cognitionOverallPreferenceMinimum: 2,
  correctPrincipalReactionMinimum: 2,
  noisyOrDisturbingAllowed: false,
  acceptedByProductOwner: false,
};

const HUMAN_EVALUATION_SCENARIOS: HumanEvaluationScenario[] = [
  {
    id: "habituation-gate",
    title: "Habituation Gate",
    durationS: HUMAN_EVALUATION_SCENARIO_DEFINITIONS["habituation-gate"]!.durationS,
    principalReaction:
      "Habituated cognition suppresses the later scheduler-gated idle bubble.",
    visibleDelta: { event: "bubble_started", baselineCount: 2, cognitionCount: 1 },
  },
  {
    id: "boredom-gate",
    title: "Boredom Gate",
    durationS: HUMAN_EVALUATION_SCENARIO_DEFINITIONS["boredom-gate"]!.durationS,
    principalReaction:
      "Quiet low-arousal time leads boredom to suppress the later idle bubble.",
    visibleDelta: { event: "bubble_started", baselineCount: 2, cognitionCount: 1 },
  },
  {
    id: "personality-gate",
    title: "Personality Gate",
    durationS: HUMAN_EVALUATION_SCENARIO_DEFINITIONS["personality-gate"]!.durationS,
    principalReaction:
      "Personality probability gates suppress one character's scheduled jumps while the baseline accepts them.",
    visibleDelta: { event: "jump_started", baselineCount: 4, cognitionCount: 0 },
  },
  {
    id: "caution-gate",
    title: "Caution Gate",
    durationS: HUMAN_EVALUATION_SCENARIO_DEFINITIONS["caution-gate"]!.durationS,
    principalReaction:
      "Accumulated caution suppresses a later scheduler-gated idle bubble.",
    visibleDelta: { event: "bubble_started", baselineCount: 2, cognitionCount: 1 },
  },
];

function createAssignmentRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const a = result[index] as T;
    const b = result[swapIndex] as T;
    result[index] = b;
    result[swapIndex] = a;
  }
  return result;
}

export function humanEvaluationScenarios(): readonly HumanEvaluationScenario[] {
  return HUMAN_EVALUATION_SCENARIOS;
}

export function createHumanEvaluationPlan(input: {
  studyId: string;
  evaluatorIds: readonly string[];
  assignmentSeed: number;
  criteria?: HumanEvaluationCriteria;
}): {
  publicPlan: PublicHumanEvaluationPlan;
  privatePlan: PrivateHumanEvaluationPlan;
} {
  if (!input.studyId.trim()) throw new Error("studyId is required");
  const evaluatorIds = [...new Set(input.evaluatorIds)];
  if (
    evaluatorIds.length < DEFAULT_HUMAN_EVALUATION_CRITERIA.minimumEvaluators
  ) {
    throw new Error("human evaluation requires at least three evaluator IDs");
  }
  if (evaluatorIds.some((id) => !id.trim())) {
    throw new Error("evaluator IDs must not be blank");
  }
  if (
    !Number.isInteger(input.assignmentSeed) ||
    input.assignmentSeed < 0 ||
    input.assignmentSeed > 0xffffffff
  ) {
    throw new Error("assignmentSeed must be a 32-bit integer");
  }

  const random = createAssignmentRandom(input.assignmentSeed);
  const scenarioIds = HUMAN_EVALUATION_SCENARIOS.map((scenario) => scenario.id);
  const kits: PublicEvaluatorKit[] = [];
  const privateAssignments: PrivateEvaluatorAssignment[] = [];

  evaluatorIds.forEach((evaluatorId, evaluatorIndex) => {
    const scenarioOrder = shuffled(scenarioIds, random);
    const privateAssignmentsForEvaluator: PrivateScenarioAssignment[] = [];
    const comparisons = scenarioOrder.map((scenarioId, scenarioIndex) => {
      const firstIsCognition = random() < 0.5;
      const firstArm: HumanEvaluationArm = firstIsCognition
        ? "cognition"
        : "baseline";
      const replay = (
        ordinal: 1 | 2,
      ): PublicHumanReplay => ({
        replayId: `${input.studyId}-e${evaluatorIndex + 1}-s${scenarioIndex + 1}-r${ordinal}`,
        label: `Replay ${ordinal}`,
        durationS: HUMAN_EVALUATION_SCENARIOS.find(
          (scenario) => scenario.id === scenarioId,
        )?.durationS as number,
      });
      const firstReplay = replay(1);
      const secondReplay = replay(2);
      privateAssignmentsForEvaluator.push({
        scenarioId,
        firstReplayArm: firstArm,
        replayIds: {
          baseline: firstArm === "baseline" ? firstReplay.replayId : secondReplay.replayId,
          cognition:
            firstArm === "cognition" ? firstReplay.replayId : secondReplay.replayId,
        },
      });
      return {
        scenarioCode: `S${scenarioIndex + 1}`,
        replays: [
          firstReplay,
          secondReplay,
        ] as [PublicHumanReplay, PublicHumanReplay],
      };
    });
    kits.push({ evaluatorId, scenarioOrder, comparisons });
    privateAssignments.push({
      evaluatorId,
      scenarioOrder,
      assignments: privateAssignmentsForEvaluator,
    });
  });

  return {
    publicPlan: {
      manifest: {
        schemaVersion: 1,
        issue: 58,
        studyId: input.studyId,
        assignmentDigest: "",
        evaluatorIds,
        criteria: input.criteria ?? DEFAULT_HUMAN_EVALUATION_CRITERIA,
        replayDurationSByScenario: Object.fromEntries(
          HUMAN_EVALUATION_SCENARIOS.map((scenario) => [
            scenario.id,
            scenario.durationS,
          ]),
        ),
        replayAssets: [],
        liveCognitionDefaultEnabled: true,
        status: "activated-by-waiver-human-evaluation-open",
        activationWaiver: {
          confirmedByProductOwner: true,
          issue: 58,
          reason:
            "Experimental default-on rollout authorized despite incomplete human evaluation.",
          revertCondition:
            "Revert if later evaluation reports noisy/disturbing behavior or cognition remains worse than baseline.",
        },
        soloDeveloperLimitation:
          "The sole developer cannot serve as all three independent evaluators.",
      },
      kits,
    },
    privatePlan: {
      studyId: input.studyId,
      assignmentSeed: input.assignmentSeed,
      assignments: privateAssignments,
    },
  };
}

export async function assignmentDigest(
  plan: PrivateHumanEvaluationPlan,
): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(plan));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function replayIdentity(
  plan: PrivateHumanEvaluationPlan,
  evaluatorId: string,
  replayId: string,
): { scenarioId: string; arm: HumanEvaluationArm } | undefined {
  const assignment = plan.assignments.find(
    (item) => item.evaluatorId === evaluatorId,
  );
  const scenario = assignment?.assignments.find((item) =>
    Object.values(item.replayIds).includes(replayId),
  );
  if (!assignment || !scenario) return undefined;
  const arm =
    scenario.replayIds.baseline === replayId
      ? "baseline"
      : scenario.replayIds.cognition === replayId
        ? "cognition"
        : undefined;
  if (!arm) return undefined;
  return { scenarioId: scenario.scenarioId, arm };
}

function requireCompleteResponse(
  response: HumanEvaluationResponse,
  kit: PublicEvaluatorKit,
): void {
  const replayIds = kit.comparisons.flatMap((comparison) =>
    comparison.replays.map((replay) => replay.replayId),
  );
  const ratings = new Map(
    response.ratings.map((rating) => [rating.replayId, rating]),
  );
  if (ratings.size !== response.ratings.length) {
    throw new Error(`${response.evaluatorId} has duplicate replay ratings`);
  }
  for (const replayId of replayIds) {
    const rating = ratings.get(replayId);
    if (!rating) {
      throw new Error(
        `${response.evaluatorId} is missing a rating for ${replayId}`,
      );
    }
    for (const dimension of HUMAN_EVALUATION_DIMENSIONS) {
      const score = rating.scores[dimension];
      if (![1, 2, 3, 4, 5].includes(score)) {
        throw new Error(
          `${response.evaluatorId} has an invalid ${dimension} score for ${replayId}`,
        );
      }
    }
    if (Object.keys(rating.scores).length !== HUMAN_EVALUATION_DIMENSIONS.length) {
      throw new Error(`${response.evaluatorId} has extra scores for ${replayId}`);
    }
  }
  if (!replayIds.includes(response.preferredReplayId)) {
    throw new Error(`${response.evaluatorId} preferred an unknown replay`);
  }
  if (response.pairPreferredReplayIds.length !== kit.comparisons.length) {
    throw new Error(`${response.evaluatorId} is missing a pair preference`);
  }
  response.pairPreferredReplayIds.forEach((replayId, index) => {
    const comparison = kit.comparisons[index];
    if (!comparison || !comparison.replays.some((item) => item.replayId === replayId)) {
      throw new Error(`${response.evaluatorId} has invalid pair preferences`);
    }
  });
  const scenarioCodes = new Set(kit.comparisons.map((item) => item.scenarioCode));
  const codedScenarios = Object.keys(response.principalReactionCorrect);
  if (
    codedScenarios.length !== kit.scenarioOrder.length ||
    codedScenarios.some((scenarioCode) => !scenarioCodes.has(scenarioCode))
  ) {
    throw new Error(`${response.evaluatorId} has invalid principal-reaction coding`);
  }
  const descriptionScenarios = Object.keys(
    response.principalReactionDescriptions,
  );
  if (
    descriptionScenarios.length !== kit.scenarioOrder.length ||
    descriptionScenarios.some(
      (scenarioCode) =>
        !scenarioCodes.has(scenarioCode) ||
        !response.principalReactionDescriptions[scenarioCode]?.trim(),
    )
  ) {
    throw new Error(
      `${response.evaluatorId} is missing redacted principal-reaction text`,
    );
  }
  for (const report of response.safetyReports) {
    if (
      !replayIds.includes(report.replayId) ||
      !["noisy", "disturbing"].includes(report.concern)
    ) {
      throw new Error(
        `${response.evaluatorId} has an invalid safety report replay or concern`,
      );
    }
  }
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? (ordered[middle] as number)
    : ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

export function evaluateHumanResults(input: {
  publicPlan: PublicHumanEvaluationPlan;
  privatePlan: PrivateHumanEvaluationPlan;
  responses: readonly HumanEvaluationResponse[];
}): Promise<HumanEvaluationGateResult> {
  return (async () => {
    const criteria = input.publicPlan.manifest.criteria;
    const blockers: string[] = [];
    if (input.responses.length < criteria.minimumEvaluators) {
      blockers.push(
        `requires at least ${criteria.minimumEvaluators} human evaluators; received ${input.responses.length}`,
      );
    }
    if (!criteria.acceptedByProductOwner) {
      blockers.push("product owner has not accepted the numeric evaluation gates");
    }
    const kitById = new Map(
      input.publicPlan.kits.map((kit) => [kit.evaluatorId, kit]),
    );
    if (
      new Set(input.responses.map((response) => response.evaluatorId)).size !==
      input.responses.length
    ) {
      throw new Error("evaluator responses must be unique");
    }
    if (input.responses.length !== kitById.size) {
      blockers.push("response evaluator IDs do not exactly match the study plan");
    }
    if (!input.publicPlan.manifest.assignmentDigest) {
      throw new Error("assignment digest is missing from the study manifest");
    }
    if (
      (await assignmentDigest(input.privatePlan)) !==
      input.publicPlan.manifest.assignmentDigest
    ) {
      throw new Error("private assignments do not match the published digest");
    }

    const validResponses: HumanEvaluationResponse[] = [];
    for (const response of input.responses) {
      const kit = kitById.get(response.evaluatorId);
      if (!kit) throw new Error(`unknown evaluator ${response.evaluatorId}`);
      requireCompleteResponse(response, kit);
      if (
        !replayIdentity(
          input.privatePlan,
          response.evaluatorId,
          response.preferredReplayId,
        )
      ) {
        throw new Error(`${response.evaluatorId} preferred a foreign replay`);
      }
      validResponses.push(response);
    }

    const evaluatorDimensionMedians = validResponses.map((response) => {
      const scores = Object.fromEntries(
        HUMAN_EVALUATION_DIMENSIONS.map((dimension) => [
          dimension,
          [] as number[],
        ]),
      ) as Record<HumanEvaluationDimension, number[]>;
      for (const rating of response.ratings) {
        const identity = replayIdentity(
          input.privatePlan,
          response.evaluatorId,
          rating.replayId,
        );
        if (identity?.arm === "cognition") {
          for (const dimension of HUMAN_EVALUATION_DIMENSIONS) {
            scores[dimension].push(rating.scores[dimension]);
          }
        }
      }
      return Object.fromEntries(
        HUMAN_EVALUATION_DIMENSIONS.map((dimension) => [
          dimension,
          median(scores[dimension]),
        ]),
      ) as Record<HumanEvaluationDimension, number>;
    });
    let cognitionPreferences = 0;
    let safetyReports = 0;
    const noisyOrDisturbingScenarios = new Set<string>();

    for (const response of validResponses) {
      const preference = replayIdentity(
        input.privatePlan,
        response.evaluatorId,
        response.preferredReplayId,
      );
      if (preference?.arm === "cognition") cognitionPreferences += 1;
      for (const report of response.safetyReports) {
        const identity = replayIdentity(
          input.privatePlan,
          response.evaluatorId,
          report.replayId,
        );
        if (identity) noisyOrDisturbingScenarios.add(identity.scenarioId);
        safetyReports += 1;
      }
    }

    const medianCognitionScores = Object.fromEntries(
      HUMAN_EVALUATION_DIMENSIONS.map((dimension) => [
        dimension,
        median(
          evaluatorDimensionMedians.map((scores) => scores[dimension]),
        ),
      ]),
    ) as Record<HumanEvaluationDimension, number>;

    if (
      validResponses.length >= criteria.minimumEvaluators &&
      HUMAN_EVALUATION_DIMENSIONS.some(
        (dimension) =>
          medianCognitionScores[dimension] <
          criteria.medianCognitionDimensionMinimum,
      )
    ) {
      blockers.push("a cognition-arm median dimension score is below its gate");
    }
    if (
      validResponses.length >= criteria.minimumEvaluators &&
      cognitionPreferences < criteria.cognitionOverallPreferenceMinimum
    ) {
      blockers.push("fewer than two evaluators preferred cognition overall");
    }

    const correctCounts = new Map<string, number>();
    for (const response of validResponses) {
      const kit = kitById.get(response.evaluatorId) as PublicEvaluatorKit;
      for (const [scenarioCode, correct] of Object.entries(
        response.principalReactionCorrect,
      )) {
        if (!correct) continue;
        const index = Number(scenarioCode.slice(1)) - 1;
        const scenarioId = kit.scenarioOrder[index] as string;
        correctCounts.set(scenarioId, (correctCounts.get(scenarioId) ?? 0) + 1);
      }
    }
    const correctPrincipalReactionsByScenario = Object.fromEntries(
      humanEvaluationScenarios().map((scenario) => [
        scenario.id,
        correctCounts.get(scenario.id) ?? 0,
      ]),
    );
    for (const [scenarioId, count] of Object.entries(
      correctPrincipalReactionsByScenario,
    )) {
      if (
        validResponses.length >= criteria.minimumEvaluators &&
        count < criteria.correctPrincipalReactionMinimum
      ) {
        blockers.push(
          `fewer than two evaluators described the principal reaction for ${scenarioId}`,
        );
      }
    }
    if (safetyReports > 0) {
      blockers.push(
        `at least one evaluator reported noisy or disturbing behavior for: ${[...noisyOrDisturbingScenarios].sort().join(", ")}`,
      );
    }

    return {
      passed: blockers.length === 0,
      medianCognitionScores,
      cognitionOverallPreferences: cognitionPreferences,
      correctPrincipalReactionsByScenario,
      noisyOrDisturbingReports: safetyReports,
      noisyOrDisturbingScenarios: [...noisyOrDisturbingScenarios].sort(),
      blockers,
    };
  })();
}
