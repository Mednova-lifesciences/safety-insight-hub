import { describe, expect, it } from "vitest";
import {
  codebookKeyForField,
  fieldForCodebookKey,
  findCodeListConflicts,
  keyForHeading,
  readCodeListText,
} from "./code-list-text";

const ONDO_COLUMNS = [
  { header: "SEX", field: "sex" },
  { header: "Reaction type (Codes -see 1 below )", field: "reaction" },
  { header: "Type of AEFI (Non-serious or Serious)", field: "seriousness" },
  { header: "If serious case select appropriste code 2 below.", field: "serious_code" },
  { header: "Outcome (Codes-see 3 below)", field: "outcome" },
  { header: "Designation of the reporting officer", field: "reporter_designation" },
];

const pairs = (text: string, columns = ONDO_COLUMNS) =>
  readCodeListText(text, columns).entries.map((e) => `${e.field}|${e.sourceCode}|${e.meaning}`);

describe("reading a code list a person typed", () => {
  it("reads Ondo's own one-line-per-field layout", () => {
    const got = pairs(
      [
        "1) REACTION TYPE : 1=Anaphylaxis, 2=Anaphylactic Shock, 3=Dizziness",
        "2) SERIUOS CASE: 1. Life treathening; 2. Disability; 3. Hospitalizaton",
        "3) OUTCOME: 1= Recovered, 2=Hospitalized, 3=Disability, 4=Died",
      ].join("\n"),
    );
    expect(got).toEqual([
      "reaction|1|Anaphylaxis",
      "reaction|2|Anaphylactic Shock",
      "reaction|3|Dizziness",
      "seriousness|1|Life treathening",
      "seriousness|2|Disability",
      "seriousness|3|Hospitalizaton",
      "outcome|1|Recovered",
      "outcome|2|Hospitalized",
      "outcome|3|Disability",
      "outcome|4|Died",
    ]);
  });

  it("reads a heading followed by one code per line, in any common style", () => {
    const got = pairs(
      [
        "Outcome",
        "1. Recovered",
        "2 - Hospitalised",
        "3: Disability",
        "4) Died",
        "",
        "Sex",
        "1 = Male",
        "2 = Female",
      ].join("\n"),
    );
    expect(got).toEqual([
      "outcome|1|Recovered",
      "outcome|2|Hospitalised",
      "outcome|3|Disability",
      "outcome|4|Died",
      "sex|1|Male",
      "sex|2|Female",
    ]);
  });

  it("accepts the file's own column header as the heading", () => {
    expect(pairs("Designation of the reporting officer: 1=CHEW, 2=Nurse, 3=Doctor")).toEqual([
      "reporter_designation|1|CHEW",
      "reporter_designation|2|Nurse",
      "reporter_designation|3|Doctor",
    ]);
  });

  it("keeps the seriousness criterion code apart from the serious / non-serious column", () => {
    expect(pairs("Type of AEFI: 1=Non-serious, 2=Serious")).toEqual([
      "seriousness_aggregate|1|Non-serious",
      "seriousness_aggregate|2|Serious",
    ]);
    expect(pairs("If serious: 1=Life threatening, 5=Death")).toEqual([
      "seriousness|1|Life threatening",
      "seriousness|5|Death",
    ]);
  });

  it("does not read a range in a heading as a code", () => {
    expect(pairs("Reaction type (codes 1-28)\n19 = Fever")).toEqual(["reaction|19|Fever"]);
  });

  it("returns codes it cannot tie to a field instead of guessing", () => {
    const r = readCodeListText("Colour of card\n1 = Red\n2 = Blue", ONDO_COLUMNS);
    expect(r.entries).toEqual([]);
    expect(r.unplaced).toEqual(["Colour of card", "1 = Red", "2 = Blue"]);
  });

  it("knows the ordinary names of the other coded fields", () => {
    expect(keyForHeading("Route of administration")).toBe("route");
    expect(keyForHeading("Age unit")).toBe("age_unit");
    expect(keyForHeading("Age group")).toBe("age_group");
    expect(keyForHeading("Dose unit")).toBe("dose_unit");
    expect(keyForHeading("Gender")).toBe("sex");
    expect(keyForHeading("Vaccine")).toBe("product");
  });
});

describe("conflicts and field keys", () => {
  it("one code given two meanings is a conflict; an identical repeat is merged", () => {
    const { entries, conflicts } = findCodeListConflicts([
      { field: "sex", sourceCode: "1", meaning: "Male" },
      { field: "sex", sourceCode: "1", meaning: "Female" },
      { field: "sex", sourceCode: "2", meaning: "Female" },
      { field: "sex", sourceCode: "2", meaning: "Female" },
    ]);
    expect(conflicts).toEqual([{ field: "sex", sourceCode: "1", meanings: ["Male", "Female"] }]);
    expect(entries).toEqual([{ field: "sex", sourceCode: "2", meaning: "Female" }]);
  });

  it("maps fields to codebook keys and back", () => {
    for (const f of ["serious_code", "seriousness", "sex", "route", "outcome"]) {
      expect(fieldForCodebookKey(codebookKeyForField(f))).toBe(f);
    }
    expect(codebookKeyForField("reaction_code")).toBe("reaction");
  });
});
