import { describe, expect, it } from "vitest";
import { INPUTS, SECTIONS, SECTION_BY_ID, type InputKey } from "./template";
import { buildDraftFacts, codedReactionCodes, type CaseRecord } from "./facts";
import { draftReadiness, missingInputs, sectionStatus } from "./status";
import { placeholderText, printsIn, sectionBlocks } from "./content";
import type { PsurDraft } from "./drafts";
import type { CatalogDrug } from "@/services/api/products";
import type { Signal } from "@/types/pv";

describe("template", () => {
  it("follows the NAFDAC Full Template: front matter, then Sections 1–21 in order", () => {
    expect(SECTIONS.slice(0, 3).map((s) => s.id)).toEqual([
      "COVER_LETTER",
      "TITLE_PAGE",
      "EXEC_SUMMARY",
    ]);
    expect(SECTIONS.slice(3).map((s) => s.number)).toEqual(
      Array.from({ length: 21 }, (_, i) => String(i + 1)),
    );
    expect(SECTION_BY_ID.S20.title).toMatch(/Previous NAFDAC Queries/);
  });
  it("uses every author input in exactly one section", () => {
    const used = SECTIONS.flatMap((s) => s.inputs);
    expect(new Set(used).size).toBe(used.length);
    expect([...used].sort()).toEqual((Object.keys(INPUTS) as InputKey[]).sort());
  });
  it("only lets the sections ICH allows to be empty be marked not applicable", () => {
    expect(SECTIONS.filter((s) => s.naAllowed).map((s) => s.id)).toEqual([
      "S7",
      "S8",
      "S9",
      "S10",
      "S12",
      "S13",
    ]);
  });
});

const drug: CatalogDrug = { id: "d1", name: "Paracetamol", ownBrand: true, holder: "Demo Org" };

const kase = (id: string, extra: Partial<CaseRecord> = {}): CaseRecord => ({
  id,
  patientIdentifier: "P",
  product: "Paracetamol",
  reaction: "Rash",
  seriousness: "NON_SERIOUS",
  outcome: "RECOVERED",
  workflowStep: "TRIAGE",
  assignedTo: "x",
  receivedDate: "2026-03-01",
  dueDate: "2026-03-01",
  priority: "LOW",
  flags: [],
  source: "MANUAL",
  ...extra,
});

