import { describe, expect, it } from "vitest";
import type { LineListIssue } from "@/types/pv";
import { routeFinding } from "./linelist-fix-routing";

const ctx = {
  keptRows: new Set([1, 2]),
  changeLog: [],
  recoveryCells: new Set<string>(),
  mapping: {
    ID: "case_id",
    Onset: "onset_interval",
    Vacc: "vaccination_date",
    Sex: "sex",
  } as Record<string, string>,
};
const f = (over: Partial<LineListIssue>): LineListIssue => ({
  row: 1,
  column: "Onset",
  severity: "LOW",
  code: "X",
  message: "m",
  value: "v",
  source: "rule",
  ...over,
});

describe("routing is decided by schema, never by the wording of a code", () => {
  it("a rule's suggestion is applied by rule", () =>
    expect(routeFinding(f({ suggestion: { value: "w", rule: "r", version: "1" } }), ctx)).toBe(
      "deterministic",
    ));
  it("AI findings of the same kind route the same whatever the model called them", () => {
    for (const code of [
      "ONSET_UNIT_TYPO",
      "INTERVAL_UNIT_TYPO",
      "UNIT_SPELLING",
      "TYPO_IN_INTERVAL",
    ])
      expect(
        routeFinding(
          f({
            source: "ai",
            code,
            fixable: false,
            confidence: "HIGH",
            issueType: "FIELD_FORMAT_INVALID",
          }),
          ctx,
        ),
      ).toBe("sent_to_ai");
  });
  it("an AI finding with no recognised category is reported, not silently skipped", () =>
    expect(routeFinding(f({ source: "ai", code: "WHATEVER", fixable: false }), ctx)).toBe(
      "unrecognised_category",
    ));
  it("a low-confidence AI finding goes to a person", () =>
    expect(
      routeFinding(
        f({ source: "ai", fixable: true, confidence: "LOW", issueType: "FIELD_FORMAT_INVALID" }),
        ctx,
      ),
    ).toBe("low_confidence_review"));
  it("non-fixable kinds stay with a person", () => {
    expect(
      routeFinding(
        f({ source: "ai", fixable: false, issueType: "CROSS_FIELD_CONTRADICTION" }),
        ctx,
      ),
    ).toBe("not_correctable");
    expect(
      routeFinding(f({ code: "OUTCOME_SERIOUSNESS_CONTRADICTION", fixable: false }), ctx),
    ).toBe("not_correctable");
    expect(routeFinding(f({ code: "MISSING_OUTCOME", value: null }), ctx)).toBe("not_correctable");
  });
  it("identifiers, held cells, dropped cases and file-level findings are never offered", () => {
    expect(
      routeFinding(
        f({ column: "ID", fixable: true, suggestion: { value: "x", rule: "r", version: "1" } }),
        ctx,
      ),
    ).toBe("protected_identifier");
    expect(routeFinding(f({ row: 3, fixable: true }), ctx)).toBe("case_not_kept");
    expect(routeFinding(f({ row: 0 }), ctx)).toBe("file_level");
    const held = {
      ...ctx,
      changeLog: [
        {
          id: "c",
          row: 1,
          column: "Onset",
          oldValue: "a",
          newValue: "b",
          reason: "r",
          source: "ai" as const,
          appliedAt: "t",
          events: [{ kind: "undone" as const, at: "t", by: "p" }],
        },
      ],
    };
    expect(routeFinding(f({ fixable: true }), held)).toBe("held_by_person");
  });
  it("an AI finding never takes the deterministic route, even with a suggestion", () =>
    expect(
      routeFinding(
        f({
          source: "ai",
          fixable: true,
          confidence: "HIGH",
          suggestion: { value: "x", rule: "r", version: "1" },
        }),
        ctx,
      ),
    ).toBe("sent_to_ai"));
});
