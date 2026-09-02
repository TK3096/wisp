import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatScenarioTraceNdjson,
  runScenario,
  type ScenarioDefinition,
} from "../src/scenarioHarness.ts";
import { HUMAN_EVALUATION_SCENARIO_DEFINITIONS } from "../src/humanEvaluationScenarios.ts";
import { bindWasmCognition } from "../src/cognitionFacade.ts";
import {
  DEFAULT_HUMAN_EVALUATION_CRITERIA,
  HUMAN_EVALUATION_DIMENSIONS,
  assignmentDigest,
  createHumanEvaluationPlan,
  humanEvaluationScenarios,
  type HumanEvaluationArm,
  type HumanEvaluationStudyAssets,
  type PublicHumanEvaluationPlan,
} from "../src/humanEvaluation.ts";

const outputDir = path.resolve("docs/evaluations/58-live-cognition");
const studyId = "issue-58";
  const evaluatorIds = ["evaluator-1", "evaluator-2", "evaluator-3"];
  const scenarioById = new Map(
    Object.entries(HUMAN_EVALUATION_SCENARIO_DEFINITIONS).map(([
      id,
      scenario,
    ]) => [id, scenario]),
  );

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseSeed(): number | undefined {
  const environmentSeed = Number(process.env.HUMAN_KIT_SEED);
  if (process.env.HUMAN_KIT_SEED) {
    if (
      !Number.isInteger(environmentSeed) ||
      environmentSeed < 0 ||
      environmentSeed > 0xffffffff
    ) {
      throw new Error("HUMAN_KIT_SEED must be a 32-bit integer");
    }
    return environmentSeed;
  }
  const index = process.argv.indexOf("--seed");
  if (index >= 0) {
    const value = Number(process.argv[index + 1]);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error("--seed must be a 32-bit integer");
    }
    return value;
  }
  // The seed is the secret behind the assignment digest. Require it explicitly
  // for reproduction instead of publishing a seed that reveals future arms.
  return undefined;
}

async function createLiveCognition() {
  const moduleUrl = pathToFileURL(
    path.resolve("public/cognition/wisp_cognition_wasm.js"),
  );
  const wasmUrl = pathToFileURL(
    path.resolve("public/cognition/wisp_cognition_wasm_bg.wasm"),
  );
  const rawModule = (await import(moduleUrl.href)) as {
    WispCognition: new (init: unknown) => unknown;
    initSync: (module: WebAssembly.Module) => void;
  };
  rawModule.initSync(new WebAssembly.Module(readFileSync(wasmUrl)));
  return bindWasmCognition(async () => rawModule as never);
}

