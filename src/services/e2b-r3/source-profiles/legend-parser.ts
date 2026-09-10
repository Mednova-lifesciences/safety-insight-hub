import type {
  CodebookDiscoveryStatus,
  DiscoveredSourceCodebook,
  RejectedCodebookEntry,
  SourceCodebookEntry,
} from "./discovered-codebook";

/**
 * Generic, source-agnostic legend/codebook parser. Turns raw text lines
 * discovered outside a line list's own case table (see
 * tabular-parse.ts's discardedRowsText/discardedRows) into a structured,
 * field-specific DiscoveredSourceCodebook — deterministically, with no
 * per-cell LLM call and no reference to any specific source.
 *
 * The only thing "generic" doesn't mean here: this parser still has to
 * know a small, fixed vocabulary of PV/AEFI *domain* concepts (reaction,
 * outcome, seriousness) to associate a legend section with the right
 * canonical field — exactly the same kind of keyword-stem matching this
 * codebase already uses for column-header detection (see
 * tabular-parse.ts's HEADER_SIGNAL_KEYWORDS). That is not a per-source
 * special case; it's the same generic heuristic applied to legend
 * headings instead of column headings, and it never mentions "Ondo" or
 * any specific source by name.
 */

/** Short, typo-tolerant stems — matched as a case-insensitive substring
 *  against the first ~60 characters of a candidate legend line. Short on
 *  purpose: "SERI" matches both "SERIOUS" and a misspelling like
 *  "SERIUOS" (a real, observed spelling in the Ondo fixture) without
 *  needing an exhaustive list of every possible typo. */
const FIELD_KEYWORD_STEMS: Record<string, string[]> = {
  reaction: ["REACT", "ADVERSE EVENT", "AEFI TYPE"],
  outcome: ["OUTCOME"],
  seriousness: ["SERI"],
};

const HEADING_SCAN_CHARS = 60;

function detectFieldHint(line: string): string | null {
  const head = line.toUpperCase().slice(0, HEADING_SCAN_CHARS);
  for (const [field, stems] of Object.entries(FIELD_KEYWORD_STEMS)) {
    if (stems.some((stem) => head.includes(stem))) return field;
  }
  return null;
}

/** Matches a "code" anchor — 1-3 digits followed by one of the several
 *  separator conventions real-world legends use ("=", ":", "-", or a
 *  period immediately followed by whitespace, e.g. "1. Life
 *  threatening" — but NOT a bare mid-number decimal point like "0.5",
 *  since that requires a digit, not whitespace, right after the dot). */
const CODE_ANCHOR = /(\d{1,3})\s*(?:[=:\-]|\.(?=\s))\s*/g;

/** Real legends sometimes omit the separator entirely for one entry in
 *  an otherwise consistent list (observed: "..., 9 Site induration, 10=...").
 *  When a bare "<comma-or-semicolon> <digits> <letter>" run is found with
 *  no operator at all, a synthetic "=" is inserted so the main anchor
 *  regex can still find it — this is a tolerance for a missing delimiter
 *  within an otherwise-recognised list structure, not a guess about what
 *  the code means. */
function normalizeMissingSeparators(text: string): string {
  return text.replace(/([,;])\s*(\d{1,3})\s+(?=[A-Za-z])/g, "$1$2=");
}

export interface RawMapping {
  code: string;
  meaning: string;
}

/** Extracts every (code, meaning) pair from one legend line's mapping-list
 *  portion. Tolerant of: comma or semicolon between entries, "=" / ":" /
 *  "-" / ". " as the code/meaning separator, multiple mappings run
 *  together on one line, and inconsistent whitespace. Never guesses a
 *  split when no code-shaped anchor is found at all. */
export function extractRawMappings(text: string): RawMapping[] {
  const normalized = normalizeMissingSeparators(text);
  const anchors: { code: string; index: number; matchEnd: number }[] = [];
  const re = new RegExp(CODE_ANCHOR.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized))) {
    anchors.push({ code: m[1]!, index: m.index, matchEnd: m.index + m[0].length });
  }

  const results: RawMapping[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i]!.matchEnd;
    const end = i + 1 < anchors.length ? anchors[i + 1]!.index : normalized.length;
    let meaning = normalized.slice(start, end).trim();
    meaning = meaning.replace(/[,;]+\s*$/, "").trim();
    if (meaning) results.push({ code: anchors[i]!.code, meaning });
  }
  return results;
}

export interface LegendLine {
  text: string;
  row?: number | undefined;
}

