import type { PsurAdministrativeCheck, PsurScreeningResult, PsurSectionStatus } from "@/types/pv";

/**
 * The Administrative Completeness Check's own overall state, and the
 * screening recommendation that follows from it — both DERIVED from the four
 * checks rather than asserted separately.
 *
 * Two contradictions this removes, both observed on a live submission:
 *  1. The Section Coverage row for "Administrative Completeness Check" read
 *     "Not yet assessed" directly beneath four completed YES/NO checks. The
 *     parent said nothing had happened while its children showed results.
 *  2. The administrative check "All mandatory sections present, or absence
 *     justified" returned NO — and the recommendation still read "proceed to
 *     scientific review", contradicting the V4 template's own instruction
 *     that a deficient submission should be returned to the MAH before
 *     detailed assessment begins.
 *
 * The recommendation stays ADVISORY. It is what the checks imply, not a
 * decision: PsurScreeningResult.humanOverride is where the assessor records
 * what actually governs, and nothing here ever writes that.
 */

/** The one check that speaks to whether detailed assessment can usefully
 *  begin at all. A submission missing mandatory sections cannot be
 *  scientifically assessed as submitted, whatever the other three say. */
const BLOCKING_CHECK: PsurAdministrativeCheck["id"] = "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED";

/**
 * Overall state of the administrative check, in the existing
 * PsurSectionStatus vocabulary — no new states invented:
 *   - ASSESSOR_PENDING: no checks have been run at all, or every one of them
 *     came back NOT_ASSESSABLE (a heuristic pass that could not judge
 *     anything is honestly "not yet assessed").
 *   - MISSING: a check answered NO, i.e. a confirmed administrative defect.
 *   - PRESENT_BUT_INCOMPLETE: checks ran and none failed, but some could not
 *     be assessed — screening is genuinely part-done, not clean.
 *   - ADEQUATELY_ADDRESSED: every check answered YES.
 */
export function deriveAdministrativeStatus(
  checks: ReadonlyArray<PsurAdministrativeCheck> | undefined,
): PsurSectionStatus {
  if (!checks || checks.length === 0) return "ASSESSOR_PENDING";
  if (checks.some((c) => c.status === "NO")) return "MISSING";
  if (checks.every((c) => c.status === "NOT_ASSESSABLE")) return "ASSESSOR_PENDING";
  if (checks.some((c) => c.status === "NOT_ASSESSABLE")) return "PRESENT_BUT_INCOMPLETE";
  return "ADEQUATELY_ADDRESSED";
}

/** A one-line summary for the Section Coverage row, so the parent explains
 *  itself in the same terms its children are showing. */
export function describeAdministrativeStatus(
  checks: ReadonlyArray<PsurAdministrativeCheck> | undefined,
): string {
  if (!checks || checks.length === 0) return "Administrative screening has not been run.";
  const failed = checks.filter((c) => c.status === "NO");
  const unknown = checks.filter((c) => c.status === "NOT_ASSESSABLE");
  if (failed.length > 0) {
    return `${failed.length} of ${checks.length} administrative checks failed: ${failed
      .map((c) => c.label)
      .join("; ")}.`;
  }
  if (unknown.length === checks.length) {
    return "None of the administrative checks could be assessed automatically.";
  }
  if (unknown.length > 0) {
    return `${checks.length - unknown.length} of ${checks.length} administrative checks passed; ${unknown.length} could not be assessed automatically.`;
  }
  return `All ${checks.length} administrative checks passed.`;
}

/**
 * The recommendation the four checks imply. A failed mandatory-sections
 * check means the submission should go back to the MAH before scientific
 * review — the V4 template says so directly ("A deficient submission should
 * be returned to the MAH before detailed assessment begins").
 *
 * Deliberately narrow: only the blocking check forces RETURN_TO_MAH_FIRST.
 * A submission that merely arrived late, or whose DLP could not be verified,
 * is still assessable, and turning every imperfection into a rejection would
 * make the recommendation useless.
 */
export function deriveScreeningRecommendation(
  checks: ReadonlyArray<PsurAdministrativeCheck> | undefined,
  aiRecommendation: PsurScreeningResult["recommendation"],
): PsurScreeningResult["recommendation"] {
  if (!checks || checks.length === 0) return aiRecommendation;
  const blocking = checks.find((c) => c.id === BLOCKING_CHECK);
  if (blocking?.status === "NO") return "RETURN_TO_MAH_FIRST";
  return aiRecommendation;
}

/** Why the recommendation says what it says — shown next to it so an
 *  assessor can see it followed from the checks, not from a hidden
 *  judgement, before deciding whether to agree. */
export function explainScreeningRecommendation(
  checks: ReadonlyArray<PsurAdministrativeCheck> | undefined,
  aiRecommendation: PsurScreeningResult["recommendation"],
): string | null {
  const blocking = checks?.find((c) => c.id === BLOCKING_CHECK);
  if (blocking?.status === "NO") {
    return (
      "Mandatory sections are missing without justification, so the submission cannot be " +
      "scientifically assessed as it stands." +
      (aiRecommendation === "PROCEED_TO_SCIENTIFIC_REVIEW"
        ? " This supersedes the model's own suggestion to proceed."
        : "")
    );
  }
  return null;
}
