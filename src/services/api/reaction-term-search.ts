import { coding } from "./coding";

export interface MedDraHit {
  code: string;
  term: string;
}

/** Words not worth searching MedDRA for on their own. */
const STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "after",
  "above",
  "below",
  "more",
  "less",
  "than",
  "from",
  "into",
  "over",
  "under",
  "about",
  "very",
  "body",
  "site",
  "case",
  "cases",
  "hours",
  "hour",
  "days",
  "day",
  "weeks",
  "week",
  "child",
  "baby",
  "patient",
]);

/**
 * The words of a local reaction phrase worth searching on their own, the
 * bracketed explanation first — "Hotness of body (fever 38oC and above)"
 * gives ["fever", "hotness"]: the words a clinician would look up. Pure.
 */
export function searchWordsOf(phrase: string): string[] {
  const inBrackets = [...phrase.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? "").join(" ");
  const outside = phrase.replace(/\([^)]*\)/g, " ");
  const words = `${inBrackets} ${outside}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** What the search box starts with: the AI's suggested term when there is
 *  one, otherwise the phrase without its bracketed explanation. Pure. */
export function startingQuery(phrase: string, suggestion?: { term: string } | null): string {
  if (suggestion?.term) return suggestion.term;
  const plain = phrase
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain || phrase.trim();
}

/** Ranks hits for a query: the exact term first, then the shortest. Pure. */
export function rankHits(hits: MedDraHit[], query: string): MedDraHit[] {
  const wanted = query.trim().toLowerCase();
  const seen = new Set<string>();
  return hits
    .filter((h) => (seen.has(h.code) ? false : (seen.add(h.code), true)))
    .sort(
      (x, y) =>
        Number(x.term.trim().toLowerCase() !== wanted) -
          Number(y.term.trim().toLowerCase() !== wanted) || x.term.length - y.term.length,
    );
}

async function dictionaryHits(q: string): Promise<MedDraHit[]> {
  const matches = await coding.searchDictionary("MedDRA", q);
  return matches
    .filter((m) => m.source === "dictionary")
    .map((m) => ({ code: m.code, term: m.term }));
}

/**
 * Searches MedDRA for what was typed. When the whole phrase matches nothing
 * — local wording rarely does — each of its words is tried, so a search for
 * "Hotness of body (fever 38oC and above)" still finds "Fever". Says which
 * words it used, so the page can tell the reviewer.
 */
export async function searchMedDra(
  query: string,
): Promise<{ hits: MedDraHit[]; byWords: string[] }> {
  const q = query.trim();
  if (!q) return { hits: [], byWords: [] };
  const direct = rankHits(await dictionaryHits(q), q);
  if (direct.length) return { hits: direct.slice(0, 8), byWords: [] };
  const words = searchWordsOf(q).slice(0, 4);
  const found: MedDraHit[] = [];
  const used: string[] = [];
  for (const w of words) {
    const hits = rankHits(await dictionaryHits(w), w);
    if (hits.length) {
      used.push(w);
      found.push(...hits.slice(0, 4));
    }
  }
  return { hits: rankHits(found, "").slice(0, 8), byWords: used };
}
