import { describe, expect, it } from "vitest";
import { validateVigiFlowBatch, validateVigiFlowPreflight } from "./validation";
import { MAX_ICSRS_PER_BATCH, splitIntoBatches } from "./batching";
import { mapSourceRecordToPVCase } from "./mapping";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";
import type { PVCase } from "./types";

/**
 * VigiFlow readiness — deliberately SEPARATE from XSD validation.
 *
 * A file can be perfectly schema-valid and still be rejected by UMC's
 * validated import, because the import checks things a schema cannot:
 * that a report type is set, that the reporter is qualified, that at
 * least one reaction is MedDRA-coded, that at least one drug is suspect,
 * and that the file is not too long.
 *
 * Every case below therefore asserts a PREFLIGHT outcome, not a schema
 * outcome. Passing these is not VigiFlow acceptance — see
 * docs/VIGIFLOW-IMPORT-TEST.md, which is where a real import result goes.
 */

const CONFIG: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
  receiver: { identifier: "NAFDAC-RCV" },
  reportType: "1",
  reportTypeConfirmed: true,
};

async function caseFor(
  row: Record<string, string | undefined>,
  config: E2bTransmissionConfig = CONFIG,
) {
  const { pvCase } = await mapSourceRecordToPVCase(
    {
      case_id: "OG-901",
      patient_identifier: "A.B.",
      patient_id: "OGH/2026/04130",
      product: "Penta",
      reaction: "Fever",
      outcome: "Recovered",
      reporter_name: "Dr Ada Obi",
      reporter_designation: "Doctor",
      ...row,
    },
    { ...genericVerbatimProfile, patientRecordNumberSource: "HOSPITAL" },
    config,
    { jobId: "j", sourceFile: "f.csv", sourceRow: 1, processedAt: "2026-09-28T00:00:00Z" },
    { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
  );
  return pvCase;
}

const codes = (errs: { code: string }[]) => errs.map((e) => e.code);
const blocking = (errs: { code: string; severity: string }[]) =>
  errs.filter((e) => e.severity === "BLOCKING").map((e) => e.code);

describe("report type (C.1.3)", () => {
  it("blocks when it is not configured", async () => {
    const pvCase = await caseFor({}, { ...CONFIG, reportTypeConfirmed: false });
    expect(blocking(validateVigiFlowPreflight(pvCase))).toContain("VIGIFLOW-REPORT-TYPE-MISSING");
  });

  it("does not complain once it is confirmed", async () => {
    const pvCase = await caseFor({});
    expect(codes(validateVigiFlowPreflight(pvCase))).not.toContain("VIGIFLOW-REPORT-TYPE-MISSING");
  });
});

describe("at least one suspect drug (G.k.1)", () => {
  it("blocks a case with no product at all", async () => {
    const pvCase = await caseFor({ product: undefined });
    const errs = validateVigiFlowPreflight(pvCase);
    expect(blocking(errs)).toContain("VIGIFLOW-SUSPECT-DRUG-MISSING");
    expect(errs.find((e) => e.code === "VIGIFLOW-SUSPECT-DRUG-MISSING")?.message).toContain(
      "No product on the case at all",
    );
  });

  it("blocks a case whose products are all non-suspect", async () => {
    const pvCase = await caseFor({});
    const noSuspect: PVCase = {
      ...pvCase,
      products: pvCase.products.map((p) => ({ ...p, characterization: "CONCOMITANT" as const })),
    };
    const errs = validateVigiFlowPreflight(noSuspect);
    expect(blocking(errs)).toContain("VIGIFLOW-SUSPECT-DRUG-MISSING");
    expect(errs.find((e) => e.code === "VIGIFLOW-SUSPECT-DRUG-MISSING")?.message).toContain(
      "none is characterised as suspect",
    );
  });

  it("passes when a suspect product is present", async () => {
    const pvCase = await caseFor({});
    expect(codes(validateVigiFlowPreflight(pvCase))).not.toContain("VIGIFLOW-SUSPECT-DRUG-MISSING");
  });
});

describe("reporter qualification (C.2.r.4)", () => {
  it("blocks when no designation was captured at all", async () => {
    const pvCase = await caseFor({ reporter_designation: undefined });
    expect(blocking(validateVigiFlowPreflight(pvCase))).toContain(
      "VIGIFLOW-REPORTER-QUALIFICATION-MISSING",
    );
  });

  it("blocks when a designation exists but resolves to no ICH code", async () => {
    // The generic profile maps no designations, so "Doctor" is captured
    // verbatim and stays uncoded — which VigiFlow's import will not take.
    const pvCase = await caseFor({});
    expect(blocking(validateVigiFlowPreflight(pvCase))).toContain(
      "VIGIFLOW-REPORTER-QUALIFICATION-UNRESOLVED",
    );
  });
});

describe("MedDRA-coded reaction (E.i.2.1b)", () => {
  it("blocks while no reaction is coded", async () => {
    // No licensed provider is configured, so nothing can be coded.
    const pvCase = await caseFor({});
    expect(blocking(validateVigiFlowPreflight(pvCase))).toContain("VIGIFLOW-MEDDRA-MISSING");
  });

  it("stops blocking once a reaction is actually coded", async () => {
    const pvCase = await caseFor({});
    const coded: PVCase = {
      ...pvCase,
      reactions: pvCase.reactions.map((r) => ({
        ...r,
        reaction: {
          ...r.reaction,
          status: "MAPPED" as const,
          code: "10016558",
          codedTerm: "Fever",
          dictionaryVersion: "29.1",
          mappingMethod: "LICENSED_DICTIONARY" as const,
        },
      })),
    };
    expect(blocking(validateVigiFlowPreflight(coded))).not.toContain("VIGIFLOW-MEDDRA-MISSING");
  });
});

describe("patient identifier (D.1 / D.1.1)", () => {
  it("notes an absent record number without blocking", async () => {
    // D.1.1 is optional under ICH and D.1 is populated, so this is
    // information for a reviewer, not a barrier.
    const pvCase = await caseFor({ patient_id: undefined });
    const errs = validateVigiFlowPreflight(pvCase);
    expect(codes(errs)).toContain("VIGIFLOW-PATIENT-RECORD-NUMBER-ABSENT");
    expect(blocking(errs)).not.toContain("VIGIFLOW-PATIENT-RECORD-NUMBER-ABSENT");
  });

  it("says nothing when a record number is carried", async () => {
    const pvCase = await caseFor({});
    expect(codes(validateVigiFlowPreflight(pvCase))).not.toContain(
      "VIGIFLOW-PATIENT-RECORD-NUMBER-ABSENT",
    );
  });
});

describe("file size — at most 100 ICSRs per XML", () => {
  const fake = (i: number) => ({ caseSafetyReportId: `OG-${i}` }) as unknown as PVCase;

  it("accepts a file at the limit", () => {
    const cases = Array.from({ length: MAX_ICSRS_PER_BATCH }, (_, i) => fake(i));
    expect(validateVigiFlowBatch(cases)).toEqual([]);
  });

  it("blocks a file over the limit and says by how much", () => {
    const cases = Array.from({ length: MAX_ICSRS_PER_BATCH + 1 }, (_, i) => fake(i));
    const errs = validateVigiFlowBatch(cases, { fileName: "batch-001.xml" });
    expect(blocking(errs)).toEqual(["VIGIFLOW-BATCH-TOO-LARGE"]);
    expect(errs[0]!.message).toContain(String(MAX_ICSRS_PER_BATCH + 1));
    expect(errs[0]!.caseId).toBe("batch-001.xml");
  });

  it("is satisfied by every batch the splitter produces", () => {
    // 231 cases -> 100 / 100 / 31, and none of the three trips the rule.
    const cases = Array.from({ length: 231 }, (_, i) => fake(i));
    const batches = splitIntoBatches(cases, "MEDNOVA-TEST");
    expect(batches.map((b) => b.cases.length)).toEqual([100, 100, 31]);
    for (const batch of batches) {
      expect(validateVigiFlowBatch(batch.cases, { fileName: batch.transmissionId })).toEqual([]);
    }
  });
});

describe("a case that satisfies every prerequisite", () => {
  it("has no blocking preflight findings left", async () => {
    const base = await caseFor({});
    const ready: PVCase = {
      ...base,
      reporter: { ...base.reporter, qualificationCode: "1" },
      reactions: base.reactions.map((r) => ({
        ...r,
        reaction: {
          ...r.reaction,
          status: "MAPPED" as const,
          code: "10016558",
          codedTerm: "Fever",
          dictionaryVersion: "29.1",
          mappingMethod: "LICENSED_DICTIONARY" as const,
        },
      })),
    };
    expect(blocking(validateVigiFlowPreflight(ready))).toEqual([]);
  });
});
