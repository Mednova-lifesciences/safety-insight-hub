import { describe, expect, it } from "vitest";
import { mapSourceRecordToPVCase } from "@/services/e2b-r3/mapping";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";
import { UNCONFIRMED_DEFAULT_CONFIG } from "@/services/e2b-r3/transmission-config";
import {
  unavailableWhoDrugProvider,
  type MedDraCodingProvider,
} from "@/services/e2b-r3/coding-provider";
import type { LineListIssue } from "@/types/pv";
import { checkCasesForE2b, e2bCheckIncomplete, mergeE2bIssues } from "./linelist-e2b-checks";

// As an organization would have it after mapping "Doctor" once in Settings.
const profile = {
  ...getSourceProfile("generic-verbatim"),
  reporterQualificationMap: { DOCTOR: "1" as const },
};

const meddra = (known: string[]): MedDraCodingProvider => ({
  getVersion: () => "29.1",
  resolveReaction: async (text) =>
    known.includes(text)
      ? {
          sourceValue: text,
          status: "MAPPED",
          mappingMethod: "LICENSED_DICTIONARY",
          code: "1",
          codedTerm: text,
        }
      : { sourceValue: text, status: "UNMAPPED", mappingMethod: "NONE" },
  resolvePreferredTerm: async () => null,
});

async function casesFor(rows: Record<string, string>[], provider: MedDraCodingProvider) {
  return Promise.all(
    rows.map(
      async (row, i) =>
        (
          await mapSourceRecordToPVCase(
            row,
            profile,
            UNCONFIRMED_DEFAULT_CONFIG,
            {
              jobId: "ll-test",
              sourceFile: "t.csv",
              sourceRow: i + 1,
              processedAt: "2026-09-19T00:00:00Z",
            },
            { meddra: provider, whodrug: unavailableWhoDrugProvider },
          )
        ).pvCase,
    ),
  );
}

const complete = {
  case_id: "OND-1",
  patient_identifier: "Ada Obi",
  product: "Penta",
  reaction: "Fever",
  outcome: "Recovered",
  reporter_designation: "Doctor",
};
const mapping = {
  "Case No": "case_id",
  Patient: "patient_identifier",
  Vaccine: "product",
  AEFI: "reaction",
  Outcome: "outcome",
  Reporter: "reporter_designation",
};

describe("E2B blockers on the line-list page", () => {
  it("a complete row has no E2B blockers — settings and C.1.7 are not line-list concerns", async () => {
    const cases = await casesFor([complete], meddra(["Fever"]));
    const { issues } = checkCasesForE2b(cases, mapping);
    // Report type, sender and the C.1.7 decision are unconfigured here, yet
    // none of them is reported against the line list.
    expect(issues).toEqual([]);
  });

  it("reports an unknown outcome word, a reaction typo and an unmapped designation on the right row and column", async () => {
    const cases = await casesFor(
      [
        complete,
        {
          ...complete,
          case_id: "OND-2",
          outcome: "Hospitalized",
          reaction: "Feverr",
          reporter_designation: "Town crier",
        },
      ],
      meddra(["Fever"]),
    );
    const { issues, discovered } = checkCasesForE2b(cases, mapping);
    const byCode = Object.fromEntries(issues.map((i) => [i.code, i]));
    expect(issues.every((i) => i.row === 2 && i.blocksE2b)).toBe(true);
    expect(byCode["E2B-OUTCOME-NOT-MAPPABLE"]).toMatchObject({
      column: "Outcome",
      fixIn: "OUTCOME_TERMS",
      value: "Hospitalized",
    });
    expect(byCode["VIGIFLOW-MEDDRA-MISSING"]).toMatchObject({
      column: "AEFI",
      fixIn: "REACTION_TERMS",
      value: "Feverr",
    });
    expect(byCode["E2B-REPORTER-QUALIFICATION-UNRESOLVED"]).toMatchObject({
      column: "Reporter",
      fixIn: "REPORTER_DESIGNATIONS",
    });
    expect(discovered).toEqual({
      outcomeTerms: ["Hospitalized"],
      reactionTerms: ["Feverr"],
      designations: ["Town crier"],
    });
  });

  it("reports missing essentials as critical, fixable in the file", async () => {
    const cases = await casesFor(
      [{ ...complete, patient_identifier: "", product: "" }],
      meddra(["Fever"]),
    );
    const { issues } = checkCasesForE2b(cases, mapping);
    expect(issues.map((i) => [i.code, i.severity, i.fixIn]).sort()).toEqual([
      ["E2B-PATIENT-MISSING", "CRITICAL", "FILE"],
      ["E2B-PRODUCT-MISSING", "CRITICAL", "FILE"],
    ]);
  });

  it("says once, not per row, when MedDRA could not be reached", async () => {
    const down: MedDraCodingProvider = {
      getVersion: () => null,
      resolveReaction: async (text) => ({
        sourceValue: text,
        status: "PROVIDER_UNAVAILABLE",
        mappingMethod: "NONE",
      }),
      resolvePreferredTerm: async () => null,
    };
    const cases = await casesFor([complete, { ...complete, case_id: "OND-2" }], down);
    const { issues, meddraUnavailable } = checkCasesForE2b(cases, mapping);
    expect(meddraUnavailable).toBe(true);
    expect(issues.map((i) => i.code)).toEqual(["MEDDRA_CHECK_UNAVAILABLE"]);
    // No row blockers, but the list must not be called ready.
    expect(e2bCheckIncomplete(issues)).toBe(true);
  });
});

describe("merging with the line list's own checks", () => {
  const rule = (code: string, row: number, severity: LineListIssue["severity"]): LineListIssue => ({
    row,
    column: "Outcome",
    severity,
    code,
    message: "old wording",
    value: "Hospitalized",
    fixable: true,
  });
  const e2b: LineListIssue = {
    row: 2,
    column: "Outcome",
    severity: "HIGH",
    code: "E2B-OUTCOME-NOT-MAPPABLE",
    message: "new wording",
    value: "Hospitalized",
    blocksE2b: true,
    fixIn: "OUTCOME_TERMS",
  };

  it("one finding per problem: the older check on the same row takes the E2B wording and severity", () => {
    const merged = mergeE2bIssues([rule("OUTCOME_REQUIRES_HUMAN_REVIEW", 2, "MEDIUM")], [e2b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      code: "OUTCOME_REQUIRES_HUMAN_REVIEW",
      message: "new wording",
      severity: "HIGH",
      blocksE2b: true,
      fixIn: "OUTCOME_TERMS",
      fixable: true,
    });
  });

  it("adds the E2B finding when no older check covers that row", () => {
    const merged = mergeE2bIssues([rule("OUTCOME_REQUIRES_HUMAN_REVIEW", 5, "MEDIUM")], [e2b]);
    expect(merged.map((i) => [i.row, i.code])).toEqual([
      [5, "OUTCOME_REQUIRES_HUMAN_REVIEW"],
      [2, "E2B-OUTCOME-NOT-MAPPABLE"],
    ]);
  });
});
