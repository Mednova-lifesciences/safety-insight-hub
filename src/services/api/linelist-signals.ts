import { productKey } from "./linelist-cross-duplicates";
import { reactionTermKey } from "@/services/e2b-r3/term-mappings";

/**
 * Disproportionality screen over the organisation's validated line lists —
 * the administrator-side statistical screen. Rules and statistics only: it
 * lists product/reaction pairs reported more often together than the rest
 * of the pool would predict, and a person decides what each one means. A
 * candidate is a statistical screen, never a confirmed signal.
 *
 * Counting is per report (one line-list case): a = reports of this product
 * with this reaction, b = this product with other reactions, c = other
 * products with this reaction, d = neither. A case listing two reactions
 * counts once for each, but never twice for the same pair.
 *
 *   PRR = [a/(a+b)] / [c/(c+d)],  95% CI exp(ln PRR ± 1.96·√(1/a − 1/(a+b) + 1/c − 1/(c+d)))
 *   ROR = (a·d)/(b·c),            95% CI exp(ln ROR ± 1.96·√(1/a + 1/b + 1/c + 1/d))
 *   χ² with Yates' correction.
 *
 * When a cell is zero the ratio cannot be estimated as is; 0.5 is added to
 * every cell (Haldane–Anscombe) and the result is marked `corrected`.
 *
 * Candidate rule (the existing thresholds, Evans et al. 2001): N ≥ 3,
 * PRR ≥ 2 and χ² ≥ 4.
 */

export const MIN_CASES = 3;
export const MIN_PRR = 2;
export const MIN_CHI_SQUARE = 4;

/**
 * Below this many reports the pool is too small for disproportionality to
 * be trusted: Uppsala Monitoring Centre researchers recommend at least 500
 * reports for a country-specific database (Drug Safety 2020;43(5):479–487,
 * "Disproportionality Analysis for Pharmacovigilance Signal Detection in
 * Small Databases or Subsets: Recommendations for Limiting False-Positive
 * Associations", doi:10.1007/s40264-020-00911-w).
 */
export const UMC_MIN_REPORTS = 500;
export const UMC_SOURCE = {
  label:
    "Uppsala Monitoring Centre — Drug Safety 2020;43(5):479–487 (recommends ≥ 500 reports for a country database)",
  url: "https://doi.org/10.1007/s40264-020-00911-w",
};

export interface ScreenCase {
  jobId: string;
  filename: string;
  /** 1-based data row. */
  row: number;
  caseId?: string | undefined;
  product?: string | undefined;
  /** The case's reactions, already split by the file's own separators. */
  reactions: string[];
}

/** A decided reaction term: the organisation's MedDRA coding of a word. */
export interface ReactionCoding {
  termKey: string;
  code: string;
  label: string;
}

export interface CaseRef {
  jobId: string;
  filename: string;
  row: number;
  caseId?: string | undefined;
}

export interface Estimate {
  value: number;
  lower: number;
  upper: number;
}

export interface ScreenPair {
  /** Stable identity of the pair, for matching a stored review. */
  key: string;
  product: string;
  reaction: string;
  /** "MedDRA" when the organisation coded the term, else the verbatim word. */
  reactionSource: "MEDDRA" | "VERBATIM";
  meddraCode?: string | undefined;
  a: number;
  b: number;
  c: number;
  d: number;
  prr: Estimate;
  ror: Estimate;
  chiSquare: number;
  /** 0.5 was added to every cell because one of them was zero. */
  corrected: boolean;
  candidate: boolean;
  cases: CaseRef[];
}

export interface ScreenResult {
  /** Reports (cases) in the pool after dropped, held and duplicate cases are left out. */
  totalReports: number;
  /** Cases left out because they name no product or no reaction. */
  unusable: number;
  files: number;
  smallPool: boolean;
  candidates: ScreenPair[];
  /** Every pair seen, candidate or not — for "why is X not a candidate". */
  pairs: ScreenPair[];
}

const Z = 1.959964;

function interval(estimate: number, se: number): Estimate {
  const ln = Math.log(estimate);
  return { value: estimate, lower: Math.exp(ln - Z * se), upper: Math.exp(ln + Z * se) };
}

