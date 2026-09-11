import { describe, expect, it } from "vitest";
import {
  POPULATION_ATTENTION,
  POPULATION_COGNITION_CADENCE_S,
  SOCIAL_PROJECTION_DIMENSIONS,
  runPopulationCognitionPass,
} from "../src/socialAttention";

function participant(characterId: string, sociability: number) {
  return {
    characterId,
    sociability,
    projection: [0.2, 0.4, 0.6, sociability, 0, 0.5, 0.25, 0.75],
  };
}

describe("Population Cognition facade", () => {
  it("uses a five-step accepted cadence and an eight-dimensional projection", () => {
    expect(SOCIAL_PROJECTION_DIMENSIONS).toBe(8);
    expect(POPULATION_COGNITION_CADENCE_S).toBeCloseTo(0.5, 12);
  });

  it("uses modelless peer attention without self-attention and gates influence by receiver sociability", () => {
    const outgoing = Array<number>(8).fill(1);
    const influences = [];
    const result = runPopulationCognitionPass({
      atS: 0.5,
      enabled: true,
      participants: [
        { characterId: "a-receiver", sociability: 0, projection: Array<number>(8).fill(0) },
        { characterId: "b-peer", sociability: 1, projection: outgoing },
      ],
      applyInfluence: (influence) => {
        influences.push(influence);
        return 0;
      },
    });

    expect(result.membershipDigest).toEqual(expect.any(String));
    // The asocial lonely query remains unchanged, and identity projections do not learn.
    expect(influences[0].value).toBe(0);
    // A sociable receiver accepts a bounded positive peer contribution.
    const sociable = runPopulationCognitionPass({
      atS: 0.5,
      enabled: true,
      participants: [
        { characterId: "a-receiver", sociability: 1, projection: Array<number>(8).fill(0) },
        { characterId: "b-peer", sociability: 1, projection: outgoing },
      ],
      applyInfluence: () => 0,
    });
    expect(sociable.influenceNorm).toBeGreaterThan(0);
    expect(sociable.influenceNorm).toBeLessThanOrEqual(1);
    expect(POPULATION_ATTENTION.GAMMA).toBeLessThan(1);
  });

  it("is deterministic and permutation-equivariant by stable Character Identity", () => {
    const run = (order: "ab" | "ba") => {
      const source = order === "ab"
        ? [participant("a", 0.25), participant("b", 0.75)]
        : [participant("b", 0.75), participant("a", 0.25)];
      return runPopulationCognitionPass({
        atS: 0.5,
        enabled: true,
        participants: source,
        applyInfluence: () => 0,
      });
    };
    const first = run("ab");
    const second = run("ba");
    expect(first.membershipDigest).toBe(second.membershipDigest);
    expect(first.influenceNorm).toBe(second.influenceNorm);
    expect(first.strongestContribution).toEqual(second.strongestContribution);
  });

  it("returns bounded canonical skip summaries", () => {
    const disabled = runPopulationCognitionPass({
      atS: 1, enabled: false,
      participants: [participant("a", 1), participant("b", 1)],
      applyInfluence: () => 0,
    });
    const insufficient = runPopulationCognitionPass({
      atS: 1, enabled: true,
      participants: [participant("a", 1)],
      applyInfluence: () => 0,
    });
    expect(disabled).toMatchObject({ enabled: false, skipReason: "disabled" });
    expect(insufficient).toMatchObject({
      enabled: true, eligibleCount: 1, skipReason: "insufficient_eligible",
    });
  });
});
