import { Stimulus } from "./cognition";
import { CognitionDebugSnapshot } from "./cognitionDebugSnapshot";
import { COGNITION_DEBUG } from "./config";

export interface DebugOverlayView {
  setVisible(visible: boolean): void;
  setLines(lines: string[]): void;
  destroy(): void;
}

export interface CognitionDebugOverlayOptions {
  now?: () => number;
  enabled?: boolean;
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function describeStimulus(stimulus: Stimulus): string {
  switch (stimulus.kind) {
    case "gesture":
      return `gesture/${stimulus.gesture} ${stimulus.confidence.toFixed(2)}`;
    case "lifecycle":
      return `lifecycle/${stimulus.phase}`;
    case "environment":
      return `environment/${stimulus.change}`;
  }
}

export function formatCognitionDebugSnapshot(
  snapshot: CognitionDebugSnapshot,
): string[] {
  const reaction = snapshot.reaction
    ? `${snapshot.reaction.kind} ${snapshot.reaction.score.toFixed(
        2,
      )} · ${snapshot.reaction.remainingS.toFixed(2)}s`
    : "pending";
  const affect = snapshot.affect
    ? `surprise ${snapshot.affect.surprise.toFixed(
        2,
      )} · valence ${formatSigned(snapshot.affect.valence)} · arousal ${snapshot.affect.arousal.toFixed(
        2,
      )}`
    : "pending";
  const bias = snapshot.behaviorBias
    ? [
        `idle ${snapshot.behaviorBias.idleDwell.toFixed(2)}×`,
        `walk ${snapshot.behaviorBias.walkSpeed.toFixed(2)}×`,
        `jump ${snapshot.behaviorBias.jumpChance.toFixed(2)}×`,
        `bubble ${snapshot.behaviorBias.bubbleChance.toFixed(2)}×`,
        `pace ${snapshot.behaviorBias.animationPace.toFixed(2)}×`,
      ].join(" ")
    : "pending";
  const latestStimulus = snapshot.latestStimulus
    ? `${describeStimulus(snapshot.latestStimulus.stimulus)} @ ${snapshot.latestStimulus.observedAtS.toFixed(
        2,
      )}s`
    : "none";

  return [
    snapshot.label,
    `reaction ${reaction}`,
    `affect ${affect}`,
    `bias ${bias}`,
    `stimulus ${latestStimulus}`,
    `cadence lag ${Math.max(0, Math.round(snapshot.cadenceLagS * 1000))}ms`,
  ];
}

/**
 * Presentation-only inspector. It consumes already-projected snapshots and
 * never dispatches stimuli, advances cognition, or commands behavior.
 */
export class CognitionDebugOverlay {
  private enabled: boolean;
  private selectedRegistryId: number | null = null;
  private readonly now: () => number;
  private readonly view: DebugOverlayView;
  private _lastFrameCostMs: number | null = null;
  private _maxFrameCostMs = 0;
  private readonly frameCosts = new Float64Array(
    COGNITION_DEBUG.METRIC_WINDOW_FRAMES,
  );
  private frameCostCount = 0;
  private frameCostNext = 0;

  constructor(view: DebugOverlayView, options: CognitionDebugOverlayOptions = {}) {
    this.view = view;
    this.enabled = options.enabled ?? true;
    this.now = options.now ?? (() => performance.now());
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get lastFrameCostMs(): number | null {
    return this._lastFrameCostMs;
  }

  get maxFrameCostMs(): number {
    return this._maxFrameCostMs;
  }

  get frameCount(): number {
    return this.frameCostCount;
  }

  get p95FrameCostMs(): number | null {
    if (this.frameCostCount === 0) return null;
    const samples = Array.from(
      this.frameCosts.subarray(0, this.frameCostCount),
    ).sort((a, b) => a - b);
    return samples[Math.ceil(samples.length * 0.95) - 1];
  }

  get withinFrameBudget(): boolean {
    return (
      this.p95FrameCostMs !== null &&
      this.p95FrameCostMs <= COGNITION_DEBUG.FRAME_BUDGET_MS
    );
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this._lastFrameCostMs = null;
      this.view.setVisible(false);
    }
  }

  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  selectNext(snapshots: CognitionDebugSnapshot[]): void {
    if (snapshots.length === 0) {
      this.selectedRegistryId = null;
      return;
    }
    const currentIndex = snapshots.findIndex(
      (snapshot) => snapshot.registryId === this.selectedRegistryId,
    );
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % snapshots.length;
    this.selectedRegistryId = snapshots[nextIndex].registryId;
  }

  update(
    snapshots: CognitionDebugSnapshot[] | (() => CognitionDebugSnapshot[]),
  ): CognitionDebugSnapshot | null {
    if (!this.enabled) {
      this.view.setVisible(false);
      return null;
    }

    const startedAt = this.now();
    const projected =
      typeof snapshots === "function" ? snapshots() : snapshots;
    const selected =
      projected.find(
        (snapshot) => snapshot.registryId === this.selectedRegistryId,
      ) ??
      projected[0] ??
      null;
    this.selectedRegistryId = selected?.registryId ?? null;
    this.view.setLines(
      selected
        ? formatCognitionDebugSnapshot(selected)
        : ["No Materialized characters"],
    );
    this.view.setVisible(true);
    this._lastFrameCostMs = Math.max(0, this.now() - startedAt);
    this._maxFrameCostMs = Math.max(this._maxFrameCostMs, this._lastFrameCostMs);
    this.frameCosts[this.frameCostNext] = this._lastFrameCostMs;
    this.frameCostNext =
      (this.frameCostNext + 1) % this.frameCosts.length;
    this.frameCostCount = Math.min(
      this.frameCostCount + 1,
      this.frameCosts.length,
    );
    return selected;
  }

  destroy(): void {
    this.view.destroy();
  }
}