/** PRR, ROR (with 95% CIs) and Yates χ² for one 2×2 table. Exported for tests. */
export function disproportionality(a: number, b: number, c: number, d: number) {
  const corrected = a === 0 || b === 0 || c === 0 || d === 0;
  const [A, B, C, D] = corrected ? [a + 0.5, b + 0.5, c + 0.5, d + 0.5] : [a, b, c, d];
  const prr = A / (A + B) / (C / (C + D));
  const prrSe = Math.sqrt(1 / A - 1 / (A + B) + 1 / C - 1 / (C + D));
  const ror = (A * D) / (B * C);
  const rorSe = Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D);
  const n = a + b + c + d;
  const denominator = (a + b) * (c + d) * (a + c) * (b + d);
  const chiSquare =
    denominator > 0 ? (n * Math.max(0, Math.abs(a * d - b * c) - n / 2) ** 2) / denominator : 0;
  return { prr: interval(prr, prrSe), ror: interval(ror, rorSe), chiSquare, corrected };
}

/** "fever " → "Fever": the verbatim word, tidied for display and grouping. */
function verbatim(term: string): string {
  const t = term.trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
}

interface ReactionInfo {
  label: string;
  source: "MEDDRA" | "VERBATIM";
  code?: string;
}

export function screenLineLists(cases: ScreenCase[], codings: ReactionCoding[] = []): ScreenResult {
  const coded = new Map(codings.map((m) => [m.termKey, m]));

  interface Report {
    ref: CaseRef;
    product: string;
    reactions: Map<string, ReactionInfo>;
  }
  const reports: Report[] = [];
  const productLabels = new Map<string, Map<string, number>>();
  let unusable = 0;

  for (const c of cases) {
    const pKey = productKey(c.product);
    const reactions = new Map<string, ReactionInfo>();
    for (const raw of c.reactions) {
      const word = raw.trim();
      if (!word) continue;
      const coding = coded.get(reactionTermKey(word));
      if (coding) {
        reactions.set(`meddra:${coding.code}`, {
          label: coding.label,
          source: "MEDDRA",
          code: coding.code,
        });
      } else {
        const label = verbatim(word);
        reactions.set(`text:${label.toLowerCase()}`, { label, source: "VERBATIM" });
      }
    }
    if (!pKey || reactions.size === 0) {
      unusable++;
      continue;
    }
    const labels = productLabels.get(pKey) ?? new Map<string, number>();
    const shown = (c.product ?? "").trim();
    labels.set(shown, (labels.get(shown) ?? 0) + 1);
    productLabels.set(pKey, labels);
    reports.push({
      ref: { jobId: c.jobId, filename: c.filename, row: c.row, caseId: c.caseId },
      product: pKey,
      reactions,
    });
  }

  const total = reports.length;
  const byProduct = new Map<string, number>();
  const byReaction = new Map<string, number>();
  const byPair = new Map<
    string,
    { product: string; reaction: string; refs: CaseRef[]; info: ReactionInfo }
  >();
  for (const r of reports) {
    byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + 1);
    for (const [rKey, info] of r.reactions) {
      byReaction.set(rKey, (byReaction.get(rKey) ?? 0) + 1);
      const key = `${r.product}|${rKey}`;
      const entry = byPair.get(key) ?? { product: r.product, reaction: rKey, refs: [], info };
      entry.refs.push(r.ref);
      byPair.set(key, entry);
    }
  }

  /** The most common way the files wrote this product. */
  const productLabel = (pKey: string) =>
    [...(productLabels.get(pKey) ?? new Map<string, number>()).entries()].sort(
      (x, y) => y[1] - x[1] || x[0].localeCompare(y[0]),
    )[0]?.[0] || pKey;

  const pairs: ScreenPair[] = [];
  for (const [key, entry] of byPair) {
    const a = entry.refs.length;
    const b = (byProduct.get(entry.product) ?? 0) - a;
    const c = (byReaction.get(entry.reaction) ?? 0) - a;
    const d = total - a - b - c;
    const stats = disproportionality(a, b, c, d);
    pairs.push({
      key,
      product: productLabel(entry.product),
      reaction: entry.info.label,
      reactionSource: entry.info.source,
      meddraCode: entry.info.code,
      a,
      b,
      c,
      d,
      ...stats,
      candidate:
        a >= MIN_CASES &&
        stats.prr.value >= MIN_PRR &&
        stats.chiSquare >= MIN_CHI_SQUARE &&
        // Only one product or one reaction in the pool: there is nothing to
        // compare against, so no pair can stand out.
        c + d > 0 &&
        b + d > 0,
      cases: entry.refs,
    });
  }
  pairs.sort(
    (x, y) =>
      Number(y.candidate) - Number(x.candidate) ||
      y.prr.value - x.prr.value ||
      y.a - x.a ||
      x.key.localeCompare(y.key),
  );

  return {
    totalReports: total,
    unusable,
    files: new Set(cases.map((c) => c.jobId)).size,
    smallPool: total < UMC_MIN_REPORTS,
    candidates: pairs.filter((p) => p.candidate),
    pairs,
  };
}
