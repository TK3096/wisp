import { describe, expect, it, vi } from "vitest";
import { CharacterRegistry } from "../src/characterRegistry";
import { CharacterHandle } from "../src/character";
import { CognitionHandle, NEUTRAL_BEHAVIOR_SIGNAL } from "../src/cognition";
import { connectShellEvents } from "../src/shellBridge";

function makeRegistry(cognitionHandles: CognitionHandle[]): CharacterRegistry {
  return new CharacterRegistry({
    stage: null,
    manifest: [
      {
        name: "test",
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
        "test",
        {
          idleTextures: [null],
          walkTextures: [null],
          jumpTexture: null,
          fallTexture: null,
        },
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
        noteExpression: vi.fn(),
        snapshot: () => {
          throw new Error("not used");
        },
        restore() {},
      };
      cognitionHandles.push(handle);
      return handle;
    },
  });
}

describe("Shell Bridge", () => {
  it("forwards development-only overlay commands without simulation events", async () => {
    const cognitionHandles: CognitionHandle[] = [];
    const registry = makeRegistry(cognitionHandles);
    const payloadHandlers = new Map<string, (payload: unknown) => void>();
    const debugCommands = {
      toggle: vi.fn(),
      selectNext: vi.fn(),
    };
    registry.spawn();
    const observe = cognitionHandles[0].observe as ReturnType<typeof vi.fn>;
    observe.mockClear();

    await connectShellEvents(
      async (event, onPayload) => {
        payloadHandlers.set(event, onPayload);
      },
      registry,
      { addEventListener() {} },
      debugCommands,
    );

    payloadHandlers.get("toggle-cognition-debug")?.(undefined);
    payloadHandlers.get("select-next-cognition-debug")?.(undefined);

    expect(debugCommands.toggle).toHaveBeenCalledTimes(1);
    expect(debugCommands.selectNext).toHaveBeenCalledTimes(1);
    expect(debugCommands.selectNext).toHaveBeenCalledWith(
      registry.debugSnapshots(),
    );
    expect(observe).not.toHaveBeenCalled();
  });

  it("maps selected tray feedback actions to targeted semantic stimuli", async () => {
    const cognitionHandles: CognitionHandle[] = [];
    const registry = makeRegistry(cognitionHandles);
    const payloadHandlers = new Map<string, (payload: unknown) => void>();
    registry.spawn();
    const observe = cognitionHandles[0].observe as ReturnType<typeof vi.fn>;
    observe.mockClear();

    await connectShellEvents(
      async (event, onPayload) => {
        payloadHandlers.set(event, onPayload);
      },
      registry,
      { addEventListener() {} },
    );

    payloadHandlers.get("delight-one")?.(1);
    payloadHandlers.get("dismiss-one")?.(1);
    payloadHandlers.get("delight-one")?.(999);

    const characterId = registry.characterIdFor(1);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenNthCalledWith(1, {
      kind: "feedback",
      feedback: "delight",
    });
    expect(observe).toHaveBeenNthCalledWith(2, {
      kind: "feedback",
      feedback: "dismiss",
    });
    expect(registry.characterIdFor(999)).toBeNull();
  });
});
