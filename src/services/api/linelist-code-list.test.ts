import { describe, expect, it } from "vitest";
import {
  codeListFooterLines,
  formCodeListId,
  formColumns,
  formKeyFor,
  isFormCodeListRow,
} from "./linelist-code-list";
import { discoverAndApplyCodebook } from "@/services/e2b-r3/export";
import { ondoAefiProfile } from "@/services/e2b-r3/source-profiles/ondo-aefi";
import type { LineListCodeList } from "@/types/pv";

const ONDO_HEADERS = ["S/N", "ID", "SEX", "Age Years", "Outcome (Codes-see 3 below)", "", ""];

describe("which files share a form", () => {
  it("same columns, in any order and case, are the same form", () => {
    expect(formKeyFor("ondo-aefi", ONDO_HEADERS)).toBe(
      formKeyFor("ondo-aefi", ["outcome (codes-see 3 below)", "age years", "sex", "id", "s/n"]),
    );
  });
  it("a different column layout, or a different profile, is a different form", () => {
    expect(formKeyFor("ondo-aefi", ONDO_HEADERS)).not.toBe(
      formKeyFor("ondo-aefi", [...ONDO_HEADERS, "Remarks"]),
    );
    expect(formKeyFor("ondo-aefi", ONDO_HEADERS)).not.toBe(
      formKeyFor("generic-verbatim", ONDO_HEADERS),
    );
  });
  it("this tool's own annotation columns do not change the form", () => {
    expect(
      formKeyFor("ondo-aefi", [...ONDO_HEADERS, "Changes made", "Decision", "Still needs review"]),
    ).toBe(formKeyFor("ondo-aefi", ONDO_HEADERS));
    expect(formColumns(["", "Changes made", "SEX"])).toEqual(["sex"]);
  });
  it("saved form rows are recognised so the job list can leave them out", () => {
    expect(isFormCodeListRow({ kind: "FORM_CODE_LIST" })).toBe(true);
    expect(isFormCodeListRow({ id: "ll-1", filename: "x.csv" })).toBe(false);
    expect(formCodeListId("ondo-aefi:1a2b3c4d")).toBe("codelist-ondo-aefi-1a2b3c4d");
  });
});

describe("the code list travels with the fixed file", () => {
  const codeList: LineListCodeList = {
    entries: [
      { field: "outcome", sourceCode: "1", meaning: "Recovered" },
      { field: "outcome", sourceCode: "4", meaning: "Died" },
      { field: "sex", sourceCode: "1", meaning: "Male" },
      { field: "sex", sourceCode: "2", meaning: "Female" },
    ],
    text: "…",
    origin: "PERSON",
    formKey: "k",
    by: "A. Bello",
    at: "2026-10-10T09:00:00Z",
  };

  it("prints one line per field under a CODE LIST heading", () => {
    expect(codeListFooterLines(codeList)).toEqual([
      "CODE LIST — added for this file by A. Bello on 2026-10-10",
      "1) OUTCOME: 1=Recovered, 4=Died",
      "2) SEX: 1=Male, 2=Female",
    ]);
    expect(codeListFooterLines(undefined)).toEqual([]);
  });

  it("re-uploading the fixed file reads every field back, sex included", () => {
    const rows = codeListFooterLines(codeList).map((text, i) => ({ row: 300 + i, text }));
    const { runtimeProfile, discovered } = discoverAndApplyCodebook(ondoAefiProfile, rows, {
      file: "fixed.csv",
    });
    const got = discovered.entries.map((e) => `${e.field}|${e.sourceCode}|${e.meaning}`).sort();
    expect(got).toEqual(["outcome|1|Recovered", "outcome|4|Died", "sex|1|Male", "sex|2|Female"]);
    expect(runtimeProfile.fieldCodebooks?.["sex"]?.entries["2"]?.meaning).toBe("Female");
  });
});
