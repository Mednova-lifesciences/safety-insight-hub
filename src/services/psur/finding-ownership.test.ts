import { describe, expect, it } from "vitest";
import {
  actionOwnerLabel,
  derivedRequiresMahAction,
  isActionOwnerOverridden,
  requiresMahAction,
} from "./finding-ownership";
import type { PsurFinding } from "@/types/pv";

function finding(overrides: Partial<PsurFinding> = {}): PsurFinding {
  return {
    id: "pf-1",
    category: "MISSING_SECTION",
    severity: "HIGH",
    section: "6. Literature",
    description: '"6. Literature" was assessed as missing from this submission.',
    evidence: "No literature review section found in the submitted document.",
    assistGenerated: true,
    humanAssessment: null,
    source: "ai",
    ...overrides,
  };
}

describe("requiresMahAction — the suggestedSource conflation bug", () => {
  it("a missing required section is MAH-facing even when the suggested source is NOT the MAH", () => {
    // The exact shape that used to vanish from the Compliance Directive:
    // only the MAH can supply a section they did not write, but the
    // helpful "go read the literature" pointer made it look assessor-owned.
    const f = finding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      suggestedSource: {
        type: "PUBLISHED_LITERATURE",
        note: "Screen published safety literature for this active substance.",
      },
    });
    expect(requiresMahAction(f)).toBe(true);
    expect(actionOwnerLabel(f)).toBe("Needs MAH response");
  });

  it.each([
    "MISSING_REQUIRED_SECTION",
    "MISSING_INFORMATION",
    "INCOMPLETE_INFORMATION",
    "INCONSISTENCY",
    "UNCLEAR_AMBIGUOUS_INFORMATION",
    "UNSUPPORTED_CLAIM",
  ] as const)("%s is MAH-facing regardless of suggested source", (deficiencyType) => {
    expect(
      requiresMahAction(
        finding({
          category: "CONSISTENCY",
          deficiencyType,
          suggestedSource: { type: "VIGIFLOW_NIGERIA", note: "Check VigiFlow." },
        }),
      ),
    ).toBe(true);
  });

  it("evidence the assessor can genuinely obtain stays assessor-owned", () => {
    const f = finding({
      category: "NUMERICAL",
      deficiencyType: "DATA_DISCREPANCY",
      suggestedSource: { type: "VIGIFLOW_NIGERIA", note: "Compare against VigiFlow." },
    });
    expect(requiresMahAction(f)).toBe(false);
    expect(actionOwnerLabel(f)).toBe("Assessor can resolve internally");
  });

  it("an explicit REQUEST_FROM_MAH still routes an otherwise-assessor type to the MAH", () => {
    expect(
      requiresMahAction(
        finding({
          category: "NUMERICAL",
          deficiencyType: "DATA_DISCREPANCY",
          suggestedSource: { type: "REQUEST_FROM_MAH", note: "Ask the MAH to reconcile." },
        }),
      ),
    ).toBe(true);
  });

  it("an explicit deficiencyType overrides the coarse legacy category", () => {
    // Without this precedence the advisory emitted when AI review is
    // unavailable would be pushed to the MAH as if it were a real
    // deficiency in their submission.
    const f = finding({
      category: "MISSING_SECTION",
      deficiencyType: "INADEQUATE_EVIDENCE",
      suggestedSource: { type: "OTHER", note: "Assess manually against the V4 template." },
    });
    expect(requiresMahAction(f)).toBe(false);
  });

  it("falls back to the category for findings stored before deficiencyType existed", () => {
    const f = finding({ suggestedSource: undefined });
    delete (f as { deficiencyType?: unknown }).deficiencyType;
    expect(requiresMahAction(f)).toBe(true);
  });

  it("a finding with no source and no MAH-only type is assessor-owned", () => {
    expect(
      requiresMahAction(
        finding({
          category: "SIGNAL",
          deficiencyType: "INADEQUATE_EVIDENCE",
          suggestedSource: undefined,
        }),
      ),
    ).toBe(false);
  });
});

describe("requiresMahAction — the assessor's override outranks the derivation", () => {
  const override = (owner: "MAH" | "ASSESSOR") => ({
    owner,
    by: "A. Okafor",
    at: "2026-09-12T09:00:00Z",
    rationale: "Recorded by the assessor.",
  });

  it("an assessor can pull a MAH-only deficiency back to assessor-internal", () => {
    const f = finding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      actionOwnerOverride: override("ASSESSOR"),
    });
    expect(requiresMahAction(f)).toBe(false);
    expect(actionOwnerLabel(f)).toBe("Assessor can resolve internally");
    expect(derivedRequiresMahAction(f)).toBe(true);
    expect(isActionOwnerOverridden(f)).toBe(true);
  });

  it("an assessor can push an assessor-resolvable finding to the MAH", () => {
    const f = finding({
      category: "NUMERICAL",
      deficiencyType: "DATA_DISCREPANCY",
      suggestedSource: { type: "VIGIFLOW_NIGERIA", note: "Check VigiFlow." },
      actionOwnerOverride: override("MAH"),
    });
    expect(requiresMahAction(f)).toBe(true);
    expect(derivedRequiresMahAction(f)).toBe(false);
    expect(isActionOwnerOverridden(f)).toBe(true);
  });

  it("an override that agrees with the derivation is not flagged as a change", () => {
    const f = finding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      actionOwnerOverride: override("MAH"),
    });
    expect(requiresMahAction(f)).toBe(true);
    expect(isActionOwnerOverridden(f)).toBe(false);
  });

  it("derivedRequiresMahAction never mutates the finding it inspects", () => {
    const f = finding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      actionOwnerOverride: override("ASSESSOR"),
    });
    derivedRequiresMahAction(f);
    expect(f.actionOwnerOverride?.owner).toBe("ASSESSOR");
    expect(requiresMahAction(f)).toBe(false);
  });
});