export interface ParseDiscoveredLegendInput {
  sourceId: string;
  lines: LegendLine[];
  evidence?: { file?: string | undefined; sheet?: string | undefined } | undefined;
}

/**
 * Parses every candidate legend line independently — each entry in
 * `lines` is treated as its own potential section (matching how a real
 * "KEY TO SUMMARY FINDINGS" block is typically laid out: one line per
 * coded field, e.g. "1) REACTION TYPE : 1=Anaphylaxis, ..."). A line
 * that doesn't contain at least 2 recognisable code=meaning pairs is not
 * treated as a codebook section at all (avoids misreading an ordinary
 * title/instruction line as a 1-entry "codebook").
 */
export function parseDiscoveredLegend(input: ParseDiscoveredLegendInput): DiscoveredSourceCodebook {
  const entries: SourceCodebookEntry[] = [];
  let firstRow: number | undefined;
  let lastRow: number | undefined;
  let anyLineHadMappings = false;
  let anyLineFailedToParseDespiteFieldHint = false;

  for (const line of input.lines) {
    const fieldHint = detectFieldHint(line.text);
    const mappings = extractRawMappings(line.text);
    if (mappings.length < 2) {
      if (fieldHint) anyLineFailedToParseDespiteFieldHint = true;
      continue;
    }
    if (!fieldHint) continue; // a mapping-shaped line with no recognisable field heading is not attributed to anything — never guessed

    anyLineHadMappings = true;
    if (firstRow === undefined || (line.row !== undefined && line.row < firstRow)) firstRow = line.row;
    if (lastRow === undefined || (line.row !== undefined && line.row > lastRow)) lastRow = line.row;

    for (const { code, meaning } of mappings) {
      entries.push({
        field: fieldHint,
        sourceCode: code,
        meaning,
        sourceEvidence: { sheet: input.evidence?.sheet, file: input.evidence?.file, row: line.row, rawText: line.text },
      });
    }
  }

  let discoveryStatus: CodebookDiscoveryStatus;
  if (anyLineHadMappings) {
    discoveryStatus = anyLineFailedToParseDespiteFieldHint ? "PARTIAL" : "DISCOVERED";
  } else if (anyLineFailedToParseDespiteFieldHint) {
    discoveryStatus = "PARSE_FAILED";
  } else {
    discoveryStatus = "NOT_FOUND";
  }

  return {
    sourceId: input.sourceId,
    entries,
    rejectedEntries: [],
    discoveryStatus,
    evidence:
      anyLineHadMappings
        ? {
            file: input.evidence?.file,
            sheet: input.evidence?.sheet,
            startRow: firstRow,
            endRow: lastRow,
          }
        : undefined,
  };
}

/**
 * Validates a discovered codebook BEFORE it's allowed to affect
 * regulatory export — malformed or conflicting entries are moved to
 * rejectedEntries (never silently dropped, never silently kept either).
 * Checks, per task requirements: field/code/meaning non-empty, and
 * duplicate (field, code) pairs with DIFFERENT meanings are a conflict —
 * neither meaning is trusted, both are rejected, and the conflict is
 * recorded so a human can resolve it. A duplicate with the IDENTICAL
 * meaning (e.g. the same section accidentally listed twice) is harmless
 * and simply de-duplicated.
 */
export function validateDiscoveredCodebook(codebook: DiscoveredSourceCodebook): DiscoveredSourceCodebook {
  const byKey = new Map<string, SourceCodebookEntry[]>();
  const rejected: RejectedCodebookEntry[] = [...codebook.rejectedEntries];

  for (const entry of codebook.entries) {
    if (!entry.field.trim() || !entry.sourceCode.trim() || !entry.meaning.trim()) {
      rejected.push({ entry, reason: "Missing field, source code, or meaning." });
      continue;
    }
    const key = `${entry.field}::${entry.sourceCode.trim().toUpperCase()}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(entry);
    byKey.set(key, bucket);
  }

  const accepted: SourceCodebookEntry[] = [];
  for (const [, bucket] of byKey) {
    const distinctMeanings = new Set(bucket.map((e) => e.meaning.trim().toLowerCase()));
    if (distinctMeanings.size > 1) {
      for (const entry of bucket) {
        rejected.push({
          entry,
          reason: `Conflicting meanings for ${entry.field} code "${entry.sourceCode}": ${[...distinctMeanings].join(" | ")}. Neither is applied — resolve manually.`,
        });
      }
      continue;
    }
    accepted.push(bucket[0]!); // identical duplicates collapse to one
  }

  return { ...codebook, entries: accepted, rejectedEntries: rejected };
}
