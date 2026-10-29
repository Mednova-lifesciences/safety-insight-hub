import { dayNumber, productKey, type DuplicatePair } from "./linelist-cross-duplicates";
import type { LoadedCase } from "./linelist-cross-file";

/**
 * Observed vs expected AEFI — a SCREENING CHECK, not a signal.
 *
 * The evaluator picks a vaccine and an event and enters how many doses were
 * given. Expected = doses × the background rate WHO publishes for that
 * vaccine and event. Observed = the matching cases in the organisation's
 * kept, validated line lists, each possible duplicate counted once. An
 * exact Poisson 95% interval is put around the observed count, and the
 * check is flagged only when the expected count falls below that interval
 * — observed above expected beyond what chance alone explains.
 *
 * It has a high false-positive rate by design: case counts in a line list
 * are not a complete denominator-matched surveillance count, reporting
 * varies, and several checks run side by side raise the chance of one
 * flag. A flag is a prompt for a person to look, never a conclusion.
 */

export interface ExpectedRate {
  id: string;
  vaccine: string;
  /** productKey() spellings that count as this vaccine. */
  vaccineKeys: string[];
  event: string;
  /** Cases per million doses. */
  perMillion: number;
  /** How WHO states it. */
  statedAs: string;
  /** Days from vaccination to onset the rate refers to, where WHO states one. */
  riskWindowDays?: [number, number] | undefined;
  /** A reaction text counts as this event when it matches. */
  matches: (reaction: string) => boolean;
  source: { title: string; date: string; url: string };
}

const febrileSeizure = (r: string) =>
  /febrile\s*(convulsion|seizure|fit)/i.test(r) ||
  (/(convulsion|seizure|\bfits?\b)/i.test(r) && /fever|pyrexia|febrile/i.test(r));

export const EXPECTED_RATES: ExpectedRate[] = [
  {
    id: "hpv-anaphylaxis",
    vaccine: "HPV",
    vaccineKeys: ["hpv"],
    event: "Anaphylaxis",
    perMillion: 1.7,
    statedAs: "1.7 per million doses",
    matches: (r) => /anaphyla/i.test(r),
    source: {
      title:
        "WHO Information Sheet: Observed rate of vaccine reactions — Human papilloma virus vaccine",
      date: "December 2017",
      url: "https://www.who.int/publications/m/item/hpv-vaccine-rates-information-sheet",
    },
  },
  {
    id: "measles-febrile-seizure",
    vaccine: "Measles-containing (MR / MMR)",
    vaccineKeys: ["measles rubella", "measles", "measles mumps rubella", "mmr"],
    event: "Febrile seizures",
    perMillion: 1_000_000 / 3000,
    statedAs: "1 in 3,000 doses, 6–11 days after vaccination",
    riskWindowDays: [6, 11],
    matches: febrileSeizure,
    source: {
      title:
        "WHO Information Sheet: Observed rate of vaccine reactions — Measles, mumps and rubella vaccines",
      date: "May 2014",
      url: "https://www.who.int/publications/m/item/mmr-vaccine-rates-information-sheet",
    },
  },
  {
    id: "measles-thrombocytopenia",
    vaccine: "Measles-containing (MR / MMR)",
    vaccineKeys: ["measles rubella", "measles", "measles mumps rubella", "mmr"],
    event: "Thrombocytopenia",
    perMillion: 1_000_000 / 30000,
    statedAs: "1 in 30,000 to 1 in 40,000 vaccinated children (the higher rate is used)",
    matches: (r) => /thrombocytop|\bitp\b|low platelet|purpura/i.test(r),
    source: {
      title:
        "WHO Information Sheet: Observed rate of vaccine reactions — Measles, mumps and rubella vaccines",
      date: "May 2014",
      url: "https://www.who.int/publications/m/item/mmr-vaccine-rates-information-sheet",
    },
  },
];

// ---------------------------------------------------------------------------
// Exact Poisson interval
// ---------------------------------------------------------------------------

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lnPre = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.exp(lnPre) * sum;
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return 1 - Math.exp(lnPre) * h;
}

