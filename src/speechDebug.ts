import { SPEECH_DEBUG } from "./config";
import type { SpeechDebugSnapshot } from "./speechDebugSnapshot";
import type { StanceModifier } from "./speech";

export interface SpeechDebugView {
  setVisible(visible: boolean): void;
  setLines(lines: string[]): void;
  destroy(): void;
}

export interface SpeechDebugOverlayOptions {
  now?: () => number;
  enabled?: boolean;
}

function describeStance(stance: StanceModifier | null): string {
  return stance ?? "none";
}

export function formatSpeechDebugSnapshot(
  snapshot: SpeechDebugSnapshot,
): string[] {
  return [
    snapshot.label,
    `voice ${snapshot.voiceProfileVersion}`,
    `occasion ${snapshot.occasion} #${snapshot.expressionOrdinal} @ ${snapshot.requestedAtS.toFixed(
      2,
    )}s`,
    `direction ${snapshot.direction.tone}/${snapshot.direction.intent} ${snapshot.direction.intensity} · ${describeStance(
      snapshot.direction.stance,
    )}`,
    `outcome ${snapshot.outcome.status} · ${snapshot.outcome.attempts} attempt${snapshot.outcome.attempts === 1 ? "" : "s"} · ${snapshot.outcome.generationCostMs.toFixed(
      3,
    )}ms`,
    snapshot.outcome.text,
  ];
}

/**
 * Presentation-only speech inspector. It consumes already-projected
 * snapshots and never requests speech, mutates context, or displays bubbles.
 */
export class SpeechDebugOverlay {
  private enabled: boolean;
  private selectedRegistryId: number | null = null;
  private readonly now: () => number;
  private readonly view: SpeechDebugView;
  private _lastFrameCostMs: number | null = null;
  private _maxFrameCostMs = 0;
  private readonly frameCosts = new Float64Array(
    SPEECH_DEBUG.METRIC_WINDOW_FRAMES,
  );
  private frameCostCount = 0;
  private frameCostNext = 0;

  constructor(view: SpeechDebugView, options: SpeechDebugOverlayOptions = {}) {
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
    ).sort((left, right) => left - right);
    return samples[Math.ceil(samples.length * 0.95) - 1];
  }

  get withinFrameBudget(): boolean {
    return (
      this.p95FrameCostMs !== null &&
      this.p95FrameCostMs <= SPEECH_DEBUG.FRAME_BUDGET_MS
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

  selectNext(snapshots: SpeechDebugSnapshot[]): void {
    if (snapshots.length === 0) {
      this.selectedRegistryId = null;
      return;
    }
    const currentIndex = snapshots.findIndex(
      (snapshot) => snapshot.registryId === this.selectedRegistryId,
    );
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + 1) % snapshots.length;
    this.selectedRegistryId = snapshots[nextIndex].registryId;
  }

  update(
    snapshots: SpeechDebugSnapshot[] | (() => SpeechDebugSnapshot[]),
  ): SpeechDebugSnapshot | null {
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
        ? formatSpeechDebugSnapshot(selected)
        : ["No Materialized characters"],
    );
    this.view.setVisible(true);
    this._lastFrameCostMs = Math.max(0, this.now() - startedAt);
    this._maxFrameCostMs = Math.max(
      this._maxFrameCostMs,
      this._lastFrameCostMs,
    );
    this.frameCosts[this.frameCostNext] = this._lastFrameCostMs;
    this.frameCostNext = (this.frameCostNext + 1) % this.frameCosts.length;
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
