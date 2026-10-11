import { describe, expect, it } from "vitest";
import {
  checkDlpAgainstIbd,
  compareIbd,
  findRegisterEntry,
  parseRegisterCsv,
  readDocumentDate,
  showDate,
  type IbdRegisterEntry,
} from "./ibd-register";

const entry = (over: Partial<IbdRegisterEntry>): IbdRegisterEntry => ({
  id: "e1",
  activeSubstance: "Amoxicillin / Clavulanate potassium",
  ibd: "2014-03-17",
  productNames: ["Amoxiclav 625"],
  nafdacRegNos: ["A4-100123"],
  source: "Company declaration",
  by: "admin",
  at: "2026-10-11T00:00:00Z",
  ...over,
});

describe("reading the dates PSURs write", () => {
  it.each([
    ["17 March 2014", "2014-03-17"],
    ["17th Mar 2014", "2014-03-17"],
    ["March 17, 2014", "2014-03-17"],
    ["2014-03-17", "2014-03-17"],
    ["17/03/2014", "2014-03-17"],
    ["03/17/2014", "2014-03-17"],
    ["05/06/2014", "2014-06-05"],
    ["17.03.2014", "2014-03-17"],
  ])("%s → %s", (raw, want) => expect(readDocumentDate(raw)).toBe(want));
  it("does not invent a date", () => {
    for (const bad of ["", "unknown", "31/02/2014", "2014"]) expect(readDocumentDate(bad), bad).toBeNull();
  });
  it("shows dates as people read them", () => expect(showDate("2014-03-17")).toBe("17 Mar 2014"));
});

describe("finding a report's register entry", () => {
  const reg = [entry({}), entry({ id: "e2", activeSubstance: "Tramadol", ibd: "1977-01-01", productNames: ["Tramadol 50"], nafdacRegNos: ["B1-2"] })];
  it("by registration number first, ignoring punctuation", () => {
    expect(findRegisterEntry(reg, { nafdacRegNo: "a4 100123", activeSubstance: "Tramadol" })?.entry.id).toBe("e1");
  });
  it("then by active substance, in any order", () => {
    const m = findRegisterEntry(reg, { activeSubstance: "clavulanate potassium, amoxicillin" });
    expect(m?.entry.id).toBe("e1");
    expect(m?.matchedOn).toBe("active substance");
  });
  it("then by product name", () => {
    expect(findRegisterEntry(reg, { productName: "Tramadol 50 mg capsules" })?.matchedOn).toBe("product name");
  });
  it("never guesses between two candidates", () => {
    const two = [entry({}), entry({ id: "e3", nafdacRegNos: [], productNames: ["Amoxiclav 625"] })];
    expect(findRegisterEntry(two, { productName: "Amoxiclav 625" })).toBeNull();
  });
});

describe("the PSUR's IBD against the register", () => {
  const reg = [entry({})];
  const base = { nafdacRegNo: "A4-100123" };
  it("aligns when the dates agree, however written", () => {
    expect(compareIbd(reg, { ...base, ibd: "17 March 2014" }).status).toBe("ALIGNS");
  });
  it("differs", () => {
    const c = compareIbd(reg, { ...base, ibd: "17 March 2015" });
    expect(c).toMatchObject({ status: "DIFFERS", stated: "2015-03-17", registered: "2014-03-17" });
  });
  it("not stated, unreadable, not in the register", () => {
    expect(compareIbd(reg, { ...base, ibd: "" }).status).toBe("NOT_STATED");
    expect(compareIbd(reg, { ...base, ibd: "see annex" }).status).toBe("UNREADABLE");
    expect(compareIbd(reg, { nafdacRegNo: "Z9-9", ibd: "1 Jan 2000" })).toEqual({ status: "NOT_IN_REGISTER", stated: "2000-01-01" });
  });
});

describe("the DLP against the IBD's cycle", () => {
  it("IBD 17 Mar → DLPs 16 Mar or 16 Sep", () => {
    expect(checkDlpAgainstIbd("2014-03-17", "16 September 2026")).toEqual({ aligned: true, expected: ["16 Mar", "16 Sep"] });
    expect(checkDlpAgainstIbd("2014-03-17", "16/03/2026")?.aligned).toBe(true);
    expect(checkDlpAgainstIbd("2014-03-17", "31 August 2026")?.aligned).toBe(false);
  });
  it("tolerates a day for month lengths", () => {
    expect(checkDlpAgainstIbd("2014-03-17", "15 September 2026")?.aligned).toBe(true);
  });
  it("IBD on the 31st rolls to the month's last day", () => {
    expect(checkDlpAgainstIbd("2010-03-31", "30 September 2026")).toEqual({ aligned: true, expected: ["30 Mar", "30 Sep"] });
  });
  it("IBD on the 1st → the last day of the previous month", () => {
    expect(checkDlpAgainstIbd("2010-01-01", "31 December 2025")?.aligned).toBe(true);
    expect(checkDlpAgainstIbd("2010-01-01", "30 June 2026")?.aligned).toBe(true);
  });
  it("no answer without a readable DLP", () => expect(checkDlpAgainstIbd("2014-03-17", "")).toBeNull());
});

describe("importing a register CSV", () => {
  it("reads substance, IBD, products, registration numbers and source; reports bad rows", () => {
    const { rows, rejected } = parseRegisterCsv(
      [
        "Active substance,IBD,Product names,NAFDAC Reg No,Source",
        '"Amoxicillin, clavulanate",17/03/2014,Amoxiclav 625; Augmentin,A4-100123,Company declaration',
        "Tramadol,not known,Tramadol 50,,",
        ",01/01/2000,X,,",
      ].join("\n"),
    );
    expect(rows).toEqual([
      {
        activeSubstance: "Amoxicillin, clavulanate",
        ibd: "2014-03-17",
        productNames: ["Amoxiclav 625", "Augmentin"],
        nafdacRegNos: ["A4-100123"],
        source: "Company declaration",
      },
    ]);
    expect(rejected.map((r) => r.line)).toEqual([3, 4]);
  });
  it("needs a substance and an IBD column", () => {
    expect(parseRegisterCsv("Name,Date\nX,1/1/2000").rejected[0]!.line).toBe(1);
  });
});
