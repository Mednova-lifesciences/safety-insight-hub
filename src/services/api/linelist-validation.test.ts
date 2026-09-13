import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mapColumnsByKeywords } from "./tabular-parse";
import { parseTabularFile } from "./tabular-parse";
import {
  FIELD_KEYWORDS,
  mergeFindings,
  runValidation,
  deriveOnsetDate,
  parseOnsetIntervalMs,
  stripSpreadsheetTextMarkers,
  toParsedRows,
  type ParsedRow,
  type TargetField,
} from "./linelist";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";
import type { SourceProfile } from "@/services/e2b-r3/source-profiles/types";
import type { LineListIssue } from "@/types/pv";

/** A synthetic runtime profile carrying a small outcome codebook and/or
 *  reaction codebook — mirrors semantic-mapping.test.ts's helper so both
 *  the e2b-r3 module and this line-list quality-check layer are proven
 *  against the exact same kind of profile shape. */
function profileWithCodebooks(opts: {
  outcome?: Record<string, string>;
  reaction?: Record<string, string>;
}): SourceProfile {
  const base = getSourceProfile("ondo-aefi");
  const fieldCodebooks: SourceProfile["fieldCodebooks"] = {};
  if (opts.outcome) {
    fieldCodebooks["outcome"] = {
      field: "outcome",
      version: "test",
      entries: Object.fromEntries(
        Object.entries(opts.outcome).map(([code, meaning]) => [
          code,
          { sourceCode: code, meaning },
        ]),
      ),
    };
  }
  return {
    ...base,
    fieldCodebooks,
    ...(opts.reaction
      ? {
          reactionCodebook: {
            ...base.reactionCodebook,
            entries: Object.fromEntries(
              Object.entries(opts.reaction).map(([code, sourceTerm]) => [
                code,
                { localCode: code, sourceTerm, effectiveFrom: "2020-01-01" },
              ]),
            ),
          },
        }
      : {}),
  };
}

/** Same in-memory-xlsx helper as tabular-parse.test.ts, duplicated here
 *  rather than shared so this file can be read on its own. */
function xlsxFile(rows: (string | number)[][], name = "test.xlsx"): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function issue(overrides: Partial<LineListIssue>): LineListIssue {
  return {
    row: 1,
    column: "Reporter Phone Number",
    severity: "HIGH",
    confidence: "HIGH",
    code: "TEST_CODE",
    message: "test",
    value: null,
    source: "rule",
    fixable: false,
    ...overrides,
  };
}

describe("runValidation — document structure never reaches the rule engine", () => {
  it("real Ondo-style letterhead file: no NO_COLUMNS_MAPPED, no spurious column-shift from title rows", async () => {
    const file = xlsxFile([
      ["FEDERAL REPUBLIC OF NIGERIA"],
      ["FEDERAL MINISTRY OF HEALTH"],
      ["AEFI LINE LIST FORM — ONDO STATE"],
      ["Reporting period: February 2026"],
      [],
      [
        "S/N",
        "Patient Identifier",
        "Sex",
        "Age",
        "Suspect Product",
        "Reaction/Event",
        "Onset Date",
        "Seriousness",
        "Outcome",
        "Vaccine Batch No",
        "Dose",
        "Reporter Phone Number",
        "Reporter Designation",
      ],
      [
        1,
        "P001",
        "F",
        2,
        "MR",
        "Fever",
        "2026-02-03",
        "NON SERIOUS",
        "Recovered",
        "0125N084A",
        "1st",
        "08012345678",
        "Nurse",
      ],
      [
        2,
        "P002",
        "M",
        1,
        "OPV",
        "Rash",
        "2026-02-04",
        "NON SERIOUS",
        "Recovering",
        "0125N084B",
        "2nd",
        "08023456789",
        "CHEW",
      ],
    ]);
    const parsed = await parseTabularFile(file);
    const mapping = mapColumnsByKeywords(parsed.headers, FIELD_KEYWORDS);
    const parsedRows: ParsedRow[] = parsed.rows.map((row) => {
      const r: ParsedRow = {};
      parsed.headers.forEach((h, i) => {
        const field = mapping[h];
        if (field && row[i]) r[field] = row[i];
      });
      return r;
    });

    const issues = runValidation(parsed.headers, mapping, parsedRows);

    expect(issues.some((i) => i.code === "NO_COLUMNS_MAPPED")).toBe(false);
    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
    expect(issues.some((i) => i.code === "FIELD_CONTENT_MISMATCH")).toBe(false);
    // The letterhead text must never surface as a finding's value/message.
    expect(issues.every((i) => !JSON.stringify(i).includes("FEDERAL REPUBLIC"))).toBe(true);
  });

  it("an unmapped/unknown column is never treated as a shifted canonical column", () => {
    // "Remarks / Comments" deliberately has no entry — mapColumns() never
    // maps it to any canonical field, so it's absent here exactly as it
    // would be after a real mapColumnsByKeywords() call.
    const mapping: Record<string, TargetField> = { "Patient Name": "patient_identifier" };
    const rows: ParsedRow[] = [
      { patient_identifier: "P1", product: "MR", reaction: "Fever" },
      { patient_identifier: "P2", product: "OPV", reaction: "Rash" },
      { patient_identifier: "P3", product: "MR", reaction: "Fever" },
      { patient_identifier: "P4", product: "OPV", reaction: "Rash" },
      { patient_identifier: "P5", product: "MR", reaction: "Fever" },
    ];
    const issues = runValidation(["Patient Name", "Remarks / Comments"], mapping, rows);
    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
  });
});