describe("buildDraftFacts", () => {
  const cases: CaseRecord[] = [
    kase("OLD", { receivedDate: "2025-06-01" }),
    kase("A", {
      receivedDate: "2025-09-01",
      seriousness: "SERIOUS",
      outcome: "FATAL",
      reportedSeriousnessCriteria: ["Results in death"],
      patient: { identifier: "P", sex: "FEMALE", age: "34" },
      reporter: { name: "R", qualification: "Pharmacist", country: "Nigeria" },
      reactions: [
        {
          reportedTerm: "skin rash",
          outcome: "FATAL",
          codedTerm: {
            term: "Rash",
            code: "10037844",
            dictionary: "MedDRA",
            dictionaryVersion: "27.0",
          },
        },
      ],
      suspectProducts: [{ reportedName: "Paracetamol", batchNumber: "PX-1" }],
    }),
    kase("B", {
      receivedDate: "2026-08-31",
      reaction: "Nausea",
      intakeChannel: "BRANCH",
      branch: "Lekki",
    }),
    kase("BOUNDARY", { receivedDate: "2025-08-31" }),
    kase("LATE", { receivedDate: "2026-09-10", seriousness: "SERIOUS" }),
    kase("OTHER", { product: "Ibuprofen", receivedDate: "2026-01-01" }),
    kase("BYID", { product: "Renamed", productId: "d1", receivedDate: "2026-02-01" }),
  ];
  const signals: Signal[] = [
    {
      id: "s1",
      reference: "S-1",
      product: "paracetamol",
      reaction: "Rash",
      detectionMethod: "PRR",
      detectionPeriod: "2026",
      caseCount: 3,
      statistic: [],
      supportingCaseIds: [],
      status: "UNDER_REVIEW",
    },
    {
      id: "s2",
      reference: "S-2",
      product: "Ibuprofen",
      reaction: "GI bleed",
      detectionMethod: "PRR",
      detectionPeriod: "2026",
      caseCount: 3,
      statistic: [],
      supportingCaseIds: [],
      status: "POTENTIAL",
    },
  ];
  const f = buildDraftFacts({
    drug,
    periodStart: "2025-08-31",
    dlp: "2026-08-31",
    cases,
    signals,
    registrations: [
      {
        id: "r",
        productName: "Paracetamol",
        registrationNumber: "A4-1",
        status: "ACTIVE",
        variations: [],
        commitments: [],
      },
    ],
    organisation: "Demo Org",
    now: new Date("2026-11-03T10:00:00Z"),
  });

  it("counts the interval (start exclusive, DLP inclusive) and cumulatively to the DLP", () => {
    expect(f.lineListing.map((r) => r.caseId)).toEqual(["A", "BYID", "B"]);
    expect(f.interval).toEqual({
      total: 3,
      nigerian: 1,
      serious: 1,
      nonSerious: 2,
      unassessed: 0,
      fatal: 1,
    });
    expect(f.cumulative.total).toBe(5);
  });
  it("lists cases received after the DLP as late-breaking", () => {
    expect(f.lateBreaking.map((r) => r.caseId)).toEqual(["LATE"]);
  });
  it("tabulates by MedDRA term where coded, reported term otherwise", () => {
    const coded = f.reactions.find((r) => r.term === "Rash" && r.coded)!;
    const reported = f.reactions.find((r) => r.term === "Rash" && !r.coded)!;
    expect(coded).toMatchObject({
      cumulative: 1,
      interval: 1,
      intervalSerious: 1,
      cumulativeSerious: 1,
    });
    expect(reported).toMatchObject({ cumulative: 3, interval: 1, intervalSerious: 0 });
    expect(f.uncodedInInterval).toBe(2);
  });
  it("tabulates by preferred term and primary SOC when the dictionary resolves the code", () => {
    const withSoc = buildDraftFacts({
      drug,
      periodStart: "2025-08-31",
      dlp: "2026-08-31",
      cases,
      signals: [],
      registrations: [],
      organisation: "Demo Org",
      meddra: new Map([
        ["10037844", { preferredTerm: "Rash", soc: "Skin and subcutaneous tissue disorders" }],
      ]),
    });
    expect(codedReactionCodes(cases)).toEqual(["10037844"]);
    expect(withSoc.reactions.find((r) => r.coded)).toMatchObject({
      term: "Rash",
      soc: "Skin and subcutaneous tissue disorders",
    });
    const table = sectionBlocks(draft({ facts: withSoc }), "S6").find((b) => b.kind === "table");
    expect(table).toMatchObject({
      headers: [
        "System organ class",
        "Preferred term",
        "Interval (serious)",
        "Cumulative (serious)",
      ],
    });
    const rows = (table as { rows: string[][] }).rows;
    expect(rows[0]![0]).toBe("Skin and subcutaneous tissue disorders");
    expect(rows.at(-1)![0]).toBe("Not yet coded");
  });
  it("carries line-listing detail only where the case holds it", () => {
    const a = f.lineListing[0]!;
    expect(a).toMatchObject({
      sex: "FEMALE",
      age: "34",
      batch: "PX-1",
      criteria: ["Results in death"],
      outcome: "FATAL",
    });
    expect(f.lineListing[2]!.sex).toBeUndefined();
    expect(f.lineListing[2]!.source).toBe("Branch / store — Lekki");
  });
  it("takes only this product's signals and its registration", () => {
    expect(f.signals.map((s) => s.reaction)).toEqual(["Rash"]);
    expect(f.registration?.registrationNumber).toBe("A4-1");
    expect(f.takenAt).toBe("2026-11-03T10:00:00.000Z");
  });
});

