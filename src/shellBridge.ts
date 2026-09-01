import { CharacterRegistry } from "./characterRegistry";
import { IngressBridge } from "./ingressBridge";
import { CognitionDebugSnapshot } from "./cognitionDebugSnapshot";

export type ShellEventName =
  | "spawn"
  | "despawn-all"
  | "despawn-one"
  | "gesture"
  | "toggle-cognition-debug"
  | "select-next-cognition-debug";

export type ShellListen = (
  event: ShellEventName,
  onPayload: (payload: unknown) => void,
) => Promise<unknown>;

export interface EnvironmentEventTarget {
  addEventListener(type: "focus" | "blur", listener: () => void): void;
}

export interface CognitionDebugCommands {
  toggle(): void;
  selectNext(snapshots: CognitionDebugSnapshot[]): void;
}

export async function connectShellEvents(
  listen: ShellListen,
  registry: CharacterRegistry,
  environmentTarget: EnvironmentEventTarget,
  debugCommands?: CognitionDebugCommands,
): Promise<void> {
  const ingressBridge = new IngressBridge((envelope) => {
    registry.dispatch(envelope);
  });

  // Environment changes before this connection have no Materialized recipient
  // and are intentionally ignored rather than replayed as startup cognition.
  environmentTarget.addEventListener("focus", () => {
    ingressBridge.receiveEnvironment("appFocus");
  });
  environmentTarget.addEventListener("blur", () => {
    ingressBridge.receiveEnvironment("appBlur");
  });

  await listen("spawn", () => registry.spawn());
  await listen("despawn-all", () => registry.despawnAll());
  await listen("despawn-one", (payload) => {
    if (typeof payload === "number") registry.despawn(payload);
  });
  await listen("gesture", (payload) => {
    ingressBridge.receiveGesture(payload);
  });
  if (debugCommands) {
    await listen("toggle-cognition-debug", () => debugCommands.toggle());
    await listen("select-next-cognition-debug", () =>
      debugCommands.selectNext(registry.debugSnapshots()),
    );
  }
}
