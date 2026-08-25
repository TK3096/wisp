import * as readline from "node:readline";
import {
  ARCHETYPE_ORDER,
  advance,
  applyReward,
  behaviorBias,
  bubbleWeights,
  createPersonality,
  effectiveDimensions,
  markExpression,
  observeOpenPalm,
  projectBehavior,
  REWARD,
  type ArchetypeName,
} from "./model.ts";

// `ARCHETYPE_ORDER` is declared in the TUI shell so the pure model has no display ordering.

let state = createPersonality("mask-dude", 1001);
let seed = 1001;

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("keypress", (_chunk, key) => {
  if (!key) return;
  if (key.ctrl && key.name === "c") {
    shutdown();
    return;
  }

  switch (key.sequence) {
    case "1":
    case "2":
    case "3":
    case "4": {
      const archetype = ARCHETYPE_ORDER[Number(key.sequence) - 1] as ArchetypeName;
      state = createPersonality(archetype, seed);
      break;
    }
    case " ":
      advance(state, 0.1);
      break;
    case "g":
      observeOpenPalm(state, 0.85);
      break;
    case "j":
      markExpression(state, "jump");
      break;
    case "w":
      markExpression(state, "walk");
      break;
    case "b":
      markExpression(state, "bubble");
      break;
    case "+":
    case "=":
      applyReward(state, { kind: "delight" });
      break;
    case "-":
      applyReward(state, { kind: "dismiss" });
      break;
    case "n":
      seed += 1;
      state = createPersonality(state.archetype, seed);
      break;
    case "r":
      seed = 1001;
      state = createPersonality(state.archetype, seed);
      break;
    case "q":
      shutdown();
      return;
  }
  render();
});

function render(): void {
  const behavior = projectBehavior(state);
  const bias = behaviorBias(state);
  const weights = bubbleWeights(state)
    .slice()
    .sort((a, b) => b.weight - a.weight);
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  const base = state.baseDimensions;
  const effective = effectiveDimensions(state);
  const drift = state.drift;
  const creditAge =
    state.lastExpressionAt === null ? null : state.clock - state.lastExpressionAt;

  const lines = [
    "PROTOTYPE — personality → observable Wisp behavior",
    "",
    `Archetype: ${state.archetype}   seed: ${state.seed}   clock: ${state.clock.toFixed(1)}s   last expression: ${state.lastExpression ?? "none"} (${creditAge === null ? "no credit" : `${creditAge.toFixed(1)}s ago`})`,
    `Base:       energy ${fmtPct(base.energy)}  curiosity ${fmtPct(base.curiosity)}  boldness ${fmtPct(base.boldness)}  sociability ${fmtPct(base.sociability)}`,
    `Drift:      energy ${fmtSigned(drift.energy)}  curiosity ${fmtSigned(drift.curiosity)}  boldness ${fmtSigned(drift.boldness)}  sociability ${fmtSigned(drift.sociability)}`,
    `Effective:  energy ${fmtPct(effective.energy)}  curiosity ${fmtPct(effective.curiosity)}  boldness ${fmtPct(effective.boldness)}  sociability ${fmtPct(effective.sociability)}`,
    `Affect: valence ${fmtNum(state.affect.valence)}  arousal ${fmtPct(state.affect.arousal)}  surprise ${fmtPct(state.affect.surprise)}`,
    `Reward drift: ±${REWARD.step.toString()} per event, ±${REWARD.maxDrift.toString()} cap, ${REWARD.creditWindowS}s credit window, session only`,
    "",
    "Concrete behavior",
    `  idle dwell: ${behavior.idleDwellRange.min.toFixed(2)}–${behavior.idleDwellRange.max.toFixed(2)} s`,
    `  idle→walk urge: ${(60 / ((behavior.idleDwellRange.min + behavior.idleDwellRange.max) / 2)).toFixed(1)} walks/min`,
    `  walk speed: ${behavior.walkSpeed.toFixed(1)} px/s`,
    `  jump chance at roll: ${(behavior.jumpChanceAtRoll * 100).toFixed(0)}%`,
    `  bubble chance at roll: ${(behavior.bubbleChanceAtRoll * 100).toFixed(0)}%`,
    `  animation tone/pace: ${behavior.animationTone} ×${behavior.animationPace.toFixed(2)}  (idle ${(8 * behavior.animationPace).toFixed(1)} fps, walk ${(10 * behavior.animationPace).toFixed(1)} fps)`,
    "",
    "BehaviorBias-compatible multipliers",
    `  idleDwell ×${bias.idleDwell.toFixed(2)}   walkSpeed ×${bias.walkSpeed.toFixed(2)}   jumpChance ×${bias.jumpChance.toFixed(2)}   bubbleChance ×${bias.bubbleChance.toFixed(2)}   animationPace ×${bias.animationPace.toFixed(2)}`,
    "",
    "Bubble tone mix",
    ...weights.map((entry) => `  ${entry.tone.padEnd(9)} ${(100 * entry.weight / totalWeight).toFixed(1)}%`),
    `  sampled bubble: ${state.lastBubble.text} (${state.lastBubble.tone})`,
    "",
    "Feedback semantics being tested",
    "  open-palm = stimulus, not reward   delight/dismiss = explicit reward   spawn/despawn = archetype-level evidence",
    "",
    "Keys",
    "  [1-4] archetype  [space] tick 0.1s  [g] open palm  [j] express jump  [w] express walk  [b] express bubble",
    "  [+] delight  [-] dismiss  [n] next seed  [r] reset  [q] quit",
  ];

  process.stdout.write(`\x1b[2J\x1b[H${lines.join("\n")}\n`);
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function fmtNum(value: number): string {
  return value.toFixed(2);
}

function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function shutdown(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

process.stdout.write("Starting personality prototype…\n");
render();
process.stdin.resume();
