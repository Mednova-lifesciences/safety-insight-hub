import type { PsurFinding, PsurSuggestedSource } from "@/types/pv";

/**
 * Turns a suggested source into a link an assessor can actually click.
 *
 * "Check VigiFlow for additional case reports on hepatic enzyme elevation"
 * tells an assessor what they already knew. The useful version runs that
 * search for them.
 *
 * This does NOT relax the rule that a source is "never a specific document
 * title, URL, or citation you are not certain exists" — that rule is about
 * fabricated FACTS, and a search URL is not one:
 *
 *   forbidden  "See Smith et al. 2024, J Pharm Sci 45:123"  — asserts a
 *              paper exists, and is exactly the kind of authoritative-
 *              sounding invention a regulatory tool must never produce.
 *   fine       pubmed.ncbi.nlm.nih.gov/?term=amlodipine+hepatic — asserts
 *              nothing. It is a query against a real, stable, public
 *              endpoint, and it is self-verifying: the assessor clicks and
 *              sees whatever is genuinely there, including nothing.
 *
 * Two constraints keep it that way:
 *  1. Base URLs are the fixed table below. Nothing composes a URL freely,
 *     and no model output ever reaches the host part of a link.
 *  2. Only the search TERM varies, and it comes from the finding's own
 *     product/reaction text, URL-encoded.
 *
 * A category with no honest public destination returns null and keeps the
 * guidance note alone — better than linking somewhere that cannot answer
 * the question.
 */

/** Fixed, reviewed destinations. Add to this table deliberately; never
 *  build a host from data. */
const SOURCE_ENDPOINTS: Partial<
  Record<PsurSuggestedSource["type"], { base: string; param: string; site: string }>
> = {
  PUBLISHED_LITERATURE: {
    base: "https://pubmed.ncbi.nlm.nih.gov/",
    param: "term",
    site: "PubMed",
  },
  // VigiFlow itself is authenticated and organisation-scoped, so it cannot
  // be deep-linked into an assessor's own data. VigiAccess is UMC's public
  // view of the same VigiBase reaction data and is the honest public
  // destination for "what reactions are on record for this substance".
  VIGIFLOW_NIGERIA: {
    base: "https://www.vigiaccess.org/",
    param: "",
    site: "VigiAccess (public VigiBase view)",
  },
  WORLDWIDE_REGULATORY_ACTIONS: {
    base: "https://www.who.int/teams/regulation-prequalification/incidents-and-SF/full-list-of-who-medical-product-alerts",
    param: "",
    site: "WHO medical product alerts",
  },
  RISK_MANAGEMENT_PLAN: {
    base: "https://www.ema.europa.eu/en/medicines",
    param: "search",
    site: "EMA medicines (RMP summaries)",
  },
};

export interface SourceLink {
  url: string;
  site: string;
  /** What the assessor is being sent to look for, in their own terms. */
  what: string;
}

/** The substance/reaction this finding is about, for use as a search term.
 *  Returns null when the finding carries nothing specific enough to search
 *  on — a generic term would send the assessor to a useless result page. */
function searchTerm(f: PsurFinding, product: string | undefined): string | null {
  const p = product?.trim();
  if (!p || /^not (yet )?extracted$/i.test(p)) return null;
  // Strip strength/form so the search is about the substance, not the pack.
  const substance = p
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%)\b/gi, "")
    .replace(/\b(tablets?|capsules?|injections?|suspensions?|powder|vials?|drops?)\b/gi, "")
    .replace(/[()]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return substance || null;
}

export function buildSourceLink(f: PsurFinding, product: string | undefined): SourceLink | null {
  const type = f.suggestedSource?.type;
  if (!type) return null;
  const endpoint = SOURCE_ENDPOINTS[type];
  if (!endpoint) return null;

  const term = searchTerm(f, product);
  // An endpoint that takes a query but has nothing to query with would just
  // open a blank search — send the assessor to the site root instead.
  const url =
    endpoint.param && term
      ? `${endpoint.base}?${endpoint.param}=${encodeURIComponent(term)}`
      : endpoint.base;

  const what =
    type === "PUBLISHED_LITERATURE"
      ? term
        ? `published literature on ${term}`
        : "published literature for this product"
      : type === "VIGIFLOW_NIGERIA"
        ? term
          ? `reactions reported for ${term}`
          : "reactions reported for this substance"
        : type === "WORLDWIDE_REGULATORY_ACTIONS"
          ? "regulatory actions and alerts on this product"
          : "risk-management plan summaries for this product";

  return { url, site: endpoint.site, what };
}

/** True for the categories that have no public destination by design —
 *  asking the MAH, reading the product's own RSI, or patient/HCP feedback
 *  are all things no external site can answer. */
export function sourceIsInherentlyLocal(type: PsurSuggestedSource["type"]): boolean {
  return !SOURCE_ENDPOINTS[type];
}
