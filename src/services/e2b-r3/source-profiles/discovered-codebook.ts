/**
 * The structured result of discovering a source document's own codebook/
 * legend (e.g. a "KEY TO SUMMARY FINDINGS" block) — the bridge between
 * raw legend text (preserved by tabular-parse.ts's discardedRowsText/
 * discardedRows, instead of being silently dropped) and the deterministic
 * resolver in mapping.ts.
 *
 * Field-specific by construction: the same code ("1") can mean something
 * completely different under "reaction" than under "outcome" — there is
 * deliberately no single global code->meaning dictionary anywhere in this
 * model.
 */

export type CodebookDiscoveryStatus = "DISCOVERED" | "PARTIAL" | "NOT_FOUND" | "PARSE_FAILED";

export interface SourceCodebookEvidence {
  file?: string | undefined;
  sheet?: string | undefined;
  row?: number | undefined;
  /** The exact raw text this entry was parsed from — always retained, so
   *  a rejected/ambiguous entry can still be inspected by a human, and so
   *  a correctly-accepted one can be traced back to its real source. */
  rawText?: string | undefined;
}

export interface SourceCodebookEntry {
  /** Canonical field name this mapping applies to (e.g. "reaction",
   *  "outcome", "seriousness") — never a raw source column header. */
  field: string;
  sourceCode: string;
  /** The source document's own wording — never invented, never
   *  paraphrased. */
  meaning: string;
  sourceEvidence?: SourceCodebookEvidence | undefined;
}

export interface RejectedCodebookEntry {
  entry: SourceCodebookEntry;
  reason: string;
}

export interface DiscoveredSourceCodebook {
  sourceId: string;
  /** Only entries that passed validateDiscoveredCodebook — see
   *  rejectedEntries for anything that didn't. */
  entries: SourceCodebookEntry[];
  rejectedEntries: RejectedCodebookEntry[];
  discoveryStatus: CodebookDiscoveryStatus;
  evidence?:
    | {
        file?: string | undefined;
        sheet?: string | undefined;
        startRow?: number | undefined;
        endRow?: number | undefined;
        rawText?: string | undefined;
      }
    | undefined;
}

/** Distinct fields, in the order first seen — for diagnostics ("which
 *  fields did we actually find a codebook section for"). */
export function fieldsCovered(codebook: DiscoveredSourceCodebook): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of codebook.entries) {
    if (!seen.has(e.field)) {
      seen.add(e.field);
      out.push(e.field);
    }
  }
  return out;
}
