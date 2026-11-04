import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildDraftDocx } from "./draft-docx";
import { presubmissionCheck, presubmissionSummary } from "./presubmission";
import { buildDraftFacts } from "./facts";
import { INPUTS, SECTIONS, type InputKey } from "./template";
import { draftReadiness } from "./status";
import type { PsurDraft } from "./drafts";

const facts = buildDraftFacts({
  drug: { id: "d1", name: "Paracetamol", ownBrand: true },
  periodStart: "2025-08-31",
  dlp: "2026-08-31",
  cases: [],
  signals: [
    {
      id: "l",
      reference: "L",
      product: "Paracetamol",
      reaction: "Liver injury",
      detectionMethod: "Literature",
      detectionPeriod: "2026",
      caseCount: 0,
      statistic: [],
      supportingCaseIds: [],
      status: "POTENTIAL",
      literature: {
        articleId: "a",
        publication: "Journal X",
        headline: "SECRET-AID-HEADLINE",
        publicationDate: "2026-01-01",
        author: "A",
        keywords: [],
        contextSnippet: "",
        riskLevel: "LOW",
      },
    },
  ],
  registrations: [],
  organisation: "Demo",
  now: new Date("2026-09-10T00:00:00Z"),
});

const base: PsurDraft = {
  id: "x",
  productId: "d1",
  productName: "Paracetamol",
  periodStart: "2025-08-31",
  dlp: "2026-08-31",
  intervalMonths: 12,
  ibd: "2019-08-31",
  status: "DRAFT",
  inputs: {},
  sections: {},
  facts,
  createdBy: "x",
  createdAt: "",
  updatedAt: "",
};

function complete(): PsurDraft {
  const inputs = Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((k) => [k, `Author text for ${k}`]),
  ) as Record<InputKey, string>;
  inputs.conclusionsActions = "The benefit-risk balance remains favourable.";
  const sections = Object.fromEntries(
    SECTIONS.map((s) => [
      s.id,
      s.naAllowed
        ? { notApplicable: { reason: `Not applicable reason ${s.id}` } }
        : { reviewed: { by: "QPPV", at: "2026-09-10T00:00:00Z" } },
    ]),
  );
  return { ...base, inputs, sections };
}

async function docText(d: PsurDraft, v: "working" | "clean") {
  const buf = await Packer.toBuffer(buildDraftDocx(d, v));
  const zip = await JSZip.loadAsync(buf);
  return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "");
}

describe("Word export", () => {
  it("builds a working draft at any stage, with placeholders and aids", async () => {
    const t = await docText(base, "working");
    expect(t).toContain("WORKING DRAFT");
    expect(t).toContain("TO BE COMPLETED BY AUTHOR");
    expect(t).toContain("SECRET-AID-HEADLINE");
    expect(t).toContain("21. Appendices");
  });

  it("refuses the clean draft until every section is done", () => {
    expect(() => buildDraftDocx(base, "clean")).toThrow(/every section/);
  });

  it("prints the clean draft without placeholders, origin tags or author aids", async () => {
    const d = complete();
    expect(draftReadiness(d).cleanAllowed).toBe(true);
    const t = await docText(d, "clean");
    expect(t).not.toContain("TO BE COMPLETED");
    expect(t).not.toContain("[from records]");
    expect(t).not.toContain("[author]");
    expect(t).not.toContain("SECRET-AID-HEADLINE");
    expect(t).not.toContain("WORKING DRAFT");
    expect(t).toContain("Author text for worldwideStatus");
    expect(t).toContain("Not applicable reason S7");
    expect(t).toContain("Nil statement");
    for (const s of SECTIONS.filter((x) => x.number))
      expect(t).toContain(`${s.number}. ${s.title}`);
  });
});

