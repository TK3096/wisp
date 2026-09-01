import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bindWasmCognition, CognitionWasmModule } from "../src/cognitionFacade";
import { CognitionHandle, CognitionInit } from "../src/cognition";
import {
  PHASE1_STRESS_SCENARIO,
  formatScenarioTraceNdjson,
  runScenario,
} from "../src/scenarioHarness";
import {
  PHASE1_ACCEPTANCE_THRESHOLDS,
  buildPhase1AcceptanceReport,
} from "../src/phase1Acceptance";

async function createLiveCognition(): Promise<
  (init: CognitionInit) => CognitionHandle
> {
  const moduleUrl = new URL(
    "../public/cognition/wisp_cognition_wasm.js",
    import.meta.url,
  );
  const wasmUrl = new URL(
    "../public/cognition/wisp_cognition_wasm_bg.wasm",
    import.meta.url,
  );
  const rawModule = (await import(moduleUrl.href)) as unknown as {
    WispCognition: new (init: CognitionInit) => unknown;
    initSync: (module: WebAssembly.Module) => void;
  };
  const bytes = readFileSync(fileURLToPath(wasmUrl));
  rawModule.initSync(new WebAssembly.Module(bytes));
  return bindWasmCognition(
    async () => rawModule as unknown as CognitionWasmModule,
  );
}

function git(command: string[]): string {
  return execFileSync("git", command, { encoding: "utf8" }).trim();
}

it("proves Phase 1 with canonical scenarios, measured budgets, and persistence", async () => {
  const initStartedAt = performance.now();
  const createCognitionHandle = await createLiveCognition();
  const wasmInitializationMs = performance.now() - initStartedAt;

  const cpuBefore = process.cpuUsage();
  const memoryBefore = process.memoryUsage().heapUsed;
  formatScenarioTraceNdjson(
    runScenario(PHASE1_STRESS_SCENARIO, 30, { createCognitionHandle }),
  );
  const cpuAfter = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage().heapUsed;
  const cpuMillisecondsPerSimulatedSecond =
    (cpuAfter.user + cpuAfter.system) / 1000 / PHASE1_STRESS_SCENARIO.durationS;

  const report = await buildPhase1AcceptanceReport({
    createCognitionHandle,
    wasmInitializationMs,
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      runtime: "node",
      runtimeVersion: process.version,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
    },
    buildIdentity: {
      packageVersion: "0.1.0",
      gitBranch: git(["branch", "--show-current"]),
      gitSha: git(["rev-parse", "HEAD"]),
      gitDirty: git(["status", "--porcelain"]).length > 0,
    },
    memoryBeforeBytes: memoryBefore,
    memoryAfterBytes: memoryAfter,
    cpuMillisecondsPerSimulatedSecond,
  });

  const outputPath = process.env.PHASE1_ACCEPTANCE_OUTPUT;
  if (outputPath) {
    mkdirSync(new URL(".", `file://${outputPath}`).pathname, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  expect(report.canonicalScenarios).toHaveLength(8);
  expect(report.canonicalScenarios.map((scenario) => scenario.passed)).toEqual(
    Array(8).fill(true),
  );
  expect(report.persistenceChecks.map((check) => check.passed)).toEqual(
    Array(5).fill(true),
  );
  expect(report.budgets).toHaveLength(9);
  expect(report.budgets.map((budget) => budget.status)).toEqual(
    Array(9).fill("pass"),
  );
  expect(report.determinism).toMatchObject({
    passed: true,
    identicalScenarios: report.determinism.totalScenarios,
  });
  expect(report.stressReplay).toMatchObject({
    durationS: 120,
    characters: 8,
    renderScheduleHz: 30,
    cognitionCadenceHz: 10,
    droppedTraceEvents: 0,
  });
  expect(report.blockers).toEqual([]);
  expect(report.status).toBe("pass");
  expect(PHASE1_ACCEPTANCE_THRESHOLDS.frameTimeP95Ms).toBeCloseTo(1000 / 30, 2);
}, 30_000);
