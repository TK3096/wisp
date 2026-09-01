import { describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import { IngressBridge } from "../src/ingressBridge";
import { connectShellEvents } from "../src/shellBridge";
import {
  CognitionHandle,
  NEUTRAL_BEHAVIOR_SIGNAL,
  StimulusEnvelope,
} from "../src/cognition";

let testIdentityCounter = 0;
const nextTestId = () =>
  `0195c8f2-70aa-7cc2-99df-f2d3ba54c${(++testIdentityCounter).toString(16).padStart(3, "0")}`;

describe("Ingress Bridge", () => {
  it("forwards an accepted open-palm gesture to every Materialized character", () => {
    const dispatched: StimulusEnvelope[] = [];
    const bridge = new IngressBridge((envelope) => dispatched.push(envelope));

    const accepted = bridge.receiveGesture({
      gesture: "openPalm",
      confidence: 0.87,
    });

    expect(accepted).toBe(true);
    expect(dispatched).toEqual([
      {
        target: "all",
        stimulus: { kind: "gesture", gesture: "openPalm", confidence: 0.87 },
      },
    ]);
  });

  it("drops malformed gesture payloads before simulation dispatch", () => {
    const dispatched: StimulusEnvelope[] = [];
    const bridge = new IngressBridge((envelope) => dispatched.push(envelope));

    expect(
      bridge.receiveGesture({ gesture: "closedFist", confidence: 0.9 }),
    ).toBe(false);
    expect(
      bridge.receiveGesture({ gesture: "openPalm", confidence: 1.01 }),
    ).toBe(false);
    expect(
      bridge.receiveGesture({ gesture: "openPalm", confidence: Number.NaN }),
    ).toBe(false);
    expect(bridge.receiveGesture("openPalm")).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it("maps environment focus and blur changes and preserves arrival order", () => {
    const dispatched: StimulusEnvelope[] = [];
    const bridge = new IngressBridge((envelope) => dispatched.push(envelope));

    expect(bridge.receiveEnvironment("appFocus")).toBe(true);
    expect(bridge.receiveGesture({ gesture: "openPalm", confidence: 0 })).toBe(
      true,
    );
    expect(bridge.receiveEnvironment("appBlur")).toBe(true);
    expect(bridge.receiveEnvironment("windowMoved")).toBe(false);

    expect(dispatched).toEqual([
      {
        target: "all",
        stimulus: { kind: "environment", change: "appFocus" },
      },
      {
        target: "all",
        stimulus: { kind: "gesture", gesture: "openPalm", confidence: 0 },
      },
      {
        target: "all",
        stimulus: { kind: "environment", change: "appBlur" },
      },
    ]);
  });

  it("connects injected shell gesture and spawn events without disguising spawn as cognition", async () => {
    const cognitionHandles: CognitionHandle[] = [];
    const registry = new CharacterRegistry({
      stage: null,
      manifest: [
        {
          name: "test-archetype",
          displayName: "Test",
          idleFrames: 1,
          walkFrames: 1,
          frameWidth: 1,
          frameHeight: 1,
          idlePath: "",
          walkPath: "",
          jumpPath: "",
          fallPath: "",
        },
      ],
      loadedAssets: new Map([
        [
          "test-archetype",
          { idleTextures: [null], walkTextures: [null], jumpTexture: null, fallTexture: null },
        ],
      ]),
      rng: () => 0,
      screenWidth: 100,
      floorY: 100,
      createHandle: (): CharacterHandle => ({
        setAnimation() {},
        setTexture() {},
        setPosition() {},
        setFlip() {},
        setAirborneSprite() {},
        destroy() {},
      }),
      createCognitionHandle: () => {
        const handle: CognitionHandle = {
          observe: vi.fn(),
          toneSeed: () => ({
            personality: NEUTRAL_BEHAVIOR_SIGNAL.personality,
            affect: NEUTRAL_BEHAVIOR_SIGNAL.affect,
          }),
          tick: () => NEUTRAL_BEHAVIOR_SIGNAL,
          snapshot: () => {
            throw new Error("not used");
          },
          restore() {},
        };
        cognitionHandles.push(handle);
        return handle;
      },
      createCharacterId: nextTestId,
    });
    const shellPayloadHandlers = new Map<string, (payload: unknown) => void>();
    const environmentListeners = new Map<string, () => void>();

    registry.spawn();
    registry.spawn();
    await connectShellEvents(
      async (event, onPayload) => {
        shellPayloadHandlers.set(event, onPayload);
      },
      registry,
      {
        addEventListener(type, listener) {
          environmentListeners.set(type, listener);
        },
      },
    );

    shellPayloadHandlers.get("gesture")?.({
      gesture: "openPalm",
      confidence: 0.91,
    });

    expect(cognitionHandles).toHaveLength(2);
    for (const handle of cognitionHandles) {
      expect(handle.observe).toHaveBeenNthCalledWith(2, {
        kind: "gesture",
        gesture: "openPalm",
        confidence: 0.91,
      });
    }
    expect(registry.count).toBe(2);

    shellPayloadHandlers.get("spawn")?.(undefined);
    expect(registry.count).toBe(3);
    expect(cognitionHandles[2].observe).toHaveBeenCalledTimes(1);
    expect(cognitionHandles[2].observe).toHaveBeenCalledWith({
      kind: "lifecycle",
      phase: "materialized",
    });

    environmentListeners.get("blur")?.();
    expect(cognitionHandles[0].observe).toHaveBeenLastCalledWith({
      kind: "environment",
      change: "appBlur",
    });
  });
});
