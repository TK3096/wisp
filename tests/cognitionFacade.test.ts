import { describe, expect, it } from "vitest";
import {
  COGNITION_SCHEMA_VERSION,
  PersistentCognitionState,
  Stimulus,
} from "../src/cognition";
import { bindWasmCognition } from "../src/cognitionFacade";

class FakeWasmCognition {
  readonly stimuli: Stimulus[] = [];
  elapsed = 0;

  constructor(readonly init: unknown) {}

  observe(stimulus: Stimulus) {
    this.stimuli.push(stimulus);
  }

  tone_seed() {
    return {
      personality: { energy: 0.5, curiosity: 0.5, boldness: 0.5, sociability: 0.5 },
      affect: { surprise: 0, valence: 0, arousal: 0 },
    };
  }

  note_expression() {}

  tick(dt: number) {
    this.elapsed += dt;
    return {
      personality: { energy: 0.5, curiosity: 0.5, boldness: 0.5, sociability: 0.5 },
      affect: { surprise: 0, valence: 0, arousal: 0 },
      temporalSurprise: { derivativeNorm: 0.25, gate: 0.8, centeredEnergy: 0.6 },
      behaviorBias: {
        idleDwell: 1.1,
        walkSpeed: 0.9,
        jumpChance: 1.2,
        bubbleChance: 0.8,
        animationPace: 1,
      },
    };
  }

  snapshot(): PersistentCognitionState {
    return {
      schemaVersion: COGNITION_SCHEMA_VERSION,
      characterId: "wasm-character",
      cognition: { opaque: true },
    };
  }

  restore() {}
}

describe("WASM cognition facade", () => {
  it("adapts the coarse-grained binding to the injected Cognition Handle seam", async () => {
    const instances: FakeWasmCognition[] = [];
    const createHandle = await bindWasmCognition(
      async () => ({
        WispCognition: class extends FakeWasmCognition {
          constructor(init: unknown) {
            super(init);
            instances.push(this);
          }
        } as never,
      }),
    );
    const init = {
      schemaVersion: COGNITION_SCHEMA_VERSION,
      characterId: "wasm-character",
      archetype: "ninja-frog",
      personalitySeed: 42,
    } as const;
    const handle = await createHandle(init);
    const stimulus = { kind: "lifecycle", phase: "materialized" } as const;

    handle.observe(stimulus);
    handle.toneSeed();
    handle.noteExpression();
    const signal = handle.tick(0.1);
    const snapshot = handle.snapshot();
    handle.restore(snapshot);
    expect(instances).toHaveLength(1);
    const binding = instances[0];

    expect(handle).not.toHaveProperty("dimensions");
    expect(binding.init).toEqual(init);
    expect(binding.stimuli).toEqual([stimulus]);
    expect(binding.elapsed).toBe(0.1);
    expect(signal.behaviorBias.walkSpeed).toBe(0.9);
    expect(snapshot.cognition).toEqual({ opaque: true });
  });
});
