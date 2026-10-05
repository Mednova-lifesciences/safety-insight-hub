import { describe, expect, it, vi } from "vitest";

/**
 * Leaving a case out must not renumber anyone else.
 *
 * A case without its own ID gets one from its row position. If decided
 * rows were removed before mapping, every later case would carry a
 * different ID on the next export and VigiFlow would see existing patients
 * as new cases. So every row is mapped, and decided cases are removed from
 * the result. This drives the real mapping to prove the IDs hold.
 *
 * MedDRA coding is stubbed: it is the only part of this path that needs a
 * server, and nothing here is about coding.
 */
vi.mock("./coding-provider", async () => {
  const actual = await vi.importActual<typeof import("./coding-provider")>("./coding-provider");
  return { ...actual, meddra29Provider: actual.unavailableMedDraProvider };
});

const { mapJobToCases } = await import("./export");
const { unconfiguredOrgRegulatoryConfig } = await import("./regulatory-config");
const { excludeDecidedCases } = await import("@/services/api/linelist-decisions");

const TRANSMISSION = {
  environment: "uat" as const,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND-01" },
  receiver: { identifier: "NAFDAC-RCV-01" },
  reportType: "1" as const,
  reportTypeConfirmed: true,
};

const config = () => ({ ...unconfiguredOrgRegulatoryConfig(), transmission: TRANSMISSION });

// No case_id on any row: every ID is generated from row position.
const row = (patient: string) => ({
  patient_identifier: patient,
  product: "Penta",
  reaction: "Fever",
  outcome: "Recovered",
  reporter_designation: "Nurse",
});

const job = {
  id: "job-decisions",
  filename: "ondo_aefi.csv",
  sourceProfileId: "generic-verbatim",
  mapping: { Patient: "patient_identifier" },
  parsedRows: [row("A.A."), row("B.B."), row("C.C."), row("D.D.")],
};

describe("dropping a case leaves every other case's ID where it was", () => {
  it("keeps generated IDs stable when an earlier row is dropped", async () => {
    const { cases } = await mapJobToCases(job, config());
    const before = cases.map((c) => [c.internalCaseId, c.sendersCaseId]);

    const { included, dropped, held } = excludeDecidedCases(
      cases,
      [
        { row: 1, decision: "DROP", reason: "DUPLICATE", by: "A", at: "2026-10-05T10:00:00Z" },
        { row: 3, decision: "STEP_DOWN", by: "A", at: "2026-10-05T10:00:00Z" },
      ],
      job.parsedRows.length,
    );

    expect({ dropped, held }).toEqual({ dropped: 1, held: 1 });
    expect(included.map((c) => [c.internalCaseId, c.sendersCaseId])).toEqual([before[1], before[3]]);
  });

  it("would have renumbered them had rows been removed first — the trap this avoids", async () => {
    const { cases: all } = await mapJobToCases(job, config());
    const { cases: filteredFirst } = await mapJobToCases(
      { ...job, parsedRows: [job.parsedRows[1]!, job.parsedRows[3]!] },
      config(),
    );
    expect(filteredFirst.map((c) => c.sendersCaseId)).not.toEqual([
      all[1]!.sendersCaseId,
      all[3]!.sendersCaseId,
    ]);
  });
});
