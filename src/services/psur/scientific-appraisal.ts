/**
 * The critical scientific appraisal, on the client side: mapping the wire
 * shape into the stored document, and merging its findings with the
 * completeness review's. Pure functions — see scientific-appraisal.test.ts.
 */
import type { AiPsurAppraisalResponse } from "@/services/api/ai";
import type { PsurFinding, PsurScientificAppraisal, PsurV4SectionId } from "@/types/pv";

/**
 * Both AI passes now apply the same critical-appraisal rules, so the
 * completeness pass can raise the same misclassification the appraisal
 * raises. The appraisal read the whole document with room to reason, so
 * where both flag a MISCLASSIFICATION/MISINTERPRETATION in the same section,
 * the appraisal's version is kept and the completeness one dropped.
 */
export function mergeAppraisalFindings(
  completeness: PsurFinding[],
  appraisal: PsurFinding[],
): PsurFinding[] {
  const appraisalKeys = new Set(
    appraisal
      .filter(
        (f) => f.deficiencyType === "MISCLASSIFICATION" || f.deficiencyType === "MISINTERPRETATION",
      )
      .map((f) => `${f.v4Section ?? ""}|${f.deficiencyType}`),
  );
  const kept = completeness.filter(
    (f) =>
      !(
        (f.deficiencyType === "MISCLASSIFICATION" || f.deficiencyType === "MISINTERPRETATION") &&
        appraisalKeys.has(`${f.v4Section ?? ""}|${f.deficiencyType}`)
      ),
  );
  return [...kept, ...appraisal];
}

/** AI appraisal (wire shape) -> domain PsurScientificAppraisal. */
export function mapAiScientificAppraisal(
  r: AiPsurAppraisalResponse,
  now: string = new Date().toISOString(),
): PsurScientificAppraisal {
  if (!r.ai_used) {
    return {
      generatedAt: now,
      sections: [],
      unreadPages: [],
      error: r.error ?? "The scientific appraisal was unavailable.",
    };
  }
  const ctx = r.product_context;
  return {
    generatedAt: now,
    model: r.model ?? undefined,
    sections: r.section_appraisals.map((s) => ({
      v4Section: s.v4_section as PsurV4SectionId,
      correct: s.correct,
      classified: s.classified,
      meaningful: s.meaningful,
      interpreted: s.interpreted,
      summary: s.summary,
    })),
    productContext: ctx
      ? {
          product: ctx.product ?? undefined,
          activeSubstance: ctx.active_substance ?? undefined,
          therapeuticClass: ctx.therapeutic_class ?? undefined,
          approvedIndications: ctx.approved_indications ?? [],
        }
      : undefined,
    unreadPages: r.unread_pages ?? [],
  };
}

