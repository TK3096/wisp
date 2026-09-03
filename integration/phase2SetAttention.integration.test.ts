import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { bindWasmCognition, CognitionWasmModule } from "../src/cognitionFacade";
import { CognitionHandle, CognitionInit } from "../src/cognition";
import {
  buildSetAttentionDeterministicReport,
} from "../src/phase2SetAttentionAcceptance";

async function createLiveCognition(): Promise<
  (init: CognitionInit) => CognitionHandle
> {
  const moduleUrl = new URL(
    "../src/cognitionWasm/wisp_cognition_wasm.js",
    import.meta.url,
  );
  const wasmUrl = new URL(
    "../src/cognitionWasm/wisp_cognition_wasm_bg.wasm",
    import.meta.url,
  );
  const rawModule = (await import(moduleUrl.href)) as unknown as {
    WispCognition: new (init: CognitionInit) => unknown;
    initSync: (module: WebAssembly.Module) => void;
  };
  rawModule.initSync(new WebAssembly.Module(readFileSync(fileURLToPath(wasmUrl))));
  return bindWasmCognition(async () => rawModule as unknown as CognitionWasmModule);
}

it("validates deterministic Set Attention gates and remains blocked on human evaluation", async () => {
  const report = buildSetAttentionDeterministicReport({
    createCognitionHandle: await createLiveCognition(),
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const outputPath = process.env.PHASE2_SET_ATTENTION_OUTPUT;
  if (outputPath) {
    mkdirSync(new URL(".", `file://${outputPath}`).pathname, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  expect(report.scenario).toEqual({
    name: "phase2-social-soak-8x300",
    durationS: 300,
    characters: 8,
  });
  const gateByName = new Map(report.gates.map((gate) => [gate.name, gate]));
  for (const name of [
    "five-minute-soak-and-bounds",
    "byte-identical-replay",
    "membership-lifecycle",
    "individuality-under-influence",
    "projection-spread-retention",
    "population-pass-budget",
    "scheduler-authority",
  ]) {
    expect(gateByName.get(name)?.status).toBe("pass");
  }
  expect(gateByName.get("gradual-first-influence")?.status).toBe("pass");
  expect(report.blockers).toEqual([
    "human-blind-evaluation: pending",
  ]);
  expect(report.status).toBe("blocked");
}, 60_000);