describe("pre-submission check", () => {
  it("lists the 16 screening items in order, then the Nigerian requirements", () => {
    const items = presubmissionCheck(base, "2026-09-10");
    expect(items.slice(0, 16).map((i) => i.number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    expect(items.slice(16).map((i) => i.key)).toEqual([
      "NIGERIAN_EXPOSURE",
      "NIGERIAN_CASES",
      "NIGERIAN_RECONCILIATION",
      "BENEFIT_RISK_STATED",
      "DATA_FATAL_NOT_SERIOUS",
      "DATA_CODED",
      "DATA_SOC",
      "DATA_ONSET_DATES",
    ]);
  });

  it("asks for action on everything the author has not supplied", () => {
    const sum = presubmissionSummary(presubmissionCheck(base, "2026-09-10"));
    expect(sum.action).toBeGreaterThan(8);
  });

  it("leaves only pass or by-hand items for a complete, on-time draft", () => {
    const items = presubmissionCheck(complete(), "2026-09-10");
    expect(items.filter((i) => i.result === "ACTION")).toEqual([]);
    expect(items.find((i) => i.key === "IBD_AND_FIRST_REGISTRATION_STATED")?.result).toBe("PASS");
    expect(items.find((i) => i.key === "PDF_OPENS_AND_FOLLOWS_TEMPLATE")?.result).toBe("MANUAL");
  });

  it("flags a late submission and a DLP off the IBD anniversary", () => {
    const late = presubmissionCheck(complete(), "2026-11-20");
    expect(late.find((i) => i.key === "RECEIVED_WITHIN_TIMEFRAME")).toMatchObject({
      result: "ACTION",
    });
    expect(late.find((i) => i.key === "RECEIVED_WITHIN_TIMEFRAME")?.detail).toMatch(
      /2026-11-09.*11 day\(s\) late/,
    );
    const off = presubmissionCheck({ ...complete(), ibd: "2019-07-15" }, "2026-09-10");
    expect(off.find((i) => i.key === "IBD_AND_FIRST_REGISTRATION_STATED")?.result).toBe("ACTION");
  });
});

describe("found in the live test", () => {
  // The live Paracetamol data, reduced: one serious uncoded case, and one
  // fatal case recorded as non-serious with an onset after receipt.
  const liveFacts = buildDraftFacts({
    drug: { id: "d1", name: "Paracetamol", ownBrand: true },
    periodStart: "2025-08-31",
    dlp: "2026-08-31",
    cases: [
      {
        id: "MN-1",
        patientIdentifier: "P",
        product: "paracetamol",
        reaction: "rashes",
        seriousness: "SERIOUS",
        outcome: "UNKNOWN",
        workflowStep: "QC",
        assignedTo: "x",
        receivedDate: "2026-08-19",
        dueDate: "",
        priority: "HIGH",
        flags: [],
        source: "MANUAL",
      },
      {
        id: "MN-12",
        patientIdentifier: "P",
        product: "Paracetamol",
        reaction: "RASHES",
        seriousness: "NON_SERIOUS",
        outcome: "FATAL",
        workflowStep: "QC",
        assignedTo: "x",
        receivedDate: "2026-08-27",
        dueDate: "",
        priority: "LOW",
        flags: [],
        source: "MANUAL",
        reactions: [
          {
            reportedTerm: "RASHES",
            outcome: "FATAL",
            onsetDate: "2026-09-12",
            codedTerm: {
              term: "Rash",
              code: "10037844",
              dictionary: "MedDRA",
              dictionaryVersion: "x",
            },
          },
        ],
      },
    ],
    signals: [
      {
        id: "s",
        reference: "S",
        product: "paracetamol syrup",
        reaction: "severe hepatotoxicity",
        detectionMethod: "Local literature screening",
        detectionPeriod: "2026",
        caseCount: 0,
        statistic: [],
        supportingCaseIds: [],
        status: "UNDER_REVIEW",
        literature: {
          articleId: "a",
          publication: "Lagos Health Watch",
          headline: "h",
          publicationDate: "2026-03-10",
          author: "a",
          keywords: [],
          contextSnippet: "",
          riskLevel: "HIGH",
        },
      },
      {
        id: "t",
        reference: "T",
        product: "Paracetamolx",
        reaction: "x",
        detectionMethod: "m",
        detectionPeriod: "p",
        caseCount: 1,
        statistic: [],
        supportingCaseIds: [],
        status: "POTENTIAL",
      },
    ],
    registrations: [],
    organisation: "Demo",
  });

  it("counts serious in the table exactly as the text does", () => {
    const tableSerious = liveFacts.reactions.reduce((n, r) => n + r.intervalSerious, 0);
    expect(tableSerious).toBe(liveFacts.interval.serious);
  });

  it("finds a signal naming the product as a whole word, shown as recorded", () => {
    expect(liveFacts.signals.map((s) => [s.product, s.origin, s.status])).toEqual([
      ["paracetamol syrup", "Literature", "UNDER_REVIEW"],
    ]);
  });

  it("flags the record problems before export", () => {
    const items = presubmissionCheck({ ...base, facts: liveFacts }, "2026-09-10");
    const get = (k: string) => items.find((i) => i.key === k)!;
    expect(get("DATA_FATAL_NOT_SERIOUS")).toMatchObject({
      result: "ACTION",
      detail: expect.stringContaining("MN-12"),
    });
    expect(get("DATA_CODED")).toMatchObject({
      result: "ACTION",
      detail: expect.stringContaining("MN-1"),
    });
    expect(get("DATA_ONSET_DATES")).toMatchObject({
      result: "ACTION",
      detail: expect.stringContaining("MN-12"),
    });
  });
});
