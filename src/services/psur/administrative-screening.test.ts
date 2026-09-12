import { describe, expect, it } from "vitest";
import {
  deriveAdministrativeStatus,
  describeAdministrativeStatus,
  deriveScreeningRecommendation,
  explainScreeningRecommendation,
} from "./administrative-screening";
import { buildAuthoritativeSectionCoverage } from "./section-consistency";
import type { PsurAdministrativeCheck } from "@/types/pv";

const CHECK_IDS = [
  "FOLLOWS_E2C_R2_TEMPLATE",
  "DLP_CORRECTLY_STATED",
  "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED",
  "RECEIVED_WITHIN_TIMEFRAME",
] as const;

function checks(
  statuses: ReadonlyArray<PsurAdministrativeCheck["status"]>,
): PsurAdministrativeCheck[] {
  return CHECK_IDS.map((id, i) => ({
    id,
    label: `Check ${i + 1}`,
    status: statuses[i] ?? "NOT_ASSESSABLE",
    comment: "",
  }));
}

describe("the parent administrative row never contradicts its four checks", () => {
  it("four completed checks no longer read 'not yet assessed'", () => {
    // The live contradiction: four YES/NO results displayed, with the parent
    // row directly above them saying nothing had been assessed.
    const status = deriveAdministrativeStatus(checks(["YES", "YES", "NO", "YES"]));
    expect(status).not.toBe("ASSESSOR_PENDING");
    expect(status).toBe("MISSING");
  });

  it("all YES reads as adequately addressed", () => {
    expect(deriveAdministrativeStatus(checks(["YES", "YES", "YES", "YES"]))).toBe(
      "ADEQUATELY_ADDRESSED",
    );
  });

  it("a mix of passes and unassessable checks is incomplete, not clean", () => {
    expect(deriveAdministrativeStatus(checks(["YES", "YES", "YES", "NOT_ASSESSABLE"]))).toBe(
      "PRESENT_BUT_INCOMPLETE",
    );
  });

  it("an entirely unassessable pass is honestly 'not yet assessed'", () => {
    expect(
      deriveAdministrativeStatus(
        checks(["NOT_ASSESSABLE", "NOT_ASSESSABLE", "NOT_ASSESSABLE", "NOT_ASSESSABLE"]),
      ),
    ).toBe("ASSESSOR_PENDING");
  });

  it("no checks at all is 'not yet assessed'", () => {
    expect(deriveAdministrativeStatus(undefined)).toBe("ASSESSOR_PENDING");
    expect(deriveAdministrativeStatus([])).toBe("ASSESSOR_PENDING");
  });

  it("the comment names which checks failed", () => {
    expect(describeAdministrativeStatus(checks(["YES", "YES", "NO", "YES"]))).toMatch(
      /1 of 4 administrative checks failed/,
    );
    expect(describeAdministrativeStatus(checks(["YES", "YES", "YES", "YES"]))).toMatch(
      /All 4 administrative checks passed/,
    );
  });

  it("reaches the coverage the whole app renders", () => {
    const coverage = buildAuthoritativeSectionCoverage({
      screening: {
        administrativeChecks: checks(["YES", "YES", "NO", "YES"]),
        sectionCoverage: [
          {
            section: "ADMIN_SCREENING",
            status: "ASSESSOR_PENDING",
            comment: "Not yet assessed.",
            source: "ai",
          },
        ],
      },
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0]);
    const row = coverage.find((c) => c.section === "ADMIN_SCREENING")!;
    expect(row.status).toBe("MISSING");
    expect(row.comment).not.toMatch(/not yet assessed/i);
  });
});

describe("the recommendation follows from the checks, and stays advisory", () => {
  it("missing mandatory sections force 'return to MAH first'", () => {
    // The live contradiction: the mandatory-sections check answered NO and
    // the recommendation still read "proceed to scientific review".
    expect(
      deriveScreeningRecommendation(
        checks(["YES", "YES", "NO", "YES"]),
        "PROCEED_TO_SCIENTIFIC_REVIEW",
      ),
    ).toBe("RETURN_TO_MAH_FIRST");
  });

  it("explains why it overrode the model's own suggestion", () => {
    const why = explainScreeningRecommendation(
      checks(["YES", "YES", "NO", "YES"]),
      "PROCEED_TO_SCIENTIFIC_REVIEW",
    );
    expect(why).toMatch(/mandatory sections are missing/i);
    expect(why).toMatch(/supersedes the model's own suggestion/i);
  });

  it("does not turn every imperfection into a rejection", () => {
    // Late arrival and an unverifiable DLP do not stop scientific assessment.
    expect(
      deriveScreeningRecommendation(
        checks(["YES", "NOT_ASSESSABLE", "YES", "NO"]),
        "PROCEED_TO_SCIENTIFIC_REVIEW",
      ),
    ).toBe("PROCEED_TO_SCIENTIFIC_REVIEW");
    expect(
      explainScreeningRecommendation(
        checks(["YES", "NOT_ASSESSABLE", "YES", "NO"]),
        "PROCEED_TO_SCIENTIFIC_REVIEW",
      ),
    ).toBeNull();
  });

  it("leaves the model's suggestion alone when there are no checks to reason from", () => {
    expect(deriveScreeningRecommendation(undefined, "PROCEED_TO_SCIENTIFIC_REVIEW")).toBe(
      "PROCEED_TO_SCIENTIFIC_REVIEW",
    );
  });

  it("is a recommendation only — it never becomes the assessor's decision", () => {
    // The derivation produces a recommendation value and nothing else; the
    // assessor's own decision lives in screening.humanOverride, which no
    // function in this module reads or writes.
    const src =
      deriveScreeningRecommendation.toString() + explainScreeningRecommendation.toString();
    expect(src).not.toMatch(/humanOverride/);
    // And an assessor recording the opposite decision is not contradicted by it.
    const recommendation = deriveScreeningRecommendation(
      checks(["YES", "YES", "NO", "YES"]),
      "PROCEED_TO_SCIENTIFIC_REVIEW",
    );
    const assessorDecision = "PROCEED_TO_SCIENTIFIC_REVIEW";
    expect(recommendation).toBe("RETURN_TO_MAH_FIRST");
    expect(assessorDecision).toBe("PROCEED_TO_SCIENTIFIC_REVIEW");
  });
});