function evaluatorForm(kit: PublicHumanEvaluationPlan["kits"][number]): string {
  const dimensionDescriptions: Record<
    (typeof HUMAN_EVALUATION_DIMENSIONS)[number],
    string
  > = {
    "Alive/Aware":
      "looks present and responsive to the situation, not mechanically random",
    Individuality:
      "has a recognizable temperament instead of feeling generic",
    Appropriateness:
      "the type and strength of visible reactions fit what happened",
    Variation:
      "behavior has useful variety without becoming repetitive or chaotic",
    Calm: "feels relaxed and pleasant rather than busy, noisy, or unsettling",
  };
  const ratingRows = HUMAN_EVALUATION_DIMENSIONS.map((dimension) => {
    const cells = ["1", "2", "3", "4", "5"]
      .map((score) => ` ☐ ${score} `)
      .join("|");
    return `| **${dimension}** — ${dimensionDescriptions[dimension]} |${cells}|`;
  }).join("\n");
  const sections = kit.comparisons
    .map((comparison) => {
      const rows = comparison.replays
        .map((replay) => {
          return `### ${replay.label} — ${replay.durationS} seconds\nReplay ID: \`${replay.replayId}\`\nOpen: [behavior replay](../${replay.viewerPath})\n\nCheck exactly one score in every row.\n\n| Dimension | 1 Poor | 2 Below average | 3 Acceptable | 4 Good | 5 Excellent |\n|---|:-:|:-:|:-:|:-:|:-:|\n${ratingRows}`;
        })
        .join("\n\n");
      return `## ${comparison.scenarioCode}\n\n${rows}\n\n**Pair preference:**\n\n- [ ] ${comparison.replays[0]?.label}\n- [ ] ${comparison.replays[1]?.label}\n\n**Describe the main reaction you saw in your own words:**\n\nWhat did the character seem to notice or react to, and what visible behavior changed? Write one or two sentences.\n\n`;
    })
    .join("\n");
  const overallChoices = kit.comparisons
    .flatMap(comparison => comparison.replays.map(replay => `- [ ] ${replay.label} (${comparison.scenarioCode})\n`))
    .join("");
  return `# Wisp Blind Replay Evaluation — ${kit.evaluatorId}\n\nPlease complete this form alone, without inspecting source files, trace data, or page source, and without discussing the replays. Do not record your name or contact information.\n\nBefore starting, close other distracting applications. Watch each replay once at normal speed, then rate it immediately before opening the next replay.\n\nFor every replay, rate all five dimensions. Check exactly one score per dimension. Use the whole scale, not only 4 and 5:\n- **1** = poor\n- **2** = below average\n- **3** = acceptable\n- **4** = good\n- **5** = excellent\n\nAfter each pair, choose the replay you preferred in that pair and describe the main reaction in plain words. After all pairs, choose the one replay you would most want to keep.\n\n${sections}\n## Final Overall Preference\n\nChoose the single replay you would most want running on your desktop.\n\n${overallChoices}\n## Safety\n\nDid any replay feel noisy, overwhelming, or disturbing? If yes, identify only the Replay ID and describe the concern. If no replay caused a concern, leave this section blank. Do not identify yourself or another person.\n\n- Replay ID:\n- Concern:\n\nThank you. Return only this completed form to the study administrator.\n`;
}