/** The x with P(shape, x) = p, by bisection. */
function gammaQuantile(p: number, shape: number): number {
  let lo = 0;
  let hi = Math.max(10, shape * 10 + 50);
  while (gammaP(shape, hi) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (gammaP(shape, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact (Garwood) 95% interval for a Poisson count. */
export function poissonExactInterval(observed: number, level = 0.95): [number, number] {
  const alpha = 1 - level;
  const lower = observed === 0 ? 0 : gammaQuantile(alpha / 2, observed);
  const upper = gammaQuantile(1 - alpha / 2, observed + 1);
  return [lower, upper];
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export type CheckStatus = "ABOVE_EXPECTED" | "HIGHER_WITHIN_CHANCE" | "NOT_ABOVE";

export interface ExcludedCase {
  c: LoadedCase;
  reason: string;
}

export interface ObservedExpectedResult {
  rate: ExpectedRate;
  doses: number;
  expected: number;
  observed: number;
  interval: [number, number];
  status: CheckStatus;
  counted: LoadedCase[];
  excluded: ExcludedCase[];
}

const caseKey = (c: Pick<LoadedCase, "jobId" | "row">) => `${c.jobId}#${c.row}`;

/**
 * `cases` are the kept cases of validated line lists (dropped and held ones
 * already left out). `duplicatePairs` are the cross-file pairs still open —
 * each counts once.
 */
export function observedVsExpected(
  rate: ExpectedRate,
  doses: number,
  cases: LoadedCase[],
  duplicatePairs: DuplicatePair[] = [],
): ObservedExpectedResult {
  if (!Number.isFinite(doses) || doses <= 0)
    throw new Error("Enter the number of doses administered.");
  const excluded: ExcludedCase[] = [];
  const matching = cases.filter(
    (c) => rate.vaccineKeys.includes(productKey(c.product)) && rate.matches(c.reaction ?? ""),
  );

  const inWindow: LoadedCase[] = [];
  for (const c of matching) {
    if (!rate.riskWindowDays) {
      inWindow.push(c);
      continue;
    }
    const v = dayNumber(c.vaccinationDate);
    const o = dayNumber(c.onsetDate);
    if (v === null || o === null) {
      excluded.push({
        c,
        reason: "vaccination or onset date not readable — the risk window cannot be checked",
      });
      continue;
    }
    const days = o - v;
    const [from, to] = rate.riskWindowDays;
    if (days < from || days > to) {
      excluded.push({
        c,
        reason: `onset ${days} day(s) after vaccination, outside the ${from}–${to} day window`,
      });
      continue;
    }
    inWindow.push(c);
  }

  // A possible duplicate counts once: of each still-open pair, the second
  // case is left out when both sides matched.
  const counted: LoadedCase[] = [];
  const seen = new Set<string>();
  const partner = new Map<string, string>();
  for (const p of duplicatePairs) {
    partner.set(caseKey(p.a), caseKey(p.b));
    partner.set(caseKey(p.b), caseKey(p.a));
  }
  for (const c of inWindow) {
    const other = partner.get(caseKey(c));
    if (other && seen.has(other)) {
      excluded.push({ c, reason: "possible duplicate of a case already counted" });
      continue;
    }
    seen.add(caseKey(c));
    counted.push(c);
  }

  const expected = (doses * rate.perMillion) / 1_000_000;
  const observed = counted.length;
  const interval = poissonExactInterval(observed);
  const status: CheckStatus =
    observed > 0 && interval[0] > expected
      ? "ABOVE_EXPECTED"
      : observed > expected
        ? "HIGHER_WITHIN_CHANCE"
        : "NOT_ABOVE";
  return { rate, doses, expected, observed, interval, status, counted, excluded };
}

/** For the audit trail: the whole calculation, no patient details. */
export function describeCheck(r: ObservedExpectedResult): string {
  return [
    `${r.rate.vaccine} — ${r.rate.event}`,
    `doses ${r.doses}`,
    `expected ${r.expected.toFixed(3)} (${r.rate.statedAs}; ${r.rate.source.title}, ${r.rate.source.date})`,
    `observed ${r.observed}, exact 95% CI ${r.interval[0].toFixed(3)}–${r.interval[1].toFixed(3)}`,
    `result ${r.status}`,
    `cases ${r.counted.map((c) => c.caseId ?? `${c.filename}#${c.row}`).join(", ") || "none"}`,
  ].join("; ");
}

export const STATUS_LABELS: Record<CheckStatus, string> = {
  ABOVE_EXPECTED: "Above expected — flag for review",
  HIGHER_WITHIN_CHANCE: "Higher than expected, within chance",
  NOT_ABOVE: "Not above expected",
};

