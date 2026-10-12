import { describe, expect, it } from "vitest";
import { normalise, NORMALISATION_RULES } from "./linelist-normalise";

const fix = (field: string, value: string) => normalise(field, value)?.value ?? null;

describe("every rule is documented", () => {
  it("has an id, a version, fields, a precondition and a prohibition", () => {
    for (const r of NORMALISATION_RULES) {
      expect(r.id && r.version && r.fields.length && r.precondition && r.never).toBeTruthy();
    }
  });
});

describe("stray characters at the edge of a typed value", () => {
  it.each([
    ["vaccination_date", "02/02/2026'", "02/02/2026"],
    ["report_date", "2025-04-09'", "2025-04-09"],
    ["diluent_batch", ":06851062", "06851062"],
    ["vaccine_batch", "B20066;", "B20066"],
  ])("%s %j → %j", (field, value, want) => expect(fix(field, value)).toBe(want));
  it.each([
    ["vaccine_batch", ".5"],
    ["age_months", "-4"],
    ["vaccine_batch", "AB'123"],
    ["case_id", "Q-77'"],
    ["reporter_phone", "'08012345678"],
    ["remarks", "rash; fever,"],
  ])("never: %s %j", (field, value) => expect(fix(field, value)).toBeNull());
});

describe("interval units: the onset reader's own dictionary, nothing guessed", () => {
  it.each([
    ["10 MINITES", "10 MINUTES"],
    ["5 minits", "5 minutes"],
    ["1 minits", "1 minute"],
    ["3 HOURES", "3 HOURS"],
    ["24 house", "24 hours"],
    ["2 DAYZ", "2 DAYS"],
    ["2hrs 30 minits", "2hrs 30 minutes"],
  ])("%j → %j", (value, want) => expect(fix("onset_interval", value)).toBe(want));
  it.each([
    ["2 dyas"],
    ["10 MINUTES"],
    ["2 hrs"],
    ["hrs"],
    ["24"],
    ["05/05/2025"],
    ["2 days later maybe"],
  ])("never: %j", (value) => expect(fix("onset_interval", value)).toBeNull());
  it("only on an interval column", () => expect(fix("remarks", "10 MINITES")).toBeNull());
});

describe("doses: formatting and spelling only, never the quantity", () => {
  it.each([
    ["0,5ML", "0.5ML"],
    ["0,5 mL", "0.5 mL"],
    ["1at", "1st"],
    ["2nf", "2nd"],
    ["1AT", "1ST"],
    ["3re dose", "3rd dose"],
  ])("%j → %j", (value, want) => expect(fix("dose", value)).toBe(want));
  it.each([
    ["10"],
    ["0.5MI"],
    ["1nd"],
    ["1st"],
    ["0.5ml"],
    ["1,2"],
    ["5 mL"],
    ["Penta 1"],
    ["1st dose"],
  ])("never: %j", (value) => expect(fix("dose", value)).toBeNull());
});

describe("reaction code lists: delimiters only, codes untouched", () => {
  it.each([
    ["8,", "8"],
    ["3, 5,", "3, 5"],
    ["4/", "4"],
    ["2, 7;", "2, 7"],
    ["12 AND 20", "12, 20"],
    ["11&13", "11, 13"],
  ])("%j → %j", (value, want) => expect(fix("reaction_code", value)).toBe(want));
  it.each([
    ["4, 20"],
    ["4,20"],
    ["8.19.21"],
    ["28 PAIN AT THE INJECTION SITE"],
    ["6 SWELLING OF THE LIP"],
    ["12 OR 20"],
  ])("never: %j", (value) => expect(fix("reaction_code", value)).toBeNull());
});

describe("a column's own unit in a number", () => {
  it("months in a months column", () => expect(fix("age_months", "9 months")).toBe("9"));
  it("years in a years column", () => expect(fix("age", "4 yrs")).toBe("4"));
  it("never another column's unit", () => {
    expect(fix("age", "9 months")).toBeNull();
    expect(fix("age_months", "2 years")).toBeNull();
  });
});

describe("fields no rule may touch", () => {
  it.each([
    ["case_id"],
    ["patient_id"],
    ["patient_identifier"],
    ["reporter_phone"],
    ["reporter_name"],
    ["remarks"],
    ["medical_history"],
  ])("%s", (field) => {
    for (const v of ["02/02/2026'", "10 MINITES", "0,5ML", "1at", "8,", "9 months"])
      expect(fix(field, v)).toBeNull();
  });
});
