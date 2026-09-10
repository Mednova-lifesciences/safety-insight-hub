import { describe, expect, it } from "vitest";
import { extractRawMappings, parseDiscoveredLegend, validateDiscoveredCodebook } from "./legend-parser";

/**
 * The exact, verbatim text of rows 249-253 of the real source document
 * (src/types/2026, ONDO STATE AEFI.xlsx, Sheet1) — extracted directly via
 * openpyxl and quoted here character-for-character, including its real
 * typos ("SERIUOS", "Hospitalizaton", "treathening") and real formatting
 * inconsistencies (a missing "=" before "9 Site induration", a missing
 * comma between "...18=Joint pain" and "19=Fever..."). This is the actual
 * regression fixture for the parser — not a cleaned-up approximation.
 */
const REAL_TITLE = "KEY TO SUMMARY FINDINGS:";
const REAL_REACTION_LINE =
  "1) REACTION TYPE : 1=Anaphylaxis, 2=Anaphylactic Shock, 3=Dizziness, 4= Headache, 5= Fainting/Syncope, 6=Seizures/convulsion,7=Loss of vision, 8= Local reaction, 9 Site induration, 10=Abscess at injection site, 11=Rash/Urticaria, 12= Lymph node enlargement, 13= Abd cramps, 14=Vomiting, 15=Diarrhoea, 16= Bleeding, 17=muscle pain, 18=Joint pain 19=Fever (<38oC), 20=Fever (>=38oC), 21=Persistent cries (more than 3 hours), 22=Acute Flaccid Paralysis (AFP), 23=Unconsciousness, 24=Sepsis, 25=Encephalopathy, 26=Neck Stiffness, 27=Facial Paralysis, 28=Others (specify) (insert appropriate number in column)";
const REAL_SERIOUS_LINE =
  "2) SERIUOS CASE: 1. Life treathening; 2. Disability; 3. Hospitalizaton; 4. Congenital anomaly; 5. Death (insert appropriate number in column)";
const REAL_OUTCOME_LINE = "3) OUTCOME: 1= Recovered, 2=Hospitalized, 3=Disability, 4=Died (insert appropriate number in column)";

describe("extractRawMappings — real Ondo legend text, verbatim", () => {
  it("extracts all 28 reaction mappings from the real (messy) reaction line", () => {
    const mappings = extractRawMappings(REAL_REACTION_LINE);
    expect(mappings).toHaveLength(28);
    expect(mappings[0]).toEqual({ code: "1", meaning: "Anaphylaxis" });
  });

  it("recovers code 9 despite the real document's missing '=' separator", () => {
    const mappings = extractRawMappings(REAL_REACTION_LINE);
    const nine = mappings.find((m) => m.code === "9");
    expect(nine).toBeDefined();
    expect(nine!.meaning).toBe("Site induration");
  });

  it("correctly splits code 18 and 19 despite the real document's missing comma between them", () => {
    const mappings = extractRawMappings(REAL_REACTION_LINE);
    const eighteen = mappings.find((m) => m.code === "18");
    const nineteen = mappings.find((m) => m.code === "19");
    expect(eighteen!.meaning).toBe("Joint pain");
    expect(nineteen!.meaning).toBe("Fever (<38oC)");
  });

  it("code 19 is 'Fever (<38oC)' and code 20 is 'Fever (>=38oC)' — distinct real meanings, never conflated", () => {
    const mappings = extractRawMappings(REAL_REACTION_LINE);
    expect(mappings.find((m) => m.code === "19")!.meaning).toBe("Fever (<38oC)");
    expect(mappings.find((m) => m.code === "20")!.meaning).toBe("Fever (>=38oC)");
  });

  it("code 28 is 'Others (specify)' (trailing instructional note attached, not fabricated)", () => {
    const mappings = extractRawMappings(REAL_REACTION_LINE);
    expect(mappings.find((m) => m.code === "28")!.meaning).toContain("Others (specify)");
  });

  it("code 23 (Unconsciousness) is present in the real legend — used elsewhere as the 'genuinely unknown' negative-control code is a DIFFERENT number not in this list", () => {
    const mappings = extractRawMappings(REAL_REACTION_LINE);
    expect(mappings.find((m) => m.code === "23")!.meaning).toBe("Unconsciousness");
  });

  it("extracts all 5 seriousness mappings despite '.'-separated, real-typo formatting", () => {
    const mappings = extractRawMappings(REAL_SERIOUS_LINE);
    expect(mappings).toHaveLength(5);
    expect(mappings[0]).toEqual({ code: "1", meaning: "Life treathening" });
    expect(mappings[4]!.meaning).toContain("Death");
  });

  it("extracts all 4 outcome mappings", () => {
    const mappings = extractRawMappings(REAL_OUTCOME_LINE);
    expect(mappings).toHaveLength(4);
    expect(mappings[0]).toEqual({ code: "1", meaning: "Recovered" });
    // The trailing instructional note is real source text attached to the
    // last code, same as reaction code 28 above — not fabricated.
    expect(mappings.find((m) => m.code === "4")!.meaning).toContain("Died");
  });

  it("never mistakes a decimal number for a code (no false anchor on '0.5')", () => {
    expect(extractRawMappings("dose 0.5 given")).toHaveLength(0);
  });
});

