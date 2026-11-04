import type { CaseDetail, CaseSummary, Signal } from "@/types/pv";
import type { CatalogDrug } from "@/services/api/products";
import type { Registration } from "@/services/api/registrations";
import { describeIntake } from "@/services/api/intake-channel";
import { caseClusters } from "@/services/api/case-clusters";

/**
 * Everything a PSUR draft takes from the safety database, computed here and
 * nowhere else: counts, tabulations, the line listing, late-breaking cases,
 * signals and clusters, the registration. No wording is generated and
 * nothing is estimated — if the records do not hold a fact, it is absent and
 * the draft says so. A snapshot is stored on the draft with `takenAt` so an
 * exported report can always be traced to the data behind it.
 */

export type CaseRecord = CaseSummary &
  Partial<
    Pick<
      CaseDetail,
      "suspectProducts" | "reactions" | "patient" | "reportedSeriousnessCriteria" | "reporter"
    >
  >;

export interface Tally {
  total: number;
  /** Cases whose reporter country is recorded as Nigeria. */
  nigerian: number;
  serious: number;
  nonSerious: number;
  unassessed: number;
  fatal: number;
}

export interface ReactionRow {
  /** MedDRA preferred term where the case has been coded, else the term as reported. */
  term: string;
  coded: boolean;
  /** Primary MedDRA system organ class, when the dictionary service resolved it. */
  soc?: string | undefined;
  interval: number;
  intervalSerious: number;
  cumulative: number;
  cumulativeSerious: number;
}

export interface LineListingRow {
  caseId: string;
  receivedDate: string;
  sex?: string | undefined;
  age?: string | undefined;
  reaction: string;
  coded: boolean;
  onsetDate?: string | undefined;
  seriousness: CaseSummary["seriousness"];
  criteria: string[];
  outcome: CaseSummary["outcome"];
  batch?: string | undefined;
  source: string;
}

export interface SignalFact {
  /** The product as the signal record names it. */
  product: string;
  /** Where the signal was detected. */
  origin: "Case data" | "Literature";
  reaction: string;
  status: Signal["status"];
  method: string;
  detectionPeriod: string;
  caseCount: number;
  rationale?: string | undefined;
  decidedAt?: string | undefined;
}

export interface LiteratureHit {
  publication: string;
  headline: string;
  date: string;
  risk: string;
}

export interface ClusterFact {
  kind: "BATCH" | "BRANCH";
  label: string;
  cases: number;
  from: string;
  to: string;
}

