import type { CiomsBand, CiomsMatrix, CiomsRubric, CiomsScoreRow } from "@/types/pv";

/**
 * The ICH/CIOMS scoring matrix.
 *
 * Only the arithmetic lives here. The scale's MEANING, the band
 * boundaries and the verdict rule are not in any NAFDAC document this
 * repository holds — see PROVISIONAL_CIOMS_RUBRIC below and the spec's
 * section 6. Summing three integers is the one claim this module is
 * entitled to make without them.
 */

function isScore(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Seriousness + Duration + Incidence, or nothing when any of the three is
 * not a score.
 *
 * Returns undefined rather than a partial sum on purpose: this total feeds
 * a benefit-risk comparison, and a quietly wrong number there is worse
 * than a visibly absent one.
 */
export function rowTotal(row: CiomsScoreRow): number | undefined {
  const values = [row.seriousness, row.duration, row.incidence];
  if (!values.every(isScore)) return undefined;
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Every column's total, or nothing when any single score in the matrix is
 * invalid. All-or-nothing because the memo prints the three totals side by
 * side and compares them; a matrix with one column missing invites a
 * comparison against a blank.
 */
export function matrixTotals(
  m: CiomsMatrix,
): { epidemiology: number; effectiveness: number; adrs: number[] } | undefined {
  const epidemiology = rowTotal(m.epidemiologyOfDisease);
  const effectiveness = rowTotal(m.effectivenessOfProduct);
  if (epidemiology === undefined || effectiveness === undefined) return undefined;
  const adrs: number[] = [];
  for (const adr of m.adrs) {
    const total = rowTotal(adr.scores);
    if (total === undefined) return undefined;
    adrs.push(total);
  }
  return { epidemiology, effectiveness, adrs };
}

/**
 * The band boundaries and verdict rule — PROVISIONAL.
 *
 * Derived from ONE example: the supplied Tramadol-50 memo, which reads
 * "The product has a medium efficacy score of 6" and concludes "Positive
 * Benefit-Risk Balance" because "the critical adverse drug reaction risk
 * profile is less than the epidemiology of the disease itself; a score of
 * 5 & 4 & 5, respectively, vs. a score of 6".
 *
 * NAFDAC has supplied no rubric document. The 0-3 scale's meaning, the
 * band boundaries and the verdict rule are therefore inferred, and one
 * example does not establish any of them. So:
 *
 *   - this object is marked `provisional`
 *   - the memo prints that a provisional rubric was used
 *   - the assessor must CONFIRM both the band label and the verdict every
 *     time; neither is ever auto-accepted
 *
 * Replacing this with a real rubric is a configuration change. Anchoring
 * the one observation we have: total 6 falls in the band labelled
 * "Medium".
 */
export const PROVISIONAL_CIOMS_RUBRIC: CiomsRubric = {
  provenance:
    "PROVISIONAL — inferred from a single example (the Tramadol-50 assessment memo, " +
    "ref NAFDAC/PV/GCIOMS/455/III). No NAFDAC rubric document has been supplied. " +
    "Band boundaries and the verdict rule are unverified.",
  provisional: true,
  bands: [
    { label: "Low", min: 0, max: 3 },
    { label: "Medium", min: 4, max: 6 },
    { label: "High", min: 7 },
  ],
  verdictRule:
    "Where every adverse-reaction column total is lower than the epidemiology-of-disease " +
    "total, the example concluded a Positive Benefit-Risk Balance. Unverified.",
};

/** The band a total falls in, or nothing when no band covers it. */
export function bandFor(
  total: number,
  rubric: CiomsRubric = PROVISIONAL_CIOMS_RUBRIC,
): CiomsBand | undefined {
  return rubric.bands.find((b) => total >= b.min && (b.max === undefined || total <= b.max));
}

/**
 * A verdict the assessor may accept or override — never a decision.
 *
 * Returns nothing when there is no rule to apply or nothing to compare,
 * because a benefit-risk conclusion drawn from an absent comparison would
 * be the single worst output this product could produce.
 */
export function proposeVerdict(
  totals: { epidemiology: number; effectiveness: number; adrs: number[] },
  rubric: CiomsRubric = PROVISIONAL_CIOMS_RUBRIC,
): { verdict: string; reasoning: string } | undefined {
  if (!rubric.verdictRule) return undefined;
  if (totals.adrs.length === 0) return undefined;
  const worst = Math.max(...totals.adrs);
  const positive = worst < totals.epidemiology;
  return {
    verdict: positive ? "Positive Benefit-Risk Balance" : "Requires assessor determination",
    reasoning: positive
      ? `Every adverse-reaction total (${totals.adrs.join(" & ")}) is lower than the ` +
        `epidemiology-of-disease total (${totals.epidemiology}).`
      : `At least one adverse-reaction total (${totals.adrs.join(" & ")}) reaches or exceeds ` +
        `the epidemiology-of-disease total (${totals.epidemiology}); the balance is the ` +
        `assessor's to determine.`,
  };
}
