import { createServer } from "vite";
import { expect, it } from "vitest";

it("loads generated cognition through the module graph, not /public", async () => {
  const server = await createServer({
    logLevel: "error",
    server: { middlewareMode: true },
  });
  try {
    const response = await server.transformRequest("/src/cognitionFacade.ts");
    expect(response?.code).toBeDefined();
    expect(response?.code).not.toContain('"/cognition/wisp_cognition_wasm.js"');
    expect(response?.code).toContain("/src/cognitionWasm/wisp_cognition_wasm.js");
    await expect(
      server.transformRequest("/src/cognitionWasm/wisp_cognition_wasm.js"),
    ).resolves.toEqual(
      expect.objectContaining({
        code: expect.stringContaining("export class WispCognition"),
      }),
    );
  } finally {
    await server.close();
  }
});
