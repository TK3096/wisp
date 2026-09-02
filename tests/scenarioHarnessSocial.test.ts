import { describe, expect, it } from "vitest";
import {
  POPULATION_COGNITION_OFF_SCENARIO,
  POPULATION_COGNITION_ON_SCENARIO,
  formatScenarioTraceNdjson,
  runScenario,
} from "../src/scenarioHarness";

describe("Set Attention deterministic replay", () => {
  it("records bounded default traces for disabled and executed passes", () => {
    const pass = (enabled: boolean) =>
      runScenario(enabled ? POPULATION_COGNITION_ON_SCENARIO : POPULATION_COGNITION_OFF_SCENARIO, 60)
        .trace
        .filter((record) => record.type === "population_cognition_pass");

    const off = pass(false);
    const on = pass(true);
    expect(off).toHaveLength(4);
    expect(off[0].summary).toMatchObject({ enabled: false, skipReason: "disabled" });
    expect(on).toHaveLength(4);
    expect(on[1].summary).toMatchObject({
      enabled: true,
      eligibleCount: 2,
      skipReason: null,
      membershipDigest: expect.any(String),
      influenceNorm: expect.any(Number),
      strongestContribution: expect.any(Object),
      postIntegrationSignals: [
        expect.objectContaining({ characterId: "population-cognition-on-character-1" }),
        expect.objectContaining({ characterId: "population-cognition-on-character-2" }),
      ],
    });
  });

  it("produces byte-identical NDJSON on repeat for social-on and social-off", () => {
    for (const scenario of [POPULATION_COGNITION_OFF_SCENARIO, POPULATION_COGNITION_ON_SCENARIO]) {
      const first = formatScenarioTraceNdjson(runScenario(scenario, 60));
      const second = formatScenarioTraceNdjson(runScenario(scenario, 60));
      expect(first).toBe(second);
    }
  });
});