const draft = (extra: Partial<PsurDraft> = {}): PsurDraft => ({
  id: "x",
  productId: "d1",
  productName: "Paracetamol",
  periodStart: "2025-08-31",
  dlp: "2026-08-31",
  intervalMonths: 12,
  status: "DRAFT",
  inputs: {},
  sections: {},
  createdBy: "x",
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("section status", () => {
  it("needs the author until every required input is filled", () => {
    expect(sectionStatus(draft(), SECTION_BY_ID.S2)).toBe("NEEDS_AUTHOR");
    expect(
      sectionStatus(draft({ inputs: { worldwideStatus: "Nigeria only" } }), SECTION_BY_ID.S2),
    ).toBe("READY_TO_REVIEW");
    expect(missingInputs(draft({ inputs: { rsiTypeVersion: "  " } }), SECTION_BY_ID.S4)).toEqual([
      "rsiTypeVersion",
      "rsiChanges",
    ]);
  });
  it("needs a data refresh for records-based sections", () => {
    expect(sectionStatus(draft(), SECTION_BY_ID.S15)).toBe("NEEDS_DATA");
  });
  it("accepts not applicable only with a reason, and only where allowed", () => {
    expect(
      sectionStatus(
        draft({ sections: { S7: { notApplicable: { reason: "No trials." } } } }),
        SECTION_BY_ID.S7,
      ),
    ).toBe("NOT_APPLICABLE");
    expect(
      sectionStatus(
        draft({ sections: { S7: { notApplicable: { reason: " " } } } }),
        SECTION_BY_ID.S7,
      ),
    ).toBe("NEEDS_AUTHOR");
    expect(
      sectionStatus(
        draft({ sections: { S2: { notApplicable: { reason: "x" } } } }),
        SECTION_BY_ID.S2,
      ),
    ).toBe("NEEDS_AUTHOR");
  });
  it("allows the clean draft only when every section is reviewed or not applicable", () => {
    const r = draftReadiness(draft());
    expect(r.cleanAllowed).toBe(false);
    expect(r.total).toBe(24);
    expect(r.blocking).toContain("TITLE_PAGE");
  });
});

describe("content — nothing is invented", () => {
  const facts = buildDraftFacts({
    drug,
    periodStart: "2025-08-31",
    dlp: "2026-08-31",
    cases: [
      kase("A", {
        receivedDate: "2025-10-01",
        seriousness: "SERIOUS",
        reporter: { name: "R", qualification: "Pharmacist", country: "Nigeria" },
      }),
      kase("B", { receivedDate: "2026-01-01" }),
    ],
    signals: [],
    registrations: [],
    organisation: "Demo Org",
    now: new Date("2026-11-03T10:00:00Z"),
  });

  it("prints a placeholder, never text, for every empty required input", () => {
    const d = draft({ facts });
    for (const s of SECTIONS) {
      const blocks = sectionBlocks(d, s.id);
      expect(
        blocks.some((b) => b.origin === "AUTHOR"),
        s.id,
      ).toBe(false);
      for (const k of s.inputs.filter((k) => INPUTS[k].required)) {
        expect(
          blocks.some((b) => JSON.stringify(b).includes(placeholderText(k))),
          `${s.id} ${k}`,
        ).toBe(true);
      }
    }
  });

  it("prints the author's text exactly as written", () => {
    const d = draft({
      facts,
      inputs: { worldwideStatus: "  Marketed in Nigeria only since 2019.  " },
    });
    expect(sectionBlocks(d, "S2")).toEqual([
      { kind: "para", text: "Marketed in Nigeria only since 2019.", origin: "AUTHOR" },
    ]);
  });

  it("states the counts from the facts, with the interval from the day after the last DLP", () => {
    const text = JSON.stringify(sectionBlocks(draft({ facts }), "S6"));
    expect(text).toContain("1 September 2025 to 31 August 2026");
    expect(text).toContain("2 individual case safety reports (ICSRs)");
    expect(text).toContain("of which 1 was serious");
    expect(text).toContain("1 was reported from Nigeria");
  });

  it("writes a nil statement when there are no cases, and says data is missing before a refresh", () => {
    const empty = buildDraftFacts({
      drug,
      periodStart: "2025-08-31",
      dlp: "2026-08-31",
      cases: [],
      signals: [],
      registrations: [],
      organisation: "O",
    });
    expect(JSON.stringify(sectionBlocks(draft({ facts: empty }), "S21"))).toContain(
      "Nil statement",
    );
    expect(sectionBlocks(draft(), "S6")[0]!.origin).toBe("PLACEHOLDER");
  });

  it("prints a not-applicable reason only where the author gave one", () => {
    const d = draft({
      facts,
      sections: { S7: { notApplicable: { reason: "No trials sponsored." } } },
    });
    expect(sectionBlocks(d, "S7")).toEqual([
      { kind: "para", text: "No trials sponsored.", origin: "NA" },
    ]);
    expect(sectionBlocks(draft({ facts }), "S7")[0]!.origin).toBe("PLACEHOLDER");
  });

  it("keeps author aids out of the clean draft", () => {
    expect(printsIn({ kind: "para", text: "x", origin: "AID" }, "clean")).toBe(false);
    expect(printsIn({ kind: "para", text: "x", origin: "AID" }, "working")).toBe(true);
  });

  it("marks the executive summary incomplete while a borrowed input is empty", () => {
    expect(sectionStatus(draft({ facts }), SECTION_BY_ID.EXEC_SUMMARY)).toBe("NEEDS_AUTHOR");
  });
});
