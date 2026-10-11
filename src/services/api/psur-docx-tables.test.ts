import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import { buildScreeningDirectiveDocx } from "./psur";
import { buildScreeningDirectiveModel } from "@/services/psur/screening-directive";
import { SCREENING_CHECKS } from "@/services/psur/screening-checklist";
import type { PsurDocument } from "@/types/pv";

/**
 * Tables in the Word downloads must store real column widths.
 *
 * A table set to "100%" with no column widths stores 100-twip columns
 * (0.07 in). Desktop Word stretches it anyway; Google Docs on a Chromebook
 * and LibreOffice follow the stored widths, so every column became a
 * sliver and the text ran down the page a word at a time — reported on a
 * screening directive opened on a Chromebook.
 */
const A4_TEXT_WIDTH = 9026; // twips, A4 with 1-inch margins

function directiveDoc(): PsurDocument {
  return {
    id: "psur-t",
    filename: "report.pdf",
    product: "Test product",
    reportingPeriod: "01 Jul 2025 - 30 Jun 2026",
    uploadedAt: "2026-08-13T09:00:00Z",
    uploadedBy: "Officer",
    stage: "REVIEWED",
    pages: 10,
    workflowStage: "RETURNED_TO_MAH",
    administrativeScreening: {
      performedAt: "2026-08-13T09:05:00Z",
      // Blank details, so the "Submission details not stated" table appears too.
      submissionDetails: {
        productName: "Test product",
        activeSubstance: "",
        nafdacRegNo: "",
        mah: "",
        qppv: "",
        qppvContact: "",
        ibd: "",
        firstNafdacRegistrationDate: "",
        dlp: "2026-06-30",
        intervalCovered: "01 Jul 2025 - 30 Jun 2026",
        dateReceived: "2026-08-13T09:00:00Z",
      },
      checks: SCREENING_CHECKS.map((d) => ({
        id: d.id,
        status: "NO" as const,
        deficiency: "Not found in the submission.",
        assistGenerated: false,
      })),
      assistGenerated: false,
      outcome: {
        decision: "COMPLIANCE_DIRECTIVE",
        citedItems: [1, 2],
        deficiencies: "Address the items below.",
        conclusions: "Administratively incomplete.",
        officerName: "Officer",
        mahResponseDeadline: "2026-09-30",
        nextPsurDueDate: "2027-06-30",
        by: "Officer",
        at: "2026-08-14T10:00:00Z",
      },
    },
  } as PsurDocument;
}

async function tablesOf(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")!.async("string");
  return [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map((m) => {
    const t = m[1]!;
    return {
      gridCols: [...t.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((g) => Number(g[1])),
      fixedLayout: /<w:tblLayout w:type="fixed"\/>/.test(t),
      percentWidth: /<w:tblW[^>]*w:type="pct"/.test(t),
    };
  });
}

describe("Word downloads store real table widths", () => {
  it("the screening directive's tables fill the page with readable columns", async () => {
    const model = buildScreeningDirectiveModel(directiveDoc())!;
    expect(model.failedRows.length).toBe(16);
    expect(model.missingDetailRows.length).toBeGreaterThan(0);
    const tables = await tablesOf(await Packer.toBlob(buildScreeningDirectiveDocx(model)));
    expect(tables.length).toBe(2);
    for (const t of tables) {
      expect(t.percentWidth).toBe(false);
      expect(t.fixedLayout).toBe(true);
      const total = t.gridCols.reduce((a, b) => a + b, 0);
      expect(Math.abs(total - A4_TEXT_WIDTH)).toBeLessThanOrEqual(t.gridCols.length);
      // No column narrower than half an inch (720 twips).
      expect(Math.min(...t.gridCols)).toBeGreaterThanOrEqual(720);
    }
  });
});
