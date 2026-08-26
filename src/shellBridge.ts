import { CharacterRegistry } from "./characterRegistry";
import { IngressBridge } from "./ingressBridge";

export type ShellEventName =
  | "spawn"
  | "despawn-all"
  | "despawn-one"
  | "gesture";

export type ShellListen = (
  event: ShellEventName,
  onPayload: (payload: unknown) => void,
) => Promise<unknown>;

export interface EnvironmentEventTarget {
  addEventListener(type: "focus" | "blur", listener: () => void): void;
}

export async function connectShellEvents(
  listen: ShellListen,
  registry: CharacterRegistry,
  environmentTarget: EnvironmentEventTarget,
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
}
