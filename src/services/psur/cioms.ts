import type { CiomsMatrix, CiomsScoreRow } from "@/types/pv";

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
