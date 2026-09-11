/**
 * PROTOTYPE TUI for Wayfinder #67. Throwaway shell; the generator is isolated
 * in src/generatedSpeechPrototype.ts so any useful reducer can be lifted later.
 */

import * as readline from "node:readline";
import {
  createPrototypeState,
  PROTOTYPE_CHARACTERS,
  reducePrototype,
  type PrototypeState,
} from "../src/generatedSpeechPrototype";

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

function render(state: PrototypeState): void {
  console.clear();
  const character = PROTOTYPE_CHARACTERS[state.selectedIndex];
  console.log(`${bold("Generated Character Bubble Prototype")} ${dim("(throwaway)")}`);
  console.log(`${bold("Question:")} is authored persona grammar worth a Speech Handle?`);
  console.log("");
  console.log(`${bold("Selected")} ${character.id} ${dim(`${character.archetype} / seed ${character.personalitySeed}`)}`);
  console.log(`${bold("personality")} energy=${character.personality.energy} curiosity=${character.personality.curiosity} boldness=${character.personality.boldness} sociability=${character.personality.sociability}`);
  console.log(`${bold("recent")} ${(state.recentByCharacter[character.id] ?? []).slice(-4).join(" / ") || dim("none")}`);
  console.log(`${bold("mode")} ${state.forceFallback ? "forced fixed-line fallback" : "generated; failures fail closed"}`);
  console.log("");

  const trace = state.lastTrace;
  console.log(bold("Last accepted expression"));
  if (!trace) {
    console.log(dim("Press a speech key below."));
  } else {
    console.log(`${bold(trace.characterId)}: ${trace.text || dim("no expression")}`);
    console.log(dim(`source=${trace.source} reason=${trace.reason} intent=${trace.direction.intent} tone=${trace.direction.tone} intensity=${trace.direction.intensity} stance=${trace.direction.stance ?? "none"} seed=${trace.seed}`));
  }

  if (state.scenarioTraces.length > 0) {
    console.log("");
    console.log(bold("Seeded four-voice comparison"));
    state.scenarioTraces.forEach((trace) => console.log(`${bold(trace.characterId)}: ${trace.text}`));
    console.log(dim("Press j to print the comparison as canonical NDJSON."));
  }

  console.log("");
  console.log(`${bold("1")} mask  ${bold("2")} frog  ${bold("3")} pink  ${bold("4")} sentry`);
  console.log(`${bold("g")} greeting  ${bold("i")} idle  ${bold("s")} startle`);
  console.log(`${bold("e")} excite  ${bold("c")} investigate  ${bold("b")} bored`);
  console.log(`${bold("f")} fallback  ${bold("r")} comparison  ${bold("j")} NDJSON  ${bold("q")} quit`);
}

function speechAction(key: string) {
  const neutral = { intensity: "neutral", stance: null } as const;
  switch (key) {
    case "g":
      return { type: "speak", occasion: "greeting", intent: "greet", tone: "cheerful", ...neutral };
    case "i":
      return { type: "speak", occasion: "idle", intent: "idle", tone: "curious", ...neutral };
    case "s":
      return { type: "speak", occasion: "idle", intent: "startle", tone: "grumpy", intensity: "charged", stance: "novel" };
    case "e":
      return { type: "speak", occasion: "idle", intent: "excite", tone: "cheerful", intensity: "charged", stance: "social" };
    case "c":
      return { type: "speak", occasion: "idle", intent: "investigate", tone: "curious", ...neutral };
    case "b":
      return { type: "speak", occasion: "idle", intent: "bored", tone: "grumpy", intensity: "quiet", stance: "familiar" };
    default:
      return null;
  }
}

let state = createPrototypeState();
render(state);

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", (_, key) => {
    const name = key?.name ?? "";
    if (name === "q" || (key?.ctrl && name === "c")) {
      process.stdin.setRawMode(false);
      process.exit(0);
    }
    if (["1", "2", "3", "4"].includes(name)) {
      state = reducePrototype(state, { type: "select", index: Number(name) - 1 });
    } else if (name === "f") {
      state = reducePrototype(state, { type: "toggleFallback" });
    } else if (name === "r") {
      state = reducePrototype(state, { type: "scenario" });
    } else {
      const action = speechAction(name);
      if (action) state = reducePrototype(state, action);
    }
    render(state);
    if (name === "j") {
      console.log(state.scenarioTraces.map((trace) => JSON.stringify(trace)).join("\n"));
    }
  });
} else {
  console.log("\nTTY required for the keyboard prototype.");
}