describe("runValidation — column-shift detection (whole column vs single value)", () => {
  function rowsWithPhoneDesignationSwap(): ParsedRow[] {
    // Whole-column evidence: reporter_phone holds designation-like text in
    // every row, and reporter_designation sits empty in those same rows.
    const designations = ["Nurse", "CHEW", "Midwife", "Doctor", "Health Worker", "Nurse"];
    return designations.map((d) => ({
      patient_identifier: "P",
      product: "MR",
      reaction: "Fever",
      reporter_phone: d,
      reporter_designation: "",
    }));
  }

  it("flags a whole-column shift when most values don't match the field's shape and the swap partner is empty", () => {
    const mapping: Record<string, TargetField> = {
      Phone: "reporter_phone",
      Designation: "reporter_designation",
    };
    const issues = runValidation(["Phone", "Designation"], mapping, rowsWithPhoneDesignationSwap());

    const shift = issues.find((i) => i.code === "POSSIBLE_COLUMN_SHIFT");
    expect(shift).toBeTruthy();
    expect(shift!.confidence).toBe("LOW");
    expect(["HIGH", "MEDIUM"]).toContain(shift!.severity);
    expect(shift!.column).toBe("Phone");
    // Never presented as a certainty.
    expect(shift!.message.toLowerCase()).toContain("possible");
    // One finding for the column, not one per row.
    expect(issues.filter((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toHaveLength(1);
  });

  it("does NOT escalate a single bad value into a column-wide shift", () => {
    const mapping: Record<string, TargetField> = { Phone: "reporter_phone" };
    const rows: ParsedRow[] = [
      { reporter_phone: "08012345678" },
      { reporter_phone: "08023456789" },
      { reporter_phone: "Ikoya Health Centre" }, // the one bad value
      { reporter_phone: "08034567890" },
      { reporter_phone: "08045678901" },
      { reporter_phone: "08056789012" },
    ];
    const issues = runValidation(["Phone"], mapping, rows);

    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
    const mismatch = issues.find((i) => i.code === "FIELD_CONTENT_MISMATCH");
    expect(mismatch).toBeTruthy();
    expect(mismatch!.row).toBe(3);
    expect(mismatch!.value).toBe("Ikoya Health Centre");
    expect(mismatch!.confidence).toBe("LOW");
  });

  it("does not flag anything when the whole column looks normal", () => {
    const mapping: Record<string, TargetField> = {
      Phone: "reporter_phone",
      Sex: "sex",
      Age: "age",
    };
    const rows: ParsedRow[] = [
      { reporter_phone: "08012345678", sex: "F", age: "34" },
      { reporter_phone: "08023456789", sex: "M", age: "2" },
      { reporter_phone: "08034567890", sex: "Female", age: "45 years" },
    ];
    const issues = runValidation(["Phone", "Sex", "Age"], mapping, rows);
    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
    expect(issues.some((i) => i.code === "FIELD_CONTENT_MISMATCH")).toBe(false);
  });
});

describe("runValidation — seriousness value spelling variants", () => {
  it("does not flag real seriousness spellings that use a space instead of an underscore/hyphen", () => {
    // Real regression: a real AEFI form spelled it "NON SERIOUS" (space),
    // which the old exact-string set didn't recognise at all.
    const mapping: Record<string, TargetField> = { Seriousness: "seriousness" };
    const rows: ParsedRow[] = [
      { seriousness: "NON SERIOUS" },
      { seriousness: "NON-SERIOUS" },
      { seriousness: "NONSERIOUS" },
      { seriousness: "NON_SERIOUS" },
      { seriousness: "SERIOUS" },
    ];
    const issues = runValidation(["Seriousness"], mapping, rows);
    expect(issues.some((i) => i.code === "UNRECOGNISED_SERIOUSNESS_VALUE")).toBe(false);
  });

  it("still flags a genuinely unrecognised seriousness value", () => {
    const mapping: Record<string, TargetField> = { Seriousness: "seriousness" };
    const rows: ParsedRow[] = [{ seriousness: "MAYBE" }];
    const issues = runValidation(["Seriousness"], mapping, rows);
    expect(issues.some((i) => i.code === "UNRECOGNISED_SERIOUSNESS_VALUE")).toBe(true);
  });
});

describe("runValidation — outcome recognition is codebook-aware, not a stale hardcoded vocabulary", () => {
  it("a source outcome code the runtime profile's codebook decodes to a MAPPED canonical concept is never UNRECOGNISED_OUTCOME_VALUE", () => {
    // Real regression: Ondo's discovered legend defines "1 = Recovered",
    // but the executive summary kept reporting UNRECOGNISED_OUTCOME_VALUE
    // for outcome "1" because runValidation never received the resolved
    // source profile at all.
    const profile = profileWithCodebooks({ outcome: { "1": "Recovered" } });
    const mapping: Record<string, TargetField> = { Outcome: "outcome" };
    const issues = runValidation(["Outcome"], mapping, [{ outcome: "1" }], profile);
    expect(issues.some((i) => i.code === "UNRECOGNISED_OUTCOME_VALUE")).toBe(false);
    expect(issues.some((i) => i.code === "OUTCOME_REQUIRES_HUMAN_REVIEW")).toBe(false);
  });

  it("a source outcome code that decodes to a REAL but unmapped concept is OUTCOME_REQUIRES_HUMAN_REVIEW, never UNRECOGNISED_OUTCOME_VALUE", () => {
    const profile = profileWithCodebooks({ outcome: { "2": "Hospitalized" } });
    const mapping: Record<string, TargetField> = { Outcome: "outcome" };
    const issues = runValidation(["Outcome"], mapping, [{ outcome: "2" }], profile);
    expect(issues.some((i) => i.code === "UNRECOGNISED_OUTCOME_VALUE")).toBe(false);
    const humanReview = issues.find((i) => i.code === "OUTCOME_REQUIRES_HUMAN_REVIEW");
    expect(humanReview).toBeTruthy();
    expect(humanReview!.message).toContain("Hospitalized");
  });

  it("OUTCOME_REQUIRES_HUMAN_REVIEW is HIGH severity — it must block export on its own, never relying on some other unrelated finding also being present on the row", () => {
    // A row whose ONLY problem at all is this one — everything else on
    // the row is otherwise complete — must still count as an invalid
    // case (the app's own invalidCases/exportable gate only counts
    // CRITICAL/HIGH severity findings, so MEDIUM here would silently let
    // the row through the "Generate E2B(R3)" button).
    const profile = profileWithCodebooks({ outcome: { "2": "Hospitalized" } });
    const mapping: Record<string, TargetField> = { Outcome: "outcome" };
    const issues = runValidation(["Outcome"], mapping, [{ outcome: "2" }], profile);
    const humanReview = issues.find((i) => i.code === "OUTCOME_REQUIRES_HUMAN_REVIEW");
    expect(humanReview!.severity).toBe("HIGH");
  });

  it("a genuinely unrecognised outcome code (no codebook entry, not a plain-English concept) is still UNRECOGNISED_OUTCOME_VALUE", () => {
    const profile = profileWithCodebooks({ outcome: { "1": "Recovered" } });
    const mapping: Record<string, TargetField> = { Outcome: "outcome" };
    const issues = runValidation(["Outcome"], mapping, [{ outcome: "999" }], profile);
    expect(issues.some((i) => i.code === "UNRECOGNISED_OUTCOME_VALUE")).toBe(true);
  });

  it("plain-English outcome words still validate with no codebook configured at all (backward compatible default)", () => {
    const mapping: Record<string, TargetField> = { Outcome: "outcome" };
    const rows: ParsedRow[] = [
      { outcome: "Recovered" },
      { outcome: "Recovering" },
      { outcome: "Not recovered" },
      { outcome: "Fatal" },
      { outcome: "Unknown" },
    ];
    const issues = runValidation(["Outcome"], mapping, rows);
    expect(issues.some((i) => i.code === "UNRECOGNISED_OUTCOME_VALUE")).toBe(false);
    expect(issues.some((i) => i.code === "OUTCOME_REQUIRES_HUMAN_REVIEW")).toBe(false);
  });

  it("FATAL_OUTCOME_NOT_MARKED_SERIOUS fires from the DECODED canonical concept, not from raw text matching the literal word 'FATAL'", () => {
    const profile = profileWithCodebooks({ outcome: { "9": "Died" } });
    const mapping: Record<string, TargetField> = { Outcome: "outcome", Seriousness: "seriousness" };
    const issues = runValidation(
      ["Outcome", "Seriousness"],
      mapping,
      [{ outcome: "9", seriousness: "NON_SERIOUS" }],
      profile,
    );
    expect(issues.some((i) => i.code === "FATAL_OUTCOME_NOT_MARKED_SERIOUS")).toBe(true);
  });
});

describe("runValidation — reaction_code recognition uses the runtime profile's actual codebook, not a hardcoded numeric range", () => {
  it("a code outside a SMALLER-than-28 real codebook is invalid, even though it would have passed the old hardcoded 1-28 range", () => {
    const profile = profileWithCodebooks({ reaction: { "1": "Fever", "2": "Rash" } });
    const mapping: Record<string, TargetField> = { "Reaction Code": "reaction_code" };
    const issues = runValidation(["Reaction Code"], mapping, [{ reaction_code: "6" }], profile);
    expect(issues.some((i) => i.code === "INVALID_REACTION_CODE")).toBe(true);
  });

  it("a code the codebook DOES recognise is valid even though it falls outside the old hardcoded 1-28 range", () => {
    const profile = profileWithCodebooks({ reaction: { "30": "Some future code" } });
    const mapping: Record<string, TargetField> = { "Reaction Code": "reaction_code" };
    const issues = runValidation(["Reaction Code"], mapping, [{ reaction_code: "30" }], profile);
    expect(issues.some((i) => i.code === "INVALID_REACTION_CODE")).toBe(false);
  });

  it("with no reaction codebook discovered at all, falls back to a generic numeric-shape check (no assumed range)", () => {
    const profile = profileWithCodebooks({});
    const mapping: Record<string, TargetField> = { "Reaction Code": "reaction_code" };
    const issues = runValidation(["Reaction Code"], mapping, [{ reaction_code: "42" }], profile);
    expect(issues.some((i) => i.code === "INVALID_REACTION_CODE")).toBe(false);
    const nonNumeric = runValidation(
      ["Reaction Code"],
      mapping,
      [{ reaction_code: "ABC" }],
      profile,
    );
    expect(nonNumeric.some((i) => i.code === "INVALID_REACTION_CODE")).toBe(true);
  });
});

describe("runValidation — MISSING_REPORTER_PHONE is MEDIUM severity (advisory, not export-blocking on its own)", () => {
  it("a missing reporter phone number is MEDIUM, not HIGH/CRITICAL", () => {
    const mapping: Record<string, TargetField> = { Phone: "reporter_phone" };
    const issues = runValidation(["Phone"], mapping, [{}]);
    const missing = issues.find((i) => i.code === "MISSING_REPORTER_PHONE");
    expect(missing).toBeTruthy();
    expect(missing!.severity).toBe("MEDIUM");
  });

  it("a malformed reporter phone is ALSO MEDIUM — it no longer blocks the case", () => {
    // This test previously pinned CRITICAL, as a scope guard recording that
    // the earlier change had downgraded only the MISSING case. Keeping the
    // two apart turned out to be the bug: a blank phone passed while a
    // phone recorded as "1" blocked the case, making a malformed optional
    // field more serious than an absent one. Reporter phone is not an
    // E2B(R3) mandatory element and nothing downstream consumes it, so it
    // is a data-quality note either way. On a real 231-row upload this
    // alone accounted for 18 blocked rows.
    const mapping: Record<string, TargetField> = { Phone: "reporter_phone" };
    const issues = runValidation(["Phone"], mapping, [{ reporter_phone: "123" }]);
    const invalid = issues.find((i) => i.code === "INVALID_REPORTER_PHONE");
    expect(invalid).toBeTruthy();
    expect(invalid!.severity).toBe("MEDIUM");
  });
});

describe("mergeFindings — semantic provenance/deduplication (not row+column alone)", () => {
  // 1. Same row + same field + same issue → deduplicate.
  it("merges a rule and AI finding that share row, issueType and affectedFields", () => {
    const rule = [
      issue({
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        row: 109,
        column: "Seriousness",
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
        value: "ABC",
      }),
    ];
    const ai = [
      issue({
        code: "AI_BAD_SERIOUSNESS",
        row: 109,
        column: "seriousness",
        source: "ai",
        message: "seriousness contains unrecognized value ABC",
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
        value: "ABC",
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.code).toBe("UNRECOGNISED_SERIOUSNESS_VALUE");
    expect(merged[0]!.sources).toEqual(["rule", "ai"]);
  });

  // 2. Same row + same field + DIFFERENT issue → preserve both.
  it("keeps both findings when they're on the same row/field but a genuinely different issue", () => {
    const rule = [
      issue({
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        row: 109,
        column: "Seriousness",
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
        value: "ABC",
      }),
    ];
    const ai = [
      issue({
        code: "SERIOUSNESS_HOSPITALIZATION_CONTRADICTION",
        row: 109,
        column: "Seriousness",
        source: "ai",
        issueType: "CROSS_FIELD_CONTRADICTION",
        affectedFields: ["seriousness", "hospitalization"],
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
    expect(merged.map((i) => i.code).sort()).toEqual([
      "SERIOUSNESS_HOSPITALIZATION_CONTRADICTION",
      "UNRECOGNISED_SERIOUSNESS_VALUE",
    ]);
  });

  // 3. Same row + different single field + same issueType → NOT merged (a
  // different affectedFields set is never treated as "genuinely
  // equivalent" — that's the safe default).
  it("does not merge same-issueType findings on the same row but different fields", () => {
    const rule = [
      issue({
        code: "MISSING_DOSE",
        row: 6,
        column: "Dose",
        issueType: "FIELD_MISSING",
        affectedFields: ["dose"],
      }),
    ];
    const ai = [
      issue({
        code: "AI_MISSING_BATCH",
        row: 6,
        column: "Vaccine Batch",
        source: "ai",
        issueType: "FIELD_MISSING",
        affectedFields: ["vaccine_batch"],
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
  });

  // 4. Field-level issue + cross-field issue → preserve both.
  it("does not merge a field-level finding with a cross-field finding that includes that field", () => {
    const rule = [
      issue({
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        row: 12,
        column: "Seriousness",
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
      }),
    ];
    const ai = [
      issue({
        code: "FATAL_NOT_SERIOUS",
        row: 12,
        column: "Seriousness",
        source: "ai",
        issueType: "CROSS_FIELD_CONTRADICTION",
        affectedFields: ["seriousness", "outcome"],
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
  });

  // 5. Rule-only finding → preserved.
  it("keeps every rule finding even when AI returns nothing, tagged sources: [rule]", () => {
    const rule = [issue({ code: "SERIOUSNESS_CONTRADICTION", row: 4 })];
    const merged = mergeFindings(rule, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.code).toBe("SERIOUSNESS_CONTRADICTION");
    expect(merged[0]!.sources).toEqual(["rule"]);
  });

  // 6. AI-only finding → preserved, tagged sources: [ai].
  it("keeps an AI finding with no matching rule finding, tagged sources: [ai]", () => {
    const rule = [issue({ code: "MISSING_DOSE", row: 2, column: "Dose" })];
    const ai = [
      issue({
        code: "AMBIGUOUS_REACTION_TERM",
        row: 7,
        column: "Reaction",
        source: "ai",
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
    const aiFinding = merged.find((i) => i.code === "AMBIGUOUS_REACTION_TERM");
    expect(aiFinding?.sources).toEqual(["ai"]);
  });

  // 7. Rule + AI equivalent finding → one merged finding with provenance
  // ["rule","ai"] — covered by test 1 above too; this variant uses
  // different code/message text to prove code-matching isn't the key.
  it("merges regardless of completely different code/message wording", () => {
    const rule = [
      issue({
        code: "MISSING_VACCINE_BATCH",
        row: 20,
        column: "Vaccine Batch",
        issueType: "FIELD_MISSING",
        affectedFields: ["vaccine_batch"],
        value: null,
      }),
    ];
    const ai = [
      issue({
        code: "COMPLETELY_DIFFERENT_AI_CODE_NAME",
        row: 20,
        column: "Vaccine Batch",
        source: "ai",
        message: "The lot number field appears empty for this record.",
        issueType: "FIELD_MISSING",
        affectedFields: ["vaccine_batch"],
        value: null,
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources).toEqual(["rule", "ai"]);
  });

  // 8. Two AI findings on same cell but different issues → both preserved
  // (mergeFindings never deduplicates within aiIssues itself).
  it("keeps two AI findings on the same cell when neither matches a rule finding", () => {
    const rule: LineListIssue[] = [];
    const ai = [
      issue({
        code: "AI_FINDING_ONE",
        row: 9,
        column: "Seriousness",
        source: "ai",
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
      }),
      issue({
        code: "AI_FINDING_TWO",
        row: 9,
        column: "Seriousness",
        source: "ai",
        issueType: "CROSS_FIELD_CONTRADICTION",
        affectedFields: ["seriousness", "outcome"],
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
  });

  // 9. Different rows with the same issue type → both preserved.
  it("keeps findings on different rows separate even with identical issueType/affectedFields", () => {
    const rule = [
      issue({
        code: "MISSING_DOSE",
        row: 3,
        issueType: "FIELD_MISSING",
        affectedFields: ["dose"],
      }),
    ];
    const ai = [
      issue({
        code: "AI_MISSING_DOSE",
        row: 8,
        source: "ai",
        issueType: "FIELD_MISSING",
        affectedFields: ["dose"],
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
  });

  // 10. Different evidence values → do not incorrectly merge.
  it("does not merge when the two findings' evidence values genuinely differ", () => {
    const rule = [
      issue({
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        row: 15,
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
        value: "ABC",
      }),
    ];
    const ai = [
      issue({
        code: "AI_BAD_SERIOUSNESS",
        row: 15,
        source: "ai",
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
        value: "XYZ",
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
  });

  it("a finding with no issueType/affectedFields is never merge-eligible (safe default)", () => {
    // Mirrors real legacy/demo-seeded issues and the file-level
    // NO_COLUMNS_MAPPED finding, neither of which carry a classification.
    const rule = [issue({ code: "DATE_CHRONOLOGY_VIOLATION", row: 5, column: "Vaccination Date" })];
    const ai = [
      issue({
        code: "AI_VACCINATION_AFTER_ONSET",
        row: 5,
        column: "vaccination date",
        source: "ai",
        message: "Vaccination date occurs after reporting date.",
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
  });
});

describe("onset date is derived from the vaccination date and onset interval", () => {
  // The NAFDAC/Ondo AEFI form has no onset-date column: it records the
  // immunisation date and an "Onset Time interval (hours, days, weeks)".
  // Demanding onset_date separately fired MISSING_ONSET_DATE on 231 of 231
  // rows of a real upload — a warning on every row, which buries the real
  // findings underneath it.
  it("derives a calendar date from a vaccination date plus an interval", () => {
    expect(deriveOnsetDate("02/02/2026", "2 days")).toBe("2026-02-04");
    expect(deriveOnsetDate("2026-02-02", "1 week")).toBe("2026-02-09");
    expect(deriveOnsetDate("02/02/2026", "30 mins")).toBe("2026-02-02");
  });

  it("reads the interval spellings real forms use", () => {
    for (const [v, ms] of [
      ["10HRS", 10 * 3600_000],
      ["10 hrs", 10 * 3600_000],
      ["2 Days", 2 * 86_400_000],
      ["1 week", 7 * 86_400_000],
      ["45 minutes", 45 * 60_000],
    ] as const) {
      expect(parseOnsetIntervalMs(v)).toBe(ms);
    }
  });

  it("refuses to guess — an unreadable interval derives nothing", () => {
    expect(parseOnsetIntervalMs("soon after")).toBeNull();
    expect(parseOnsetIntervalMs("")).toBeNull();
    expect(parseOnsetIntervalMs("2 fortnights")).toBeNull();
    expect(deriveOnsetDate("02/02/2026", "soon after")).toBeNull();
    expect(deriveOnsetDate(undefined, "2 days")).toBeNull();
    expect(deriveOnsetDate("02/02/2026", undefined)).toBeNull();
    expect(deriveOnsetDate("not a date", "2 days")).toBeNull();
  });

  it("tolerates a spreadsheet text marker on the vaccination date", () => {
    expect(deriveOnsetDate("02/02/2026'", "2 days")).toBe("2026-02-04");
  });
});

describe("spreadsheet text markers are stripped at the parsing boundary", () => {
  // Excel's leading/trailing apostrophe means "store this as text" and is
  // not part of the value. Observed as 02/02/2026' on a real upload, which
  // failed INVALID_DATE_FORMAT on 13 rows for a character the user never
  // typed and cannot see in Excel.
  it("removes leading and trailing apostrophes and surrounding space", () => {
    expect(stripSpreadsheetTextMarkers("02/02/2026'")).toBe("02/02/2026");
    expect(stripSpreadsheetTextMarkers("'02/02/2026")).toBe("02/02/2026");
    expect(stripSpreadsheetTextMarkers("  '02/02/2026'  ")).toBe("02/02/2026");
  });

  it("never repairs the value itself — a genuinely bad date still fails", () => {
    // Silently correcting a date in a safety report is worse than rejecting
    // it, so only the marker goes.
    expect(stripSpreadsheetTextMarkers("32/13/2026'")).toBe("32/13/2026");
    expect(stripSpreadsheetTextMarkers("2-Apr")).toBe("2-Apr");
  });

  it("leaves an apostrophe that is part of the data alone", () => {
    expect(stripSpreadsheetTextMarkers("O'Brien")).toBe("O'Brien");
  });
});

describe("a malformed reporter phone does not block a case", () => {
  const row = (over: Partial<ParsedRow> = {}): ParsedRow => ({
    case_id: "C1",
    product: "HPV",
    reaction: "Fever",
    reporter_phone: "1",
    ...over,
  });

  function phoneIssues(r: ParsedRow): LineListIssue[] {
    const mapping: Record<string, TargetField> = { Phone: "reporter_phone" };
    return runValidation(["Phone"], mapping, [r]).filter((i) => i.code.includes("REPORTER_PHONE"));
  }

  it("an invalid phone is MEDIUM, matching a missing one — never CRITICAL", () => {
    // CRITICAL here meant a blank phone passed while a phone recorded as
    // "1" blocked the case: a malformed optional field treated as more
    // serious than an absent one. Reporter phone is not an E2B(R3)
    // mandatory element. This alone blocked 18 of 231 rows on a real file.
    const invalid = phoneIssues(row({ reporter_phone: "1" }));
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.code).toBe("INVALID_REPORTER_PHONE");
    expect(invalid[0]!.severity).toBe("MEDIUM");
  });

  it("is no more severe than an entirely missing phone", () => {
    const withoutPhone = row();
    delete withoutPhone.reporter_phone;
    const missing = phoneIssues(withoutPhone);
    const invalid = phoneIssues(row({ reporter_phone: "1" }));
    expect(missing[0]!.severity).toBe(invalid[0]!.severity);
  });

  it("still reports the problem — it is downgraded, not suppressed", () => {
    expect(phoneIssues(row({ reporter_phone: "1" }))[0]!.message).toContain("10-14 digits");
  });
});

describe("the real Ondo AEFI headers map to the derivation inputs", () => {
  // The whole fix hinges on this: if the form's actual column header does
  // not map to onset_interval, nothing is derived and MISSING_ONSET_DATE
  // still fires on every row. These are the headers verbatim from the live
  // "2026, ONDO STATE AEFI.xlsx" upload.
  const REAL_HEADERS = [
    "Date of Last immunisation Date (dd/mm/yy)",
    "Date of Last immunisation Time",
    "Onset Time interval (hours, days, weeks)",
    "Date of Reporting to LGA (dd/mm/yy)",
    "Phone number of the reporting officer",
  ];

  it("maps the onset-interval and vaccination-date columns", () => {
    const mapping = mapColumnsByKeywords(REAL_HEADERS, FIELD_KEYWORDS);
    expect(mapping["Onset Time interval (hours, days, weeks)"]).toBe("onset_interval");
    expect(mapping["Date of Last immunisation Date (dd/mm/yy)"]).toBe("vaccination_date");
  });

  it("never maps the interval column into onset_date — the bug that started this", () => {
    const mapping = mapColumnsByKeywords(REAL_HEADERS, FIELD_KEYWORDS);
    expect(Object.values(mapping)).not.toContain("onset_date");
  });

  it("derives an onset date from the values those columns actually carry", () => {
    // "10HRS" is a real value observed in this column on the live file.
    expect(deriveOnsetDate("3/2/26", "10HRS")).toBe("2026-02-03");
    expect(deriveOnsetDate("02/02/2026'", "2 days")).toBe("2026-02-04");
  });

  it("no longer reports a missing onset date once it can be derived", () => {
    const mapping = mapColumnsByKeywords(REAL_HEADERS, FIELD_KEYWORDS);
    const issues = runValidation(
      REAL_HEADERS,
      mapping,
      [{ vaccination_date: "3/2/26", onset_interval: "2 days", onset_date: "2026-02-05" }],
      undefined,
    );
    expect(issues.some((i) => i.code === "MISSING_ONSET_DATE")).toBe(false);
  });

  it("still reports it when neither the date nor the interval is usable, and says which", () => {
    const mapping = mapColumnsByKeywords(REAL_HEADERS, FIELD_KEYWORDS);
    const issues = runValidation(
      REAL_HEADERS,
      mapping,
      [{ vaccination_date: "3/2/26" }],
      undefined,
    );
    const missing = issues.find((i) => i.code === "MISSING_ONSET_DATE");
    expect(missing).toBeTruthy();
    expect(missing!.message).toMatch(/no onset interval/i);
  });
});

describe("the onset-date derivation is source-agnostic, not Ondo-specific", () => {
  // Same standard as e2b-r3/source-agnosticism.test.ts: the engine must not
  // learn one form's vocabulary. Ondo is the form that exposed the bug, not
  // the form the fix is built around — these headers share no wording with
  // it beyond the underlying concepts.
  it("maps differently-worded onset-interval headers from unrelated forms", () => {
    const forms: Record<string, string[]> = {
      "WHO-style AEFI": ["Date of vaccination", "Time to onset", "Patient name"],
      "clinical trial listing": ["Immunization Date", "Interval from vaccination", "Subject ID"],
      "terse export": ["vaccination_date", "onset_interval", "case_id"],
      "spaced and cased oddly": ["DATE OF VACCINATION", "Onset  Interval", "Case Id"],
    };
    for (const [label, headers] of Object.entries(forms)) {
      const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
      const mapped = Object.values(mapping);
      expect(mapped, `${label}: onset interval not mapped`).toContain("onset_interval");
      expect(mapped, `${label}: vaccination date not mapped`).toContain("vaccination_date");
    }
  });

  it("derives from date formats other forms use, not just dd/mm/yy", () => {
    expect(deriveOnsetDate("2026-02-03", "48 hours")).toBe("2026-02-05");
    expect(deriveOnsetDate("3-2-2026", "1 day")).toBe("2026-02-04");
    expect(deriveOnsetDate("03/02/2026", "3 weeks")).toBe("2026-02-24");
  });

  it("leaves a form that genuinely has its own onset-date column alone", () => {
    // Nothing here should disturb a source that records onset directly —
    // the derivation only fills a gap, it never overwrites a real value.
    const headers = ["Onset Date", "Date of vaccination", "Case ID"];
    const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
    expect(mapping["Onset Date"]).toBe("onset_date");
    const issues = runValidation(headers, mapping, [{ onset_date: "2026-02-05" }], undefined);
    expect(issues.some((i) => i.code === "MISSING_ONSET_DATE")).toBe(false);
  });

  it("a supplied onset date is never overwritten by a derived one", () => {
    const headers = ["Onset Date", "Date of vaccination", "Onset Time interval"];
    const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
    const rows = [["2026-03-01", "01/02/2026", "2 days"]];
    const parsed = toParsedRows(headers, rows, mapping);
    expect(parsed[0]!.onset_date).toBe("2026-03-01");
  });

  it("spreadsheet text markers are stripped regardless of which form produced them", () => {
    // Excel's apostrophe is an Excel artefact, not an Ondo one.
    for (const v of ["'ABC123", "ABC123'", "  'ABC123'  "]) {
      expect(stripSpreadsheetTextMarkers(v)).toBe("ABC123");
    }
  });
});
