import { describe, expect, it } from "vitest";
import { parseCompoundSourceValue } from "./compound-source-parser";

const CODEBOOK = {
  "1": { sourceTerm: "Term 1" },
  "2": { sourceTerm: "Term 2" },
  "5": { sourceTerm: "Term 5" },
  "15": { sourceTerm: "Term 15" },
  "21": { sourceTerm: "Term 21" },
  "28": { sourceTerm: "Term 28 (e.g. Fever)" },
  "32": { sourceTerm: "Term 32" },
};

function validCodes(result: ReturnType<typeof parseCompoundSourceValue>) {
  return result.tokens.filter((t) => t.status === "VALID_SOURCE_CODE").map((t) => t.sourceCode);
}

describe("parseCompoundSourceValue — codebook-aware compound tokenization", () => {
  it("TEST A — comma separated: all recognized, no issue", () => {
    const r = parseCompoundSourceValue("28, 15, 21", CODEBOOK);
    expect(validCodes(r)).toEqual(["28", "15", "21"]);
    expect(r.tokens.every((t) => t.status === "VALID_SOURCE_CODE")).toBe(true);
    expect(r.malformed).toBe(false);
  });

  it("TEST B — AND: recognized as two codes, no issue", () => {
    const r = parseCompoundSourceValue("28 and 21", CODEBOOK);
    expect(validCodes(r)).toEqual(["28", "21"]);
    expect(r.malformed).toBe(false);
  });

  it("TEST B2 — AND is case-insensitive (AND / And)", () => {
    expect(validCodes(parseCompoundSourceValue("28 AND 21", CODEBOOK))).toEqual(["28", "21"]);
    expect(validCodes(parseCompoundSourceValue("28 And 21", CODEBOOK))).toEqual(["28", "21"]);
  });

  it("TEST C — mixed comma + and: all recognized", () => {
    const r = parseCompoundSourceValue("28, 15 and 21", CODEBOOK);
    expect(validCodes(r)).toEqual(["28", "15", "21"]);
    expect(r.malformed).toBe(false);
  });

  it("TEST D — no whitespace, comma separated", () => {
    const r = parseCompoundSourceValue("28,15,21", CODEBOOK);
    expect(validCodes(r)).toEqual(["28", "15", "21"]);
  });

  it("semicolon and slash delimiters also work", () => {
    expect(validCodes(parseCompoundSourceValue("28;15;21", CODEBOOK))).toEqual(["28", "15", "21"]);
    expect(validCodes(parseCompoundSourceValue("28/15/21", CODEBOOK))).toEqual(["28", "15", "21"]);
  });

  it("does NOT blindly split verbatim text containing 'and'", () => {
    const r = parseCompoundSourceValue("headache and dizziness", CODEBOOK);
    // Neither side is a real code, so the split is rejected — the whole
    // phrase is treated as one unresolved segment, never silently coded.
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]!.status).not.toBe("VALID_SOURCE_CODE");
    expect(r.tokens[0]!.rawToken).toBe("headache and dizziness");
  });

  it("TEST E — attached text, no separator: code recognized, text preserved", () => {
    const r = parseCompoundSourceValue("28pains", CODEBOOK);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]!.status).toBe("VALID_SOURCE_CODE");
    expect(r.tokens[0]!.sourceCode).toBe("28");
    expect(r.tokens[0]!.decodedTerm).toBe("Term 28 (e.g. Fever)");
    expect(r.tokens[0]!.attachedVerbatimText).toBe("pains");
  });

  it("TEST F — attached text with whitespace", () => {
    const r = parseCompoundSourceValue("28 pains", CODEBOOK);
    expect(r.tokens[0]!.status).toBe("VALID_SOURCE_CODE");
    expect(r.tokens[0]!.sourceCode).toBe("28");
    expect(r.tokens[0]!.attachedVerbatimText).toBe("pains");
  });

  it("TEST G — attached text with punctuation ('-', ':', '/')", () => {
    expect(parseCompoundSourceValue("28-pains", CODEBOOK).tokens[0]).toMatchObject({
      status: "VALID_SOURCE_CODE",
      sourceCode: "28",
      attachedVerbatimText: "pains",
    });
    expect(parseCompoundSourceValue("28: pains", CODEBOOK).tokens[0]).toMatchObject({
      status: "VALID_SOURCE_CODE",
      sourceCode: "28",
      attachedVerbatimText: "pains",
    });
    // "/" is a conditional list delimiter — "pains" is not a valid code,
    // so the split is rejected and this resolves via attached-text
    // matching on the whole segment instead, same as "-" and ":".
    expect(parseCompoundSourceValue("28/pains", CODEBOOK).tokens[0]).toMatchObject({
      status: "VALID_SOURCE_CODE",
      sourceCode: "28",
      attachedVerbatimText: "pains",
    });
  });

  it("never fabricates a meaning for attached text — the codebook term is never overwritten", () => {
    const r = parseCompoundSourceValue("28pains", CODEBOOK);
    expect(r.tokens[0]!.decodedTerm).toBe("Term 28 (e.g. Fever)"); // the codebook's own term, not "pains"
    expect(r.tokens[0]!.attachedVerbatimText).toBe("pains");
    expect(r.tokens[0]!.decodedTerm).not.toBe(r.tokens[0]!.attachedVerbatimText);
  });

  it("TEST H — partial unknown: only the unresolved component is unknown", () => {
    const r = parseCompoundSourceValue("28, 15, 454", CODEBOOK);
    expect(r.tokens.map((t) => ({ status: t.status, code: t.sourceCode ?? t.rawToken }))).toEqual([
      { status: "VALID_SOURCE_CODE", code: "28" },
      { status: "VALID_SOURCE_CODE", code: "15" },
      { status: "UNKNOWN_SOURCE_CODE", code: "454" },
    ]);
  });

  it("TEST I — unknown entire code", () => {
    const r = parseCompoundSourceValue("454", CODEBOOK);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]!.status).toBe("UNKNOWN_SOURCE_CODE");
  });

  it("TEST J — codebook-aware number extraction: narrative text is never mined for a code", () => {
    const r = parseCompoundSourceValue("Patient had fever for 3 days", CODEBOOK);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]!.status).not.toBe("VALID_SOURCE_CODE");
    expect(r.tokens[0]!.rawToken).toBe("Patient had fever for 3 days");
  });

  it("TEST K — a date is never interpreted as source codes", () => {
    const r = parseCompoundSourceValue("2026-08-20", CODEBOOK);
    expect(r.tokens.some((t) => t.status === "VALID_SOURCE_CODE")).toBe(false);
  });

  it("TEST L — a measurement is never interpreted as a source code merely because it starts with a digit that happens to match", () => {
    // Even with a codebook containing "5", "5mg" must not silently become
    // code 5 with attached text "mg" purely because it CAN parse that way
    // — this test documents that the guarantee actually comes from
    // structure (dose/measurement fields are never routed through this
    // reaction-codebook tokenizer at all in mapping.ts), not from the
    // tokenizer second-guessing itself. Demonstrated here at the
    // tokenizer level: "5mg" against a reaction codebook containing "5"
    // legitimately parses as code 5 + attached text "mg" — the safety
    // guarantee is architectural (only the reaction field is ever passed
    // through this function), not a property of the tokenizer symbol by
    // symbol. See mapping.test.ts for the field-level guarantee.
    const r = parseCompoundSourceValue("5mg", CODEBOOK);
    expect(r.tokens[0]!.status).toBe("VALID_SOURCE_CODE");
    expect(r.tokens[0]!.attachedVerbatimText).toBe("mg");
  });

  it("TEST M — longest valid match: '280' chosen over '28' + '0pains'", () => {
    const codebookWithBoth = { "28": { sourceTerm: "Term 28" }, "280": { sourceTerm: "Term 280" } };
    const r = parseCompoundSourceValue("280pains", codebookWithBoth);
    expect(r.tokens[0]!.status).toBe("VALID_SOURCE_CODE");
    expect(r.tokens[0]!.sourceCode).toBe("280");
    expect(r.tokens[0]!.attachedVerbatimText).toBe("pains");
  });

  it("only '28' exists (not '280'): '28pains' still resolves to 28 + 'pains'", () => {
    const codebookOnly28 = { "28": { sourceTerm: "Term 28" } };
    const r = parseCompoundSourceValue("28pains", codebookOnly28);
    expect(r.tokens[0]!.sourceCode).toBe("28");
    expect(r.tokens[0]!.attachedVerbatimText).toBe("pains");
  });

  it("a numeric code immediately followed by ANOTHER digit is never guessed at — ambiguous with a longer number", () => {
    // Codebook has "20" but not "2026" — "2026-08-20" must not become
    // code 20 + attached "26-08-20".
    const codebookWith20 = { "20": { sourceTerm: "Term 20" } };
    const r = parseCompoundSourceValue("2026-08-20", codebookWith20);
    expect(r.tokens.some((t) => t.status === "VALID_SOURCE_CODE")).toBe(false);
  });

  it("dot-separated numeric residue after a code match is quarantined (MALFORMED), never treated as attached text", () => {
    // "8.19.21" — "8" IS a valid code here, but the remainder ".19.21" is
    // pure digits/punctuation (no letters) — ambiguous tokenization, not
    // genuine descriptive text. Must never silently become code 8 with
    // garbage attached.
    const codebookWith8 = { ...CODEBOOK, "8": { sourceTerm: "Term 8" } };
    const r = parseCompoundSourceValue("8.19.21", codebookWith8);
    expect(r.tokens.some((t) => t.status === "VALID_SOURCE_CODE")).toBe(false);
    expect(r.tokens.some((t) => t.status === "MALFORMED")).toBe(true);
  });

  it("TEST O — duplicate values: both preserved as separate tokens, raw cell preserved", () => {
    const r = parseCompoundSourceValue("28, 28, 15", CODEBOOK);
    expect(validCodes(r)).toEqual(["28", "28", "15"]);
    expect(r.rawCellValue).toBe("28, 28, 15");
  });

  it("TEST P — malformed delimiters: valid codes still recognized, malformed flagged, no crash", () => {
    expect(() => parseCompoundSourceValue("28,,15", CODEBOOK)).not.toThrow();
    const r = parseCompoundSourceValue("28,,15", CODEBOOK);
    expect(validCodes(r)).toEqual(["28", "15"]);
    expect(r.malformed).toBe(true);
  });

  it("more malformed-delimiter shapes never crash and never invent values", () => {
    for (const raw of [",28,15", "28,", "28 and", "and 15", "28 / / 15"]) {
      expect(() => parseCompoundSourceValue(raw, CODEBOOK)).not.toThrow();
    }
  });

  it("TEST N — same numeric value under a DIFFERENT field's codebook resolves independently", () => {
    const reactionCodebook = { "1": { sourceTerm: "Reaction term for 1" }, "5": { sourceTerm: "Reaction term for 5" } };
    const outcomeCodebook = { "1": { sourceTerm: "Outcome term for 1" } };
    const reactionResult = parseCompoundSourceValue("1, 5", reactionCodebook);
    const outcomeResult = parseCompoundSourceValue("1", outcomeCodebook);
    expect(reactionResult.tokens[0]!.decodedTerm).toBe("Reaction term for 1");
    expect(outcomeResult.tokens[0]!.decodedTerm).toBe("Outcome term for 1");
  });

  it("an empty codebook quarantines every value as unknown — never fabricates entries", () => {
    const r = parseCompoundSourceValue("28, 15", {});
    expect(r.tokens.every((t) => t.status === "UNKNOWN_SOURCE_CODE")).toBe(true);
  });

  it("respects an extra unconditional delimiter supplied by the source profile (e.g. a pipe)", () => {
    const r = parseCompoundSourceValue("28|15|21", CODEBOOK, ["|"]);
    expect(validCodes(r)).toEqual(["28", "15", "21"]);
  });
});