describe("parseDiscoveredLegend — the full real legend, field-attributed", () => {
  const parsed = parseDiscoveredLegend({
    sourceId: "ondo-aefi",
    lines: [
      { text: REAL_TITLE, row: 249 },
      { text: REAL_REACTION_LINE, row: 250 },
      { text: REAL_SERIOUS_LINE, row: 252 },
      { text: REAL_OUTCOME_LINE, row: 253 },
    ],
    evidence: { file: "src/types/2026, ONDO STATE AEFI.xlsx", sheet: "Sheet1" },
  });

  it("discovers exactly 28 reaction, 5 seriousness, and 4 outcome mappings — 37 total", () => {
    const reaction = parsed.entries.filter((e) => e.field === "reaction");
    const seriousness = parsed.entries.filter((e) => e.field === "seriousness");
    const outcome = parsed.entries.filter((e) => e.field === "outcome");
    expect(reaction).toHaveLength(28);
    expect(seriousness).toHaveLength(5);
    expect(outcome).toHaveLength(4);
    expect(parsed.entries).toHaveLength(37);
  });

  it("status is DISCOVERED", () => {
    expect(parsed.discoveryStatus).toBe("DISCOVERED");
  });

  it("the title-only row (no mappings) is correctly ignored, not treated as a 1-entry section", () => {
    expect(parsed.entries.some((e) => e.sourceEvidence?.row === 249)).toBe(false);
  });

  it("retains real row-level evidence for every entry — an auditor can trace 'why 28 = Others'", () => {
    const entry28 = parsed.entries.find((e) => e.field === "reaction" && e.sourceCode === "28");
    expect(entry28!.sourceEvidence).toMatchObject({
      file: "src/types/2026, ONDO STATE AEFI.xlsx",
      sheet: "Sheet1",
      row: 250,
    });
    expect(entry28!.sourceEvidence!.rawText).toBe(REAL_REACTION_LINE);
  });

  it("evidence.startRow/endRow spans the real discovered section", () => {
    expect(parsed.evidence).toMatchObject({ startRow: 250, endRow: 253 });
  });

  it("validateDiscoveredCodebook accepts all 37 real entries with zero rejections (no internal conflicts in the real legend)", () => {
    const validated = validateDiscoveredCodebook(parsed);
    expect(validated.entries).toHaveLength(37);
    expect(validated.rejectedEntries).toHaveLength(0);
  });
});

describe("parseDiscoveredLegend — status reporting for absent/malformed legends", () => {
  it("reports NOT_FOUND when no lines look like a codebook at all", () => {
    const parsed = parseDiscoveredLegend({
      sourceId: "test",
      lines: [{ text: "Prepared by the State Ministry of Health", row: 5 }],
    });
    expect(parsed.discoveryStatus).toBe("NOT_FOUND");
    expect(parsed.entries).toHaveLength(0);
  });

  it("reports PARSE_FAILED when a field heading is found but no mapping pairs could be extracted", () => {
    const parsed = parseDiscoveredLegend({
      sourceId: "test",
      lines: [{ text: "REACTION TYPE: see attached separate document", row: 5 }],
    });
    expect(parsed.discoveryStatus).toBe("PARSE_FAILED");
  });

  it("never invents a field for a mapping-shaped line with no recognisable heading", () => {
    const parsed = parseDiscoveredLegend({
      sourceId: "test",
      lines: [{ text: "1=Something, 2=Something else, 3=A third thing", row: 5 }],
    });
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.discoveryStatus).toBe("NOT_FOUND");
  });
});

describe("validateDiscoveredCodebook — conflicts and malformed entries", () => {
  it("rejects both sides of a genuine field+code conflict, never silently picks one", () => {
    const codebook = {
      sourceId: "test",
      discoveryStatus: "DISCOVERED" as const,
      rejectedEntries: [],
      entries: [
        { field: "reaction", sourceCode: "1", meaning: "Fever" },
        { field: "reaction", sourceCode: "1", meaning: "Headache" }, // conflicting
        { field: "outcome", sourceCode: "1", meaning: "Recovered" }, // different field, same code — no conflict
      ],
    };
    const validated = validateDiscoveredCodebook(codebook);
    expect(validated.entries.some((e) => e.field === "reaction" && e.sourceCode === "1")).toBe(false);
    expect(validated.entries.some((e) => e.field === "outcome" && e.sourceCode === "1")).toBe(true);
    expect(validated.rejectedEntries.filter((r) => r.entry.field === "reaction")).toHaveLength(2);
  });

  it("collapses an identical duplicate (same field+code+meaning) without rejecting it", () => {
    const codebook = {
      sourceId: "test",
      discoveryStatus: "DISCOVERED" as const,
      rejectedEntries: [],
      entries: [
        { field: "outcome", sourceCode: "1", meaning: "Recovered" },
        { field: "outcome", sourceCode: "1", meaning: "Recovered" },
      ],
    };
    const validated = validateDiscoveredCodebook(codebook);
    expect(validated.entries).toHaveLength(1);
    expect(validated.rejectedEntries).toHaveLength(0);
  });

  it("rejects an entry with an empty meaning", () => {
    const codebook = {
      sourceId: "test",
      discoveryStatus: "DISCOVERED" as const,
      rejectedEntries: [],
      entries: [{ field: "outcome", sourceCode: "9", meaning: "   " }],
    };
    const validated = validateDiscoveredCodebook(codebook);
    expect(validated.entries).toHaveLength(0);
    expect(validated.rejectedEntries).toHaveLength(1);
  });
});
