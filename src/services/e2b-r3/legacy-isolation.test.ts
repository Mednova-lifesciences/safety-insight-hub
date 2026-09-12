import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level proof that the validated E2B(R3) export path
 * (src/services/e2b-r3/export.ts, and the UI button that calls it) never
 * reaches the legacy, non-R3-conformant generator
 * (src/services/api/e2b.ts's buildE2bXml / the "Generate E2B(R3)"
 * preview-draft button). A grep/import-graph check, not a runtime mock —
 * this catches the mistake at the source, before it could ever produce a
 * real download.
 */
describe("legacy generator isolation", () => {
  const exportTs = readFileSync(join(__dirname, "export.ts"), "utf-8");
  const routeTsx = readFileSync(join(__dirname, "..", "..", "routes", "_app", "e2b.tsx"), "utf-8");
  const legacyE2bTs = readFileSync(join(__dirname, "..", "api", "e2b.ts"), "utf-8");

  it("buildE2bXml (the legacy generator's actual XML builder) is not exported at all", () => {
    expect(legacyE2bTs).toMatch(/^function buildE2bXml\(/m);
    expect(legacyE2bTs).not.toMatch(/^export function buildE2bXml\(/m);
  });

  it("the validated export module (export.ts) imports only readJob from the legacy module — never its XML-building or generate/download functions", () => {
    const legacyImportMatch = exportTs.match(/import \{([^}]*)\} from "@\/services\/api\/e2b";/);
    expect(legacyImportMatch).not.toBeNull();
    const importedSymbols = legacyImportMatch![1]!.split(",").map((s) => s.trim());
    expect(importedSymbols).toContain("readJob");
    expect(importedSymbols).not.toContain("buildE2bXml");
    // No import of the `e2b` API object itself (the thing whose
    // .generate()/.download() methods drive the legacy button) — only
    // named helpers/types, checked one destructured symbol at a time so
    // the module-path string "api/e2b" itself never causes a false match.
    expect(importedSymbols.some((s) => s === "e2b" || s.endsWith(" e2b"))).toBe(false);
    expect(exportTs).not.toMatch(/buildE2bXml/);
    expect(exportTs).not.toMatch(/e2bApi\.(generate|download)/);
  });

  it("the E2B(R3) page's 'Download validated E2B(R3) XML' button calls only the validated pipeline", () => {
    const buttonBlock = routeTsx.slice(
      routeTsx.indexOf("Download validated E2B(R3) XML") - 400,
      routeTsx.indexOf("Download validated E2B(R3) XML") + 50,
    );
    expect(buttonBlock).toContain("exportValidated");
    // The legacy generator's own button text/handler must not appear anywhere near this one.
    expect(buttonBlock).not.toContain("e2bApi.generate");
    expect(buttonBlock).not.toContain("e2bApi.download");
  });

  it("exportValidated() itself (the button's handler) calls only generateValidatedExportForJob/downloadValidatedBatch, never e2bApi", () => {
    const handlerMatch = routeTsx.match(
      /async function exportValidated\(jobId: string\) \{[\s\S]*?\n {2}\}/,
    );
    expect(handlerMatch).not.toBeNull();
    const handler = handlerMatch![0];
    expect(handler).toContain("generateValidatedExportForJob");
    expect(handler).toContain("downloadValidatedBatch");
    expect(handler).not.toContain("e2bApi.");
  });
});

describe("the legacy generator is unreachable from the UI", () => {
  const routeTsx = readFileSync(join(__dirname, "..", "..", "routes", "_app", "e2b.tsx"), "utf-8");

  it("no button invokes the legacy generate/download/dismiss handlers", () => {
    // The legacy generator emits a flat E2B(R2)-shaped <ichicsr> draft whose
    // own header says it "must never be presented to NAFDAC, loaded into
    // VigiFlow, or described as E2B(R3)-compliant" — while the button that
    // called it was labelled "Generate E2B(R3)". Two adjacent downloads, one
    // conformant and one explicitly not, is not a safe thing to ship; the
    // buttons were removed and this keeps them from coming back.
    expect(routeTsx).not.toMatch(/e2bApi\.generate\(/);
    expect(routeTsx).not.toMatch(/e2bApi\.download\(/);
    expect(routeTsx).not.toMatch(/e2bApi\.dismissErrors\(/);
  });

  it("the retired button labels are gone from the page", () => {
    // Matched outside the explanatory comment that records why they went.
    const withoutComments = routeTsx.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(withoutComments).not.toMatch(/>\s*Generate E2B\(R3\)\s*</);
    expect(withoutComments).not.toMatch(/Download XML/);
    expect(withoutComments).not.toMatch(/Dismiss Errors/);
  });

  it("the validated export button survives — this must not remove the real path", () => {
    expect(routeTsx).toMatch(/Download validated E2B\(R3\) XML/);
    expect(routeTsx).toMatch(/Run VigiFlow preflight/);
    expect(routeTsx).toMatch(/exportValidated/);
  });
});
