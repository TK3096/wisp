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
        tick: () => NEUTRAL_BEHAVIOR_SIGNAL,
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
});