export interface DraftFacts {
  takenAt: string;
  /** Plain statement of where these facts come from, printed with them. */
  source: string;
  product: Pick<CatalogDrug, "id" | "name" | "activeIngredient" | "strength" | "route" | "holder">;
  registration?:
    Pick<Registration, "registrationNumber" | "holder" | "issueDate" | "expiryDate"> | undefined;
  interval: Tally;
  cumulative: Tally;
  reactions: ReactionRow[];
  /** Interval cases whose reaction has not been coded to MedDRA yet. */
  uncodedInInterval: number;
  lineListing: LineListingRow[];
  lateBreaking: LineListingRow[];
  signals: SignalFact[];
  clusters: ClusterFact[];
  literature: LiteratureHit[];
  byChannel: { name: string; count: number }[];
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** A signal names this product when the product's name appears in it as a
 *  whole word ("paracetamol syrup" names Paracetamol; "paracetamolx" does
 *  not). Shown with the product as recorded, for the author to judge. */
export function namesProduct(signalProduct: string | undefined, drugName: string): boolean {
  const name = norm(drugName);
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(norm(signalProduct));
}

export function isProductCase(c: CaseRecord, drug: Pick<CatalogDrug, "id" | "name">): boolean {
  if (c.productId) return c.productId === drug.id;
  return norm(c.product) === norm(drug.name);
}

function tally(cases: CaseRecord[]): Tally {
  return {
    total: cases.length,
    nigerian: cases.filter((c) => /nigeria/i.test(c.reporter?.country ?? "")).length,
    serious: cases.filter((c) => c.seriousness === "SERIOUS").length,
    nonSerious: cases.filter((c) => c.seriousness === "NON_SERIOUS").length,
    unassessed: cases.filter((c) => c.seriousness === "UNASSESSED").length,
    fatal: cases.filter((c) => c.outcome === "FATAL").length,
  };
}

function reactionOf(c: CaseRecord): { term: string; coded: boolean } {
  const coded = c.reactions?.[0]?.codedTerm?.term;
  return coded ? { term: coded, coded: true } : { term: c.reaction, coded: false };
}

/** The preferred term and primary SOC of a MedDRA lowest level term. */
export type MeddraLookup = Map<string, { preferredTerm: string; soc: string }>;

/** MedDRA LLT codes of the coded reactions in these cases (for the lookup). */
export function codedReactionCodes(cases: CaseRecord[]): string[] {
  const codes = new Set<string>();
  for (const c of cases) {
    const t = c.reactions?.[0]?.codedTerm;
    if (t?.dictionary === "MedDRA" && t.code) codes.add(t.code);
  }
  return [...codes];
}

function tabulatedReaction(
  c: CaseRecord,
  meddra: MeddraLookup | undefined,
): { term: string; coded: boolean; soc?: string } {
  const r = reactionOf(c);
  const code = c.reactions?.[0]?.codedTerm?.code;
  const hit = r.coded && code ? meddra?.get(code) : undefined;
  return hit ? { term: hit.preferredTerm, coded: true, soc: hit.soc } : r;
}

function lineRow(c: CaseRecord): LineListingRow {
  const r = reactionOf(c);
  return {
    caseId: c.id,
    receivedDate: c.receivedDate,
    sex: c.patient?.sex && c.patient.sex !== "UNKNOWN" ? c.patient.sex : undefined,
    age: c.patient?.age || undefined,
    reaction: r.term,
    coded: r.coded,
    onsetDate: c.reactions?.[0]?.onsetDate || undefined,
    seriousness: c.seriousness,
    criteria: c.reportedSeriousnessCriteria ?? [],
    outcome: c.outcome,
    batch: c.suspectProducts?.[0]?.batchNumber || undefined,
    source: describeIntake(c),
  };
}

const byDate = (a: CaseRecord, b: CaseRecord) =>
  a.receivedDate.localeCompare(b.receivedDate) || a.id.localeCompare(b.id);

export function buildDraftFacts(input: {
  drug: CatalogDrug;
  periodStart: string;
  dlp: string;
  cases: CaseRecord[];
  signals: Signal[];
  registrations: Registration[];
  organisation: string;
  /** Resolves coded LLTs to PT and primary SOC; without it rows stay as coded. */
  meddra?: MeddraLookup;
  now?: Date;
}): DraftFacts {
  const { drug, periodStart, dlp } = input;
  const now = input.now ?? new Date();
  const mine = input.cases.filter((c) => isProductCase(c, drug)).sort(byDate);
  const cumulativeCases = mine.filter((c) => c.receivedDate <= dlp);
  const intervalCases = cumulativeCases.filter((c) => c.receivedDate > periodStart);
  const late = mine.filter((c) => c.receivedDate > dlp);

  const rows = new Map<string, ReactionRow>();
  for (const c of cumulativeCases) {
    const r = tabulatedReaction(c, input.meddra);
    // Coded and uncoded rows stay apart: a MedDRA term and raw reported text
    // are not the same thing, even when they read alike.
    const key = `${r.coded ? "C" : "U"}:${norm(r.term)}`;
    const row = rows.get(key) ?? {
      term: r.term,
      coded: r.coded,
      ...(r.soc ? { soc: r.soc } : {}),
      interval: 0,
      intervalSerious: 0,
      cumulative: 0,
      cumulativeSerious: 0,
    };
    // As recorded, so the table agrees with the counts in the text; a fatal
    // case recorded as non-serious is raised by the pre-submission check.
    const serious = c.seriousness === "SERIOUS";
    row.cumulative++;
    if (serious) row.cumulativeSerious++;
    if (c.receivedDate > periodStart) {
      row.interval++;
      if (serious) row.intervalSerious++;
    }
    rows.set(key, row);
  }

  const reg = input.registrations.find(
    (r) =>
      r.status === "ACTIVE" && (r.productId === drug.id || norm(r.productName) === norm(drug.name)),
  );

  const productSignals = input.signals.filter(
    (s) => s.source !== "LINE_LIST" && namesProduct(s.product, drug.name),
  );

  const channels = new Map<string, number>();
  intervalCases.forEach((c) => {
    const k = describeIntake(c);
    channels.set(k, (channels.get(k) ?? 0) + 1);
  });

  return {
    takenAt: now.toISOString(),
    source: `${input.organisation} safety database (MedNova PV Assist): cases received for ${drug.name}`,
    product: {
      id: drug.id,
      name: drug.name,
      activeIngredient: drug.activeIngredient,
      strength: drug.strength,
      route: drug.route,
      holder: drug.holder,
    },
    registration: reg
      ? {
          registrationNumber: reg.registrationNumber,
          holder: reg.holder,
          issueDate: reg.issueDate,
          expiryDate: reg.expiryDate,
        }
      : undefined,
    interval: tally(intervalCases),
    cumulative: tally(cumulativeCases),
    reactions: [...rows.values()].sort(
      (a, b) =>
        b.interval - a.interval || b.cumulative - a.cumulative || a.term.localeCompare(b.term),
    ),
    uncodedInInterval: intervalCases.filter((c) => !reactionOf(c).coded).length,
    lineListing: intervalCases.map(lineRow),
    lateBreaking: late.map(lineRow),
    signals: productSignals.map((s) => ({
      product: s.product,
      origin: s.literature ? ("Literature" as const) : ("Case data" as const),
      reaction: s.reaction,
      status: s.status,
      method: s.detectionMethod,
      detectionPeriod: s.detectionPeriod,
      caseCount: s.caseCount,
      rationale: s.rationale ?? undefined,
      decidedAt: s.decidedAt ?? undefined,
    })),
    clusters: caseClusters(intervalCases, false).map((f) => ({
      kind: f.kind === "BATCH" ? "BATCH" : "BRANCH",
      label: f.label,
      cases: f.cases.length,
      from: f.from,
      to: f.to,
    })),
    literature: productSignals
      .filter((s) => s.literature)
      .map((s) => ({
        publication: s.literature!.publication,
        headline: s.literature!.headline,
        date: s.literature!.publicationDate,
        risk: s.literature!.riskLevel,
      })),
    byChannel: [...channels.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
