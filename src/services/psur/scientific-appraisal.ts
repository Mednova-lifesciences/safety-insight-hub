/**
 * The critical scientific appraisal, on the client side: mapping the wire
 * shape into the stored document, and merging its findings with the
 * completeness review's. Pure functions — see scientific-appraisal.test.ts.
 */
import type { AiPsurAppraisalResponse } from "@/services/api/ai";
import type {
  PsurAppraisalVerdict,
  PsurFinding,
  PsurScientificAppraisal,
  PsurSectionAppraisal,
  PsurSectionStatus,
  PsurV4SectionId,
} from "@/types/pv";

const STOP_WORDS = new Set(
  (
    "a an the of and or to in on for with by is are was were be been being that this these those " +
    "it its as at from but not no only also which who whom their there than then so such into " +
    "over under per via any all each both more most other some can cannot may might will would " +
    "should could do does did have has had"
  ).split(" "),
);

/** Content words of a finding's description, crudely stemmed, for comparing
 *  two findings that say the same thing in different words. */
function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]+|\d[\d,.]*/g) ?? []) {
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw.length > 5 ? raw.replace(/(ing|ed|es|s|ly)$/, "") : raw);
  }
  return out;
}

/** Share of the SHORTER finding's content words that the other also uses,
 *  and how many words are shared. Measured on real pairs from a live review
 *  of the test PSUR: genuine duplicates shared 67-71% of their words,
 *  different issues in the same section at most 25%. */
export function descriptionOverlap(a: string, b: string): { share: number; shared: number } {
  const A = contentWords(a);
  const B = contentWords(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return { share: shared / Math.max(1, Math.min(A.size, B.size)), shared };
}

const DUPLICATE_SHARE = 0.5;
const DUPLICATE_MIN_SHARED = 6;

const MIS_TYPES = new Set(["MISCLASSIFICATION", "MISINTERPRETATION"]);

/**
 * Both AI passes apply the same critical-appraisal rules, so they can raise
 * the same problem — the assessor then sees it twice in one section and has
 * to decide it twice. The appraisal read the whole document with room to
 * reason, so its version is the one kept. A completeness finding is dropped
 * only when it restates an appraisal finding of the SAME section, i.e. when
 *   - both are a misclassification/misinterpretation of that section, or
 *   - their descriptions say substantially the same thing (see
 *     descriptionOverlap).
 * A finding with no section, or one that matches nothing, is always kept.
 */
export function mergeAppraisalFindings(
  completeness: PsurFinding[],
  appraisal: PsurFinding[],
): PsurFinding[] {
  const restatesAppraisal = (f: PsurFinding): boolean => {
    if (!f.v4Section) return false;
    return appraisal.some((a) => {
      if (a.v4Section !== f.v4Section) return false;
      if (
        f.deficiencyType &&
        MIS_TYPES.has(f.deficiencyType) &&
        a.deficiencyType === f.deficiencyType
      ) {
        return true;
      }
      const { share, shared } = descriptionOverlap(f.description, a.description);
      return share >= DUPLICATE_SHARE && shared >= DUPLICATE_MIN_SHARED;
    });
  };
  return [...completeness.filter((f) => !restatesAppraisal(f)), ...appraisal];
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
      returned: s.returned ?? true,
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

/**
 * What to SHOW for one of the four questions. The AI's "can't assess"
 * verdict means different things, and reading them all as "failed" is
 * wrong — and so is reading a genuine failure as "the MAH left it out":
 *
 *  - NOT_IN_SUBMISSION: the section's coverage says the MAH did not include
 *    it. There was nothing to judge. (The completeness review already
 *    raises the missing section as a finding.)
 *  - NOT_RETURNED: the AI returned nothing for this section. A real failure
 *    — the assessor must appraise it themselves.
 *  - INSUFFICIENT_DETAIL: the section is there but too thin to judge.
 *
 * A real verdict (sound / concern) is always shown as given, even for a
 * section that is otherwise missing — e.g. "uncertainties" can be a concern
 * because of what the MAH's OTHER data shows.
 */
export type AppraisalCellKind =
  | "SOUND"
  | "CONCERN"
  | "NOT_IN_SUBMISSION"
  | "NOT_RETURNED"
  | "INSUFFICIENT_DETAIL";

export function appraisalCellKind(
  verdict: PsurAppraisalVerdict,
  section: Pick<PsurSectionAppraisal, "returned">,
  coverageStatus: PsurSectionStatus | undefined,
): AppraisalCellKind {
  if (verdict === "SOUND") return "SOUND";
  if (verdict === "CONCERN") return "CONCERN";
  if (section.returned === false) return "NOT_RETURNED";
  if (coverageStatus === "MISSING") return "NOT_IN_SUBMISSION";
  return "INSUFFICIENT_DETAIL";
}

/** The kind that all four questions share, if they all share a non-verdict
 *  kind (nothing to appraise / not returned / too thin) — else null. */
export function wholeSectionKind(
  s: PsurSectionAppraisal,
  coverageStatus: PsurSectionStatus | undefined,
): Exclude<AppraisalCellKind, "SOUND" | "CONCERN"> | null {
  const kinds = [s.correct, s.classified, s.meaningful, s.interpreted].map((q) =>
    appraisalCellKind(q.verdict, s, coverageStatus),
  );
  const first = kinds[0];
  if (first === undefined || first === "SOUND" || first === "CONCERN") return null;
  return kinds.every((k) => k === first) ? first : null;
}