function replayViewer(
  events: unknown[],
  durationS: number,
): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wisp Behavior Replay</title>
<style>
:root { color-scheme: dark; font: 14px/1.4 system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #10121a; color: #eee; }
main { width: min(860px, 94vw); }
.stage { position: relative; height: 240px; overflow: hidden; background: linear-gradient(#202638, #131722); border: 1px solid #333; border-radius: 8px; }
.ground { position: absolute; left: 0; right: 0; bottom: 38px; height: 2px; background: #455064; }
.actor { position: absolute; bottom: 40px; width: 48px; height: 48px; font-size: 38px; line-height: 48px; text-align: center; user-select: none; transition: none; }
.actor.flip { transform: scaleX(-1); }
.bubble { position: absolute; max-width: 180px; padding: 5px 8px; border: 1px solid #222; background: #f5f0e8; color: #111; font-size: 12px; border-radius: 2px; }
.bubble:after { content: ""; position: absolute; left: 45%; bottom: -6px; border: 6px solid transparent; border-top-color: #f5f0e8; border-bottom: 0; }
button { border: 1px solid #455064; background: #1b2030; color: #eee; padding: 6px 11px; border-radius: 4px; }
input { width: 100%; }
.controls { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
</style>
<main>
  <div class="stage" id="stage"><div class="ground"></div></div>
  <div class="controls"><button id="restart">Restart</button><button id="toggle">Play</button><input id="seek" type="range" min="0" max="${durationS}" step="0.05" value="0"><span id="clock">0.0s</span></div>
</main>
<script type="module">
const events = ${JSON.stringify(events)};
const duration = ${durationS};
const stage = document.getElementById("stage");
const actors = new Map(); const bubbles = new Map(); const jumpStart = new Map();
let elapsed = 0; let playing = false; let cursor = 0; let previous = performance.now(); let raf = 0;
function apply(event) {
  if (event.type === "character_materialized") {
    const el = document.createElement("div"); el.className = "actor"; el.textContent = "🐣";
    el.style.left = Math.max(24, Math.min(832, event.x / 2.4)) + "px"; stage.appendChild(el);
    actors.set(event.characterId, { el, x: el.offsetLeft, animation: "idle", facing: 1 });
  } else if (event.type === "animation_changed") { const a = actors.get(event.characterId); if (a) a.animation = event.to; }
  else if (event.type === "facing_changed") { const a = actors.get(event.characterId); if (a) { a.facing = event.facing === "left" ? -1 : 1; a.el.classList.toggle("flip", a.facing < 0); } }
  else if (event.type === "jump_started") { jumpStart.set(event.characterId, event.t); }
  else if (event.type === "jump_ended") { jumpStart.delete(event.characterId); }
  else if (event.type === "bubble_started") {
    const el = document.createElement("div"); el.className = "bubble"; el.textContent = event.text;
    const a = actors.get(event.characterId); if (a) el.style.left = (a.x + 24) + "px"; el.style.bottom = "110px"; stage.appendChild(el); bubbles.set(event.characterId, el);
  } else if (event.type === "bubble_ended") { bubbles.get(event.characterId)?.remove(); bubbles.delete(event.characterId); }
  else if (event.type === "character_vanished") { bubbles.get(event.characterId)?.remove(); bubbles.delete(event.characterId); actors.get(event.characterId)?.el.remove(); actors.delete(event.characterId); }
}
function render(delta = 0) {
  for (const [id, actor] of actors) {
    if (actor.animation === "walk") actor.x = Math.max(20, Math.min(790, actor.x + actor.facing * 80 * delta));
    let y = 0; const started = jumpStart.get(id);
    if (started !== undefined) { const p = Math.min(1, Math.max(0, (elapsed - started) / 0.5)); y = Math.sin(p * Math.PI) * 48; }
    actor.el.style.left = actor.x + "px"; actor.el.style.bottom = (40 + y) + "px";
  }
  document.getElementById("seek").value = elapsed; document.getElementById("clock").textContent = elapsed.toFixed(1) + "s";
}
function frame(now) { const delta = (now - previous) / 1000; if (playing) { elapsed += delta; while (cursor < events.length && events[cursor].t <= elapsed) apply(events[cursor++]); if (elapsed >= duration) { playing = false; document.getElementById("toggle").textContent = "Replay"; } render(delta); } previous = now; raf = requestAnimationFrame(frame); }
function reset() { for (const actor of actors.values()) actor.el.remove(); for (const bubble of bubbles.values()) bubble.remove(); actors.clear(); bubbles.clear(); jumpStart.clear(); cursor = 0; elapsed = 0; render(0); }
document.getElementById("toggle").onclick = ({ target }) => { playing = !playing; target.textContent = playing ? "Pause" : "Play"; };
document.getElementById("restart").onclick = () => { reset(); playing = true; document.getElementById("toggle").textContent = "Pause"; };
document.getElementById("seek").oninput = ({ target }) => { reset(); elapsed = Number(target.value); while (cursor < events.length && events[cursor].t <= elapsed) apply(events[cursor++]); render(0); };
render(0); previous = performance.now(); raf = requestAnimationFrame(frame);
</script>`;
}

async function main() {
  const assignmentSeed = parseSeed();
  if (assignmentSeed === undefined) {
    throw new Error(
      "assignment seed is required; pass --seed from the administrator's private record",
    );
  }
  const plan = createHumanEvaluationPlan({
    studyId,
    evaluatorIds,
    assignmentSeed,
    criteria: DEFAULT_HUMAN_EVALUATION_CRITERIA,
  });

  const replaysDir = path.join(outputDir, "replays");
  const formsDir = path.join(outputDir, "forms");
  rmSync(replaysDir, { recursive: true, force: true });
  mkdirSync(replaysDir, { recursive: true });
  mkdirSync(formsDir, { recursive: true });

  const createCognitionHandle = await createLiveCognition();
  const assets: HumanEvaluationStudyAssets = {
    scenarios: [...humanEvaluationScenarios()],
    replaysByScenario: {},
  };

  for (const scenario of assets.scenarios) {
    const definition = scenarioById.get(scenario.id);
    if (!definition) throw new Error(`missing scenario definition: ${scenario.id}`);
    assets.replaysByScenario[scenario.id] = {} as Record<
      HumanEvaluationArm,
      (typeof assets.replaysByScenario)[string][HumanEvaluationArm]
    >;
    for (const arm of ["baseline", "cognition"] as const) {
      const ndjson = formatScenarioTraceNdjson(
        runScenario(definition as ScenarioDefinition, 30, {
          createCognitionHandle:
            arm === "cognition" ? createCognitionHandle : undefined,
        }),
      );
      const digest = sha256(ndjson);
      const replayId = `trace-${digest.slice(0, 12)}`;
      const tracePath = `replays/${replayId}.ndjson`;
      const viewerPath = `replays/${replayId}.html`;
      writeFileSync(path.join(outputDir, tracePath), ndjson, { mode: 0o644 });
      const actorIds = new Map<string, string>();
      const events = ndjson
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) =>
          [
            "character_materialized",
            "animation_changed",
            "facing_changed",
            "jump_started",
            "jump_ended",
            "bubble_started",
            "bubble_ended",
            "character_vanished",
          ].includes(record.type as string),
        )
        .map((record) => {
          const sourceId = String(record.characterId ?? "");
          if (!actorIds.has(sourceId)) {
            actorIds.set(sourceId, `actor-${actorIds.size + 1}`);
          }
          return {
            t: record.clockS,
            type: record.type,
            characterId: record.characterId
              ? actorIds.get(sourceId)
              : undefined,
            x: record.x,
            to: record.to,
            facing: record.facing,
            text: record.text,
          };
        });
      writeFileSync(
        path.join(outputDir, viewerPath),
        replayViewer(events, definition.durationS),
        { mode: 0o644 },
      );
      assets.replaysByScenario[scenario.id]![arm] = {
        scenarioId: scenario.id,
        arm,
        replayId,
        durationS: definition.durationS,
        tracePath,
        viewerPath,
        traceSha256: digest,
      };
    }
  }

  for (const [kitIndex, kit] of plan.publicPlan.kits.entries()) {
    for (const comparison of kit.comparisons) {
      const comparisonIndex = Number(comparison.scenarioCode.slice(1)) - 1;
      const scenarioId = kit.scenarioOrder[comparisonIndex] as string;
      const assignment = plan.privatePlan.assignments[kitIndex]?.assignments[
        comparisonIndex
      ];
      if (assignment?.scenarioId !== scenarioId) {
        throw new Error("private assignment and public kit desynchronized");
      }
      comparison.replays.forEach((replay, replayIndex) => {
        const firstArm = assignment.firstReplayArm;
        const actualArm: HumanEvaluationArm =
          replayIndex === 0
            ? firstArm
            : firstArm === "cognition"
              ? "baseline"
              : "cognition";
        const asset = assets.replaysByScenario[scenarioId]![actualArm]!;
        replay.tracePath = asset.tracePath;
        replay.viewerPath = asset.viewerPath;
        replay.traceSha256 = asset.traceSha256;
      });
    }
  }

  plan.publicPlan.manifest.assignmentDigest = await assignmentDigest(plan.privatePlan);
  plan.publicPlan.manifest.replayAssets = Object.values(
    assets.replaysByScenario,
  ).flatMap((pair) =>
    Object.values(pair).map((replay) => ({
      replayId: replay.replayId,
      path: replay.tracePath,
      viewerPath: replay.viewerPath,
      sha256: replay.traceSha256,
    })),
  );

  writeFileSync(
    path.join(outputDir, "manifest.json"),
    json(plan.publicPlan.manifest),
    { mode: 0o644 },
  );
  writeFileSync(path.join(outputDir, "kits.json"), json(plan.publicPlan.kits), {
    mode: 0o644,
  });
  writeFileSync(
    path.join(outputDir, "results.template.json"),
    json({
      schemaVersion: 1,
      studyId,
      responses: [
        {
          evaluatorId: "evaluator-1",
          ratings: plan.publicPlan.kits[0]!.comparisons.flatMap((comparison) =>
            comparison.replays.map((replay) => ({
              replayId: replay.replayId,
              scores: {
                "Alive/Aware": 0,
                Individuality: 0,
                Appropriateness: 0,
                Variation: 0,
                Calm: 0,
              },
            })),
          ),
          preferredReplayId: "",
          pairPreferredReplayIds: plan.publicPlan.kits[0]!.comparisons.map(() => ""),
          principalReactionDescriptions: Object.fromEntries(
            plan.publicPlan.kits[0]!.comparisons.map((comparison) => [
              comparison.scenarioCode,
              "",
            ]),
          ),
          principalReactionCorrect: Object.fromEntries(
            plan.publicPlan.kits[0]!.comparisons.map((comparison) => [
              comparison.scenarioCode,
              false,
            ]),
          ),
          safetyReports: [],
        },
      ],
    }),
    { mode: 0o644 },
  );

  for (const kit of plan.publicPlan.kits) {
    const formPath = path.join(formsDir, `${kit.evaluatorId}.md`);
    if (existsSync(formPath) && !process.argv.includes("--overwrite-forms")) {
      console.log(`Preserving completed/issued form: ${formPath}`);
      continue;
    }
    writeFileSync(formPath, evaluatorForm(kit), { mode: 0o644 });
  }

  writeFileSync(
    path.join(outputDir, "assignments.private.json"),
    json(plan.privatePlan),
    { mode: 0o600 },
  );
  writeFileSync(path.join(outputDir, "study-assets.private.json"), json(assets), {
    mode: 0o600,
  });
  writeFileSync(
    path.join(outputDir, ".gitignore"),
    "assignments.private.json\nstudy-assets.private.json\n",
    { mode: 0o644 },
  );
  writeFileSync(
    path.join(outputDir, "ADMIN.md"),
    `# Issue #58 evaluation administration\n\nStatus: **activated by product-owner waiver; human evaluation remains open**. One pilot evaluator completed, but at least two more independent evaluators are still required.\n\nThe default numeric gates in \`manifest.json\` are proposed, not accepted. Do not mark \`acceptedByProductOwner\` true without an explicit decision recorded on issue #58. Existing issued/completed forms are preserved unless \`--overwrite-forms\` is supplied.\n\n- Keep \`assignments.private.json\` and \`study-assets.private.json\` uncommitted and give them only to the study administrator.\n- Give each evaluator only their form and replay links/files.\n- Do not reveal A/B identities until ratings and free-text descriptions are captured.\n- After collection, code each free-text principal reaction as true/false in \`results.json\`; do not attach evaluator names or contact details.\n- Verify with \`evaluateHumanResults()\` using the public plan, private assignments, and responses.\n- A pass still requires the product decision; a safety report blocks activation and must be recorded with its scenario. Reassess the current waiver against the later evidence.\n`,
    { mode: 0o644 },
  );
  writeFileSync(
    path.join(outputDir, "README.md"),
    `# Live-cognition human A/B kit\n\nThis kit does not claim that the human evaluation required by issue #58 has passed. It contains four 70-second deterministic scenario traces rendered at 30 Hz with baseline-neutral behavior and optimized WASM cognition. Each scenario passed an automated visible-behavior precheck: it differs in at least one scheduler-owned bubble or jump event between arms. Each evaluator receives two differently labeled replays per scenario, with both scenario order and first-replay arm randomized. The committed manifest binds the hidden assignment mapping only by SHA-256.\n\nThe experimental live app uses \`COGNITION_LIVE_DEFAULT_ENABLED = true\` under an explicit product-owner waiver; this is not acceptance. The included replay viewer is a behavior-event preview for reviewer convenience, not the production Pixi renderer. Before treating visual responses as final acceptance evidence, the product owner should accept this presentation or reproduce the same traces through the desktop rendering stack and use those recordings instead.\n\nForms are under \`forms/\`; replay checksums are in \`manifest.json\`. The study remains open because only one external human evaluator has participated and the numeric gates have not passed.\n`,
    { mode: 0o644 },
  );

  console.log(`Generated ${outputDir}`);
  console.log(`Assignment digest: ${plan.publicPlan.manifest.assignmentDigest}`);
  console.log(`Private assignment seed (do not commit): ${assignmentSeed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
