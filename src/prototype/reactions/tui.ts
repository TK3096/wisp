import {
  PROFILE_ORDER,
  PROFILES,
  behaviorBias,
  behaviorRng,
  candidates,
  createBehavior,
  createState,
  derivativeNorm,
  observe,
  projectBelief,
  surpriseGate,
  surpriseEnergy,
  tick,
  tickBehavior,
  type ProfileName,
} from "./model.ts";
import * as readline from "node:readline";

let profile: ProfileName = "balanced";
let state = createState(profile);
let behavior = createBehavior();
let rng = behaviorRng(3939);

function advanceSeconds(seconds: number): void {
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i++) {
    tick(state);
    tickBehavior(state, behavior, rng);
  }
}

function stimulus(kind: Parameters<typeof observe>[1]): void {
  observe(state, kind);
  advanceSeconds(0.1);
}

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
    case "3": {
      profile = PROFILE_ORDER[Number(key.sequence) - 1] as ProfileName;
      resetState();
      break;
    }
    case " ":
      advanceSeconds(0.1);
      break;
    case ".":
      advanceSeconds(1);
      break;
    case ",":
      advanceSeconds(5);
      break;
    case "g":
      stimulus("strongGesture");
      break;
    case "h":
      stimulus("weakGesture");
      break;
    case "f":
      stimulus("appFocus");
      break;
    case "u":
      stimulus("appBlur");
      break;
    case "x":
      behavior.jumpRollS = 0;
      break;
    case "b":
      behavior.bubbleRollS = 0;
      break;
    case "r":
      resetState();
      break;
    case "q":
      shutdown();
      return;
  }
  render();
});

function resetState(): void {
  state = createState(profile);
  behavior = createBehavior();
  rng = behaviorRng(3939);
}

function render(): void {
  const belief = projectBelief(state);
  const gate = surpriseGate(state);
  const energy = surpriseEnergy(state);
  const norm = derivativeNorm(state);
  const reaction = state.reaction;
  const bias = behaviorBias(state);
  const candidateLines = candidates(state)
    .map((candidate) => {
      const blockedByCooldown = state.clockS < state.nextEligibleS[candidate.kind];
      const status = candidate.eligible && !blockedByCooldown ? "READY" : blockedByCooldown ? "cooldown" : "below";
      return `  ${candidate.kind.padEnd(9)} score ${candidate.score.toFixed(2)} / ${candidate.threshold.toFixed(2)}  ${status}`;
    });

  const lines = [
    "PROTOTYPE — micro-belief + Temporal Derivative → short reactions",
    "",
    `Profile: ${state.profile.padEnd(8)} clock ${state.clockS.toFixed(1)}s   pending ${state.pending.length}   last stimulus ${state.lastStimulus ?? "none"}`,
    `Personality: energy ${pct(state.personality.energy)}  curiosity ${pct(state.personality.curiosity)}  boldness ${pct(state.personality.boldness)}  sociability ${pct(state.personality.sociability)}`,
    "",
    "Temporal Derivative (fast − slow, 10 Hz)",
    `  fast ${vec(state.fast)}   slow ${vec(state.slow)}`,
    `  derivative ${vec(state.derivative)}   norm ${norm.toFixed(2)}   gate ${pct(gate)}   energy ${pct(energy)}`,
    "",
    "LeakyIntegrator Micro-belief",
    `  channels change ${num(state.belief[0])}  social ${num(state.belief[1])}  habit ${num(state.belief[2])}  caution ${num(state.belief[3])}`,
    `  projected novelty ${num(belief.novelty)}  familiarity ${num(belief.familiarity)}  social ${num(belief.social)}  caution ${num(belief.caution)}`,
    "",
    "Affect / reaction state",
    `  surprise ${num(state.affect.surprise)}  valence ${signed(state.affect.valence)}  arousal ${num(state.affect.arousal)}  boredom ${num(state.boredom)}`,
    `  active ${reaction ? `${reaction.kind} score ${reaction.score.toFixed(2)} for ${reaction.remainingS.toFixed(1)}s` : "none"}   reaction lock ${state.reactionLockS.toFixed(1)}s`,
    ...candidateLines,
    "",
    "Behavior scheduler (biases only — no direct command)",
    `  mode ${behavior.mode} ${behavior.modeTimerS.toFixed(1)}s   airborne ${behavior.airborneS === null ? "no" : `${behavior.airborneS.toFixed(1)}s`}   last ${behavior.lastExpression} / ${behavior.lastBubble}`,
    `  next jump roll ${behavior.jumpRollS.toFixed(1)}s   next bubble roll ${behavior.bubbleRollS.toFixed(1)}s   cooldown ${behavior.bubbleCooldownS.toFixed(1)}s`,
    `  bias idleDwell ×${bias.idleDwell.toFixed(2)}  walkSpeed ×${bias.walkSpeed.toFixed(2)}  jump ×${bias.jumpChance.toFixed(2)}  bubble ×${bias.bubbleChance.toFixed(2)}  pace ×${bias.animationPace.toFixed(2)}`,
    "",
    `History: ${state.history.join("  |  ")}`,
    "",
    "Keys",
    "  [1-3] profile  [space] 0.1s  [.] 1s  [,] 5s  [g] strong gesture  [h] weak/unfamiliar gesture",
    "  [f] app focus  [u] app blur  [x] force jump roll  [b] force bubble roll  [r] reset  [q] quit",
  ];

  process.stdout.write(`\x1b[2J\x1b[H${lines.join("\n")}\n`);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function num(value: number): string {
  return value.toFixed(2);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function vec(values: readonly number[]): string {
  return `[${values.map((value) => value.toFixed(2)).join(", ")}]`;
}

function shutdown(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

process.stdout.write(`Profiles: ${PROFILE_ORDER.map((name) => `${name} ${pct(PROFILES[name].boldness)} bold`).join(", ")}\n`);
render();
process.stdin.resume();
