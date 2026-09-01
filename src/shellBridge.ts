import { CharacterRegistry } from "./characterRegistry";
import { IngressBridge } from "./ingressBridge";
import { CognitionDebugSnapshot } from "./cognitionDebugSnapshot";

export type ShellEventName =
  | "spawn"
  | "graceful-shutdown"
  | "despawn-all"
  | "despawn-one"
  | "delight-one"
  | "dismiss-one"
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
  onGracefulShutdown?: () => Promise<void>,
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
  await listen("graceful-shutdown", async () => {
    await onGracefulShutdown?.();
  });
  await listen("despawn-all", () => registry.despawnAll());
  await listen("despawn-one", (payload) => {
    if (typeof payload === "number") registry.despawn(payload);
  });
  for (const [event, feedback] of [
    ["delight-one", "delight"],
    ["dismiss-one", "dismiss"],
  ] as const) {
    await listen(event, (payload) => {
      const target = registry.characterIdFor(Number(payload));
      if (target) ingressBridge.receiveFeedback(feedback, target);
    });
  }
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
