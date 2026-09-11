import { describe, expect, it, vi } from "vitest";
import {
  CognitionDebugOverlay,
  CognitionDebugSnapshot,
  DebugOverlayView,
  formatCognitionDebugSnapshot,
} from "../src/cognitionDebug";
import { projectCognitionDebugSnapshot } from "../src/cognitionDebugSnapshot";
import { createCognitionDebugView } from "../src/cognitionDebugView";
import { NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import { COGNITION_DEBUG } from "../src/config";

const SIGNAL = {
  ...NEUTRAL_BEHAVIOR_SIGNAL,
  affect: {
    surprise: 0.62,
    valence: 0.2,
    arousal: 0.74,
  },
  temporalSurprise: {
    derivativeNorm: 1.25,
    gate: 0.81,
    centeredEnergy: 0.31,
  },
  microBelief: {
    novelty: 0.44,
    familiarity: 0.12,
    socialPositivity: 0.35,
    caution: 0.08,
  },
  reaction: {
    kind: "curiosity",
    score: 0.42,
    remainingS: 1.25,
    candidates: NEUTRAL_BEHAVIOR_SIGNAL.reaction.candidates,
  },
  behaviorBias: {
    idleDwell: 1.2,
    walkSpeed: 0.8,
    jumpChance: 1.4,
    bubbleChance: 1.1,
    animationPace: 1.05,
  },
} as const;

function makeSnapshot(
  overrides: Partial<CognitionDebugSnapshot> = {},
): CognitionDebugSnapshot {
  return {
    registryId: 1,
    characterId: "018f6a55-4d1d-7b67-9d9f-3f38d1a7c001",
    archetype: "mask-dude",
    label: "Mask Dude #1",
    reaction: {
      kind: "curiosity",
      score: 0.42,
      remainingS: 1.25,
    },
    affect: { surprise: 0.62, valence: 0.2, arousal: 0.74 },
    behaviorBias: {
      idleDwell: 1.2,
      walkSpeed: 0.8,
      jumpChance: 1.4,
      bubbleChance: 1.1,
      animationPace: 1.05,
    },
    latestStimulus: {
      observedAtS: 1.2,
      stimulus: { kind: "gesture", gesture: "openPalm", confidence: 0.96 },
    },
    cadenceLagS: 0.064,
    ...overrides,
  };
}

describe("Cognition Debug projection", () => {
  it("projects only the accepted bounded inspection surface", () => {
    const snapshot = projectCognitionDebugSnapshot({
      registryId: 1,
      characterId: "018f6a55-4d1d-7b67-9d9f-3f38d1a7c001",
      archetype: "mask-dude",
      label: "Mask Dude #1",
      signal: SIGNAL,
      latestStimulus: {
        observedAtS: 1.2,
        stimulus: { kind: "gesture", gesture: "openPalm", confidence: 0.96 },
      },
      cadenceLagS: 0.064,
    });

    expect(snapshot.reaction).toEqual({
      kind: "curiosity",
      score: 0.42,
      remainingS: 1.25,
    });
    expect(snapshot.behaviorBias.idleDwell).toBe(1.2);
    expect(Object.keys(snapshot)).toEqual([
      "registryId",
      "characterId",
      "archetype",
      "label",
      "reaction",
      "affect",
      "behaviorBias",
      "latestStimulus",
      "cadenceLagS",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("temporalSurprise");
    expect(JSON.stringify(snapshot)).not.toContain("microBelief");
    expect(JSON.stringify(snapshot)).not.toContain("candidates");
    expect(JSON.stringify(snapshot)).not.toContain("cognition");
  });

  it("keeps a pending character explicit instead of inventing a reaction", () => {
    const snapshot = projectCognitionDebugSnapshot({
      registryId: 1,
      characterId: "character-1",
      archetype: "mask-dude",
      label: "Mask Dude #1",
      signal: null,
      latestStimulus: null,
      cadenceLagS: 0.04,
    });

    expect(snapshot.reaction).toBeNull();
    expect(snapshot.affect).toBeNull();
    expect(snapshot.behaviorBias).toBeNull();
    expect(formatCognitionDebugSnapshot(snapshot)).toEqual([
      "Mask Dude #1",
      "reaction pending",
      "affect pending",
      "bias pending",
      "stimulus none",
      "cadence lag 40ms",
    ]);
  });

  it("formats the compact accepted overlay fields", () => {
    expect(formatCognitionDebugSnapshot(makeSnapshot())).toEqual([
      "Mask Dude #1",
      "reaction curiosity 0.42 · 1.25s",
      "affect surprise 0.62 · valence +0.20 · arousal 0.74",
      "bias idle 1.20× walk 0.80× jump 1.40× bubble 1.10× pace 1.05×",
      "stimulus gesture/openPalm 0.96 @ 1.20s",
      "cadence lag 64ms",
    ]);
  });
});

describe("Cognition Debug Overlay", () => {
  function makeView() {
    const view: DebugOverlayView = {
      setVisible: vi.fn(),
      setLines: vi.fn(),
      destroy: vi.fn(),
    };
    return view;
  }

  it("renders the selected character and keeps selection stable", () => {
    const view = makeView();
    const overlay = new CognitionDebugOverlay(view, {
      now: () => 0,
      enabled: true,
    });
    const first = makeSnapshot();
    const second = makeSnapshot({
      registryId: 2,
      label: "Ninja Frog #2",
    });

    expect(overlay.update([first, second])).toBe(first);
    expect(overlay.update([first, second])).toBe(first);

    overlay.selectNext([first, second]);
    expect(overlay.update([first, second])).toBe(second);
  });

  it("falls back to the first Materialized character after selection disappears", () => {
    const view = makeView();
    const overlay = new CognitionDebugOverlay(view, {
      now: () => 0,
      enabled: true,
    });
    const first = makeSnapshot();
    const second = makeSnapshot({ registryId: 2 });

    overlay.update([first, second]);
    overlay.selectNext([first, second]);
    expect(overlay.update([first, second])).toBe(second);
    expect(overlay.update([first])).toBe(first);
  });

  it("can be disabled without rendering and measures each enabled frame", () => {
    const view = makeView();
    const now = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(10.125);
    const overlay = new CognitionDebugOverlay(view, { now, enabled: false });

    overlay.update([makeSnapshot()]);
    expect(view.setVisible).toHaveBeenCalledWith(false);
    expect(view.setLines).not.toHaveBeenCalled();
    expect(overlay.lastFrameCostMs).toBeNull();

    overlay.setEnabled(true);
    overlay.update([makeSnapshot()]);
    expect(view.setVisible).toHaveBeenCalledWith(true);
    expect(view.setLines).toHaveBeenCalled();
    expect(overlay.lastFrameCostMs).toBeCloseTo(0.125, 6);
    expect(overlay.maxFrameCostMs).toBeCloseTo(0.125, 6);
    expect(overlay.withinFrameBudget).toBe(true);
  });

  it("measures snapshot projection together with presentation", () => {
    const view = makeView();
    const now = vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(5.075);
    const overlay = new CognitionDebugOverlay(view, { now, enabled: true });
    const provider = vi.fn(() => [makeSnapshot()]);

    expect(overlay.update(provider)).toBe(provider.mock.results[0].value[0]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(overlay.lastFrameCostMs).toBeCloseTo(0.075, 6);
  });

  it("does not project snapshots while disabled", () => {
    const view = makeView();
    const overlay = new CognitionDebugOverlay(view, {
      now: () => 0,
      enabled: false,
    });
    const provider = vi.fn(() => [makeSnapshot()]);

    expect(overlay.update(provider)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it("uses p95 frame cost for the accepted debug budget", () => {
    const view = makeView();
    const costs = Array.from({ length: 20 }, (_, index) =>
      index >= 18 ? 0.3 : 0.1,
    );
    const times = costs.flatMap((cost) => [0, cost]);
    const now = vi.fn(() => times.shift() ?? 0);
    const overlay = new CognitionDebugOverlay(view, { now, enabled: true });
    const snapshot = makeSnapshot();

    for (const _ of costs) {
      overlay.update([snapshot]);
    }

    expect(overlay.frameCount).toBe(costs.length);
    expect(overlay.p95FrameCostMs).toBeCloseTo(0.3, 6);
    expect(overlay.maxFrameCostMs).toBeCloseTo(0.3, 6);
    expect(overlay.withinFrameBudget).toBe(false);
  });

  it("keeps the full accepted stress window within the debug budget", () => {
    const view = makeView();
    const overlay = new CognitionDebugOverlay(view, { enabled: true });
    const snapshots = Array.from({ length: 8 }, (_, index) =>
      makeSnapshot({
        registryId: index + 1,
        label: `Mask Dude #${index + 1}`,
      }),
    );

    for (let frame = 0; frame < COGNITION_DEBUG.METRIC_WINDOW_FRAMES; frame++) {
      overlay.update(() => snapshots.map((snapshot) => structuredClone(snapshot)));
    }

    expect(overlay.frameCount).toBe(COGNITION_DEBUG.METRIC_WINDOW_FRAMES);
    expect(overlay.p95FrameCostMs).toBeLessThanOrEqual(
      COGNITION_DEBUG.FRAME_BUDGET_MS,
    );
  });

  it("toggles without losing the selected character", () => {
    const view = makeView();
    const overlay = new CognitionDebugOverlay(view, {
      now: () => 0,
      enabled: true,
    });
    const first = makeSnapshot();
    const second = makeSnapshot({ registryId: 2 });
    overlay.update([first, second]);
    overlay.selectNext([first, second]);

    overlay.toggle();
    expect(overlay.isEnabled).toBe(false);
    overlay.toggle();
    expect(overlay.isEnabled).toBe(true);
    expect(overlay.update([first, second])).toBe(second);
  });

  it("reports an empty development overlay without touching cognition", () => {
    const view = makeView();
    const overlay = new CognitionDebugOverlay(view, {
      now: () => 0,
      enabled: true,
    });

    expect(overlay.update([])).toBeNull();
    expect(view.setLines).toHaveBeenCalledWith(["No Materialized characters"]);
  });
});

describe("DOM Cognition Debug View", () => {
  function makeElement(tagName: string) {
    return {
      tagName,
      style: {} as Record<string, string>,
      textContent: "",
      children: [] as unknown[],
      appendChild(child: unknown) {
        this.children.push(child);
        return child;
      },
      remove() {
        this.children.length = 0;
      },
    };
  }

  it("renders plain text through the injected DOM boundary", () => {
    const elements = [makeElement("div"), makeElement("pre")];
    let created = 0;
    const body = makeElement("body");
    const document = {
      createElement: (tagName: string) => elements[created++],
      body,
    };

    const view = createCognitionDebugView(document);
    view.setVisible(false);
    expect(elements[0].style.display).toBe("none");
    view.setLines(["Mask Dude #1", "reaction curiosity"]);
    view.setVisible(true);

    expect(elements[0].style.position).toBe("fixed");
    expect(elements[1].textContent).toBe("Mask Dude #1\nreaction curiosity");
    expect(body.children).toEqual([elements[0]]);

    view.setVisible(true);
    expect(elements[0].style.display).toBe("block");
  });
});
