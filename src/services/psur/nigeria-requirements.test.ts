import { describe, expect, it } from "vitest";
import {
  buildNigerianRequirementFindings,
  deriveAggregateSafetySectionStatus,
  deriveExposureSectionStatus,
  HAS_LIVE_VIGIFLOW_INTEGRATION,
  nigerianExposureRequired,
} from "./nigeria-requirements";
import { buildAuthoritativeSectionCoverage } from "./section-consistency";
import type { PsurNigerianContext } from "@/types/pv";

function ctx(overrides: Partial<PsurNigerianContext> = {}): PsurNigerianContext {
  return {
    exposureRequired: true,
    nigerianExposureProvided: false,
    nigerianCaseCountProvided: false,
    vigiflowReconciliationProvided: false,
    ...overrides,
  };
}

describe("Section 5 — Nigerian exposure denominator", () => {
  it("global exposure with no Nigerian denominator is incomplete, not adequate", () => {
    // The measured live failure: a submission stating 412,000 vials
    // worldwide and nothing Nigerian came back "Adequately addressed".
    expect(deriveExposureSectionStatus(ctx(), "ADEQUATELY_ADDRESSED")).toBe(
      "PRESENT_BUT_INCOMPLETE",
    );
  });

  it("a stated Nigerian denominator is not flagged", () => {
    expect(
      deriveExposureSectionStatus(ctx({ nigerianExposureProvided: true }), "ADEQUATELY_ADDRESSED"),
    ).toBeNull();
  });

  it("never upgrades a section the assessment already called MISSING", () => {
    expect(deriveExposureSectionStatus(ctx(), "MISSING")).toBeNull();
    expect(deriveExposureSectionStatus(ctx(), "NOT_APPLICABLE")).toBeNull();
  });

  it("does not bind where Section 5 is not the document's job", () => {
    expect(nigerianExposureRequired("SPREADSHEET")).toBe(false);
    expect(nigerianExposureRequired("PDF")).toBe(true);
    expect(
      deriveExposureSectionStatus(ctx({ exposureRequired: false }), "ADEQUATELY_ADDRESSED"),
    ).toBeNull();
  });

  it("says nothing at all when the facts were never collected", () => {
    expect(deriveExposureSectionStatus(undefined, "ADEQUATELY_ADDRESSED")).toBeNull();
  });
});

describe("Section 7 — Nigerian case count and reconciliation", () => {
  it("worldwide totals with no Nigerian case count are incomplete", () => {
    expect(
      deriveAggregateSafetySectionStatus(
        ctx({ vigiflowReconciliationProvided: true }),
        "ADEQUATELY_ADDRESSED",
      ),
    ).toBe("PRESENT_BUT_INCOMPLETE");
  });

  it("a Nigerian count without reconciliation is still incomplete", () => {
    expect(
      deriveAggregateSafetySectionStatus(
        ctx({ nigerianCaseCountProvided: true }),
        "ADEQUATELY_ADDRESSED",
      ),
    ).toBe("PRESENT_BUT_INCOMPLETE");
  });

  it("both present is not flagged", () => {
    expect(
      deriveAggregateSafetySectionStatus(
        ctx({ nigerianCaseCountProvided: true, vigiflowReconciliationProvided: true }),
        "ADEQUATELY_ADDRESSED",
      ),
    ).toBeNull();
  });
});

describe("findings generated for the missing Nigerian requirements", () => {
  it("explains what is missing and what the MAH must supply, without inventing figures", () => {
    const out = buildNigerianRequirementFindings(ctx(), []);
    expect(out).toHaveLength(3);

    const exposure = out.find((f) => f.v4Section === "S5_EXPOSURE_ACTIONS")!;
    expect(exposure.description).toContain("Nigerian exposure denominator");
    expect(exposure.description).toMatch(/worldwide exposure does not substitute/i);
    expect(exposure.suggestedSource?.type).toBe("REQUEST_FROM_MAH");
    expect(exposure.deficiencyType).toBe("INSUFFICIENT_LOCAL_EVIDENCE");
    // No fabricated denominator anywhere in the finding.
    expect(JSON.stringify(exposure)).not.toMatch(/\b\d{3,}\s*(patient-years|vials|packs)\b/i);
  });

  it("never claims this system queried VigiFlow", () => {
    const all = JSON.stringify(buildNigerianRequirementFindings(ctx(), []));
    expect(HAS_LIVE_VIGIFLOW_INTEGRATION).toBe(false);
    expect(all).toMatch(/has not queried VigiFlow/i);
    // The shapes that would constitute a fabricated lookup.
    expect(all).not.toMatch(/VigiFlow (shows|holds|reports|returned|contains)/i);
    expect(all).not.toMatch(/according to VigiFlow/i);
  });

  it("makes clear the assessor verifies while the MAH supplies", () => {
    const out = buildNigerianRequirementFindings(ctx(), []);
    const recon = out.find((f) => f.deficiencyType === "DATA_DISCREPANCY")!;
    expect(recon.suggestedSource?.type).toBe("VIGIFLOW_NIGERIA");
    expect(recon.suggestedSource?.note).toMatch(/retrieve the nigerian icsr count/i);
    expect(recon.suggestedSource?.note).toMatch(/ask the MAH to account for any discrepancy/i);

    const count = out.find((f) => f.v4Section === "S7_AGGREGATE_SAFETY_DATA" && f !== recon)!;
    expect(count.suggestedSource?.type).toBe("REQUEST_FROM_MAH");
  });

  it("generates nothing when every Nigerian requirement is satisfied", () => {
    expect(
      buildNigerianRequirementFindings(
        ctx({
          nigerianExposureProvided: true,
          nigerianCaseCountProvided: true,
          vigiflowReconciliationProvided: true,
        }),
        [],
      ),
    ).toHaveLength(0);
  });

  it("is idempotent — re-review does not duplicate them", () => {
    const first = buildNigerianRequirementFindings(ctx(), []);
    expect(buildNigerianRequirementFindings(ctx(), first)).toHaveLength(0);
  });
});

describe("the derived statuses reach the authoritative coverage", () => {
  it("S5 and S7 read as incomplete on the coverage the whole app renders", () => {
    const coverage = buildAuthoritativeSectionCoverage({
      screening: {
        sectionCoverage: [
          {
            section: "S5_EXPOSURE_ACTIONS",
            status: "ADEQUATELY_ADDRESSED",
            comment: "Exposure is addressed.",
            source: "ai",
          },
          {
            section: "S7_AGGREGATE_SAFETY_DATA",
            status: "ADEQUATELY_ADDRESSED",
            comment: "Aggregate data is addressed.",
            source: "ai",
          },
        ],
      },
      sourceType: "PDF",
      nigerianContext: ctx(),
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0]);

    expect(coverage.find((c) => c.section === "S5_EXPOSURE_ACTIONS")?.status).toBe(
      "PRESENT_BUT_INCOMPLETE",
    );
    expect(coverage.find((c) => c.section === "S7_AGGREGATE_SAFETY_DATA")?.status).toBe(
      "PRESENT_BUT_INCOMPLETE",
    );
    expect(coverage.find((c) => c.section === "S7_AGGREGATE_SAFETY_DATA")?.comment).toMatch(
      /Nigerian case count and reconciliation/i,
    );
  });
});
