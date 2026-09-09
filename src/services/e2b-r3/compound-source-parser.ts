/**
 * Codebook-aware compound source-value tokenizer.
 *
 * The objective is NOT "split every number out of every string." It is:
 *   source document -> understand the field -> understand its codebook ->
 *   identify valid codes for that field -> tokenize the raw cell using
 *   ONLY those known codes -> decode each valid code -> preserve any
 *   accompanying verbatim text -> flag only genuinely unresolved portions.
 *
 * A raw cell like "28pains" is only ever interpreted as code 28 + attached
 * text "pains" because 28 is an EXACT, CONFIGURED entry in the active
 * source profile's codebook — never because "28" merely looks numeric.
 * A cell like "Patient had fever for 3 days" is never touched by the
 * prefix-matching step at all, because it doesn't START with anything
 * that matches a valid code — this tokenizer never searches for numbers
 * buried inside free text, only at the front of a delimited segment.
 */

export type SourceCodeTokenStatus = "VALID_SOURCE_CODE" | "UNKNOWN_SOURCE_CODE" | "MALFORMED";

export interface SourceCodeToken {
  /** Exact text of this token as it appeared in the source, before any
   *  attached-text splitting — always preserved, even for a MALFORMED or
   *  UNKNOWN_SOURCE_CODE token. */
  rawToken: string;
  status: SourceCodeTokenStatus;
  /** The exact codebook key this resolved to — only present when status
   *  is VALID_SOURCE_CODE. May differ from rawToken's casing/whitespace. */
  sourceCode?: string | undefined;
  decodedTerm?: string | undefined;
  /** Text immediately following the matched code within the same raw
   *  token (e.g. "pains" in "28pains") — preserved, NEVER discarded, and
   *  NEVER treated as if it were part of the code's meaning. Only present
   *  when status is VALID_SOURCE_CODE and there was genuine leftover text. */
  attachedVerbatimText?: string | undefined;
}

export interface CompoundParseResult {
  rawCellValue: string;
  tokens: SourceCodeToken[];
  /** True when the delimiter structure itself was malformed (e.g.
   *  "28,,15", "28 and", "and 15", "28 / / 15") — surfaced as a warning
   *  even though whatever valid tokens could be safely resolved still are. */
  malformed: boolean;
}

const UNCONDITIONAL_DELIMITER_CHARS = [",", ";", "&", "\n"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits on a set of delimiters that are ALWAYS safe to split on — a
 *  comma or semicolon between two values is never itself part of a
 *  code's attached text. Empty segments from consecutive/leading/
 *  trailing delimiters are dropped but recorded as malformed. */
function splitUnconditional(
  raw: string,
  extraDelimiters: string[],
): { segments: string[]; malformed: boolean } {
  const all = [...UNCONDITIONAL_DELIMITER_CHARS, ...extraDelimiters].map(escapeRegExp).filter(Boolean);
  if (all.length === 0) return { segments: [raw], malformed: false };
  const pattern = new RegExp(`(?:${all.join("|")})`, "i");
  if (!pattern.test(raw)) return { segments: [raw], malformed: false };
  const rawParts = raw.split(pattern);
  const segments = rawParts.map((p) => p.trim()).filter(Boolean);
  const malformed = segments.length !== rawParts.length || rawParts.some((p) => p.trim() === "");
  return { segments, malformed };
}

/** A candidate segment "looks code-shaped" if it's a short, punctuation-
 *  free alphanumeric token — used only to decide whether a CONDITIONAL
 *  delimiter ("/" or "and") is safe to commit to, never to decide coding
 *  outcome directly. Free text like "dizziness" can look code-shaped by
 *  this loose test; the actual commit decision below additionally
 *  requires every resulting part to be an EXACT codebook entry. */
function looksCodeShaped(segment: string): boolean {
  return /^[A-Za-z0-9]+$/.test(segment.trim());
}

/** Conditionally splits on a delimiter (word-boundary "and", or "/") —
 *  but only COMMITS to the split when every resulting part is an EXACT
 *  entry in the codebook. Otherwise the original segment is returned
 *  unsplit, since the delimiter may just be part of ordinary verbatim
 *  text ("headache and dizziness") or attachment punctuation
 *  ("28/pains") rather than a genuine list separator. */
function splitConditional(segment: string, pattern: RegExp, validCodes: Set<string>): { parts: string[]; malformed: boolean } {
  if (!pattern.test(segment)) return { parts: [segment], malformed: false };
  const rawParts = segment.split(pattern);
  const trimmedParts = rawParts.map((p) => p.trim()).filter(Boolean);
  const hadEmptyPart = trimmedParts.length !== rawParts.length;
  const allValid = trimmedParts.length > 1 && trimmedParts.every((p) => validCodes.has(normalizeCode(p)));
  if (allValid) return { parts: trimmedParts, malformed: hadEmptyPart };
  // Not every part is a real code — but if the split produced an empty
  // part (e.g. "28 and", "and 15"), that's still a structural warning
  // worth surfacing, even though we don't commit to the split itself.
  const bothPartsCodeShaped = trimmedParts.length > 1 && trimmedParts.every(looksCodeShaped);
  return { parts: [segment], malformed: hadEmptyPart && bothPartsCodeShaped };
}

const AND_PATTERN = /\s+and\s+/i;
const SLASH_PATTERN = /\s*\/\s*/;

function normalizeCode(v: string): string {
  return v.trim().toUpperCase();
}

/** Attempts to match a segment against the codebook: exact match first,
 *  then a longest-valid-code PREFIX match with attached text preserved.
 *  Never searches for a code anywhere other than the very start of the
 *  segment — a segment that doesn't begin with a recognizable code is
 *  never mined for one. */
function resolveSegment(segment: string, validCodes: Map<string, string>): SourceCodeToken {
  const trimmed = segment.trim();
  const exact = validCodes.get(normalizeCode(trimmed));
  if (exact !== undefined) {
    return { rawToken: segment, status: "VALID_SOURCE_CODE", sourceCode: normalizeCode(trimmed), decodedTerm: exact };
  }

  // Longest-valid-code-as-prefix search — e.g. prefer "280" over "28"
  // when both are real codes and the segment is "280pains".
  let bestMatch: { code: string; term: string } | null = null;
  for (const [code, term] of validCodes) {
    if (trimmed.toUpperCase().startsWith(code) && (!bestMatch || code.length > bestMatch.code.length)) {
      bestMatch = { code, term };
    }
  }

  if (!bestMatch) {
    return { rawToken: segment, status: "UNKNOWN_SOURCE_CODE" };
  }

  const afterPrefix = trimmed.slice(bestMatch.code.length);
  // If another digit immediately follows the matched prefix, this is
  // ambiguous with a longer number we don't recognise (e.g. code "20"
  // matching the start of "2026-08-20") — never guess; treat as unknown
  // rather than risk misreading part of an unrelated numeric value.
  if (/^\d/.test(afterPrefix)) {
    return { rawToken: segment, status: "UNKNOWN_SOURCE_CODE" };
  }

  const remainder = afterPrefix.replace(/^[\s\-:/.,]+/, "");
  if (remainder === "") {
    return { rawToken: segment, status: "VALID_SOURCE_CODE", sourceCode: bestMatch.code, decodedTerm: bestMatch.term };
  }
  if (/[A-Za-z]/.test(remainder)) {
    // Genuine descriptive text attached to a real code — preserved, never
    // treated as if it were the code's meaning.
    return {
      rawToken: segment,
      status: "VALID_SOURCE_CODE",
      sourceCode: bestMatch.code,
      decodedTerm: bestMatch.term,
      attachedVerbatimText: remainder.trim(),
    };
  }
  // Remainder is more digits/punctuation with no letters (e.g. "8.19.21"
  // matching prefix "8" then leaving ".19.21") — this is tokenization
  // ambiguity, not attached descriptive text. Never guess a split here.
  return { rawToken: segment, status: "MALFORMED" };
}

/**
 * Parses one raw line-list cell that may contain a single source code, a
 * delimited list of codes, or a code with attached verbatim text — using
 * ONLY the codebook entries actually supplied for this field. No source-
 * specific logic: this function takes a plain map of valid codes and
 * works identically for any source profile.
 */
export function parseCompoundSourceValue(
  raw: string,
  codebookEntries: Record<string, { sourceTerm: string }>,
  extraUnconditionalDelimiters: string[] = [],
): CompoundParseResult {
  const rawCellValue = raw;
  const validCodes = new Map<string, string>();
  for (const [code, entry] of Object.entries(codebookEntries)) {
    validCodes.set(normalizeCode(code), entry.sourceTerm);
  }
  const validCodesSet = new Set(validCodes.keys());

  const { segments: hardSegments, malformed: hardMalformed } = splitUnconditional(
    rawCellValue,
    extraUnconditionalDelimiters,
  );

  let malformed = hardMalformed;
  const finalSegments: string[] = [];
  for (const seg of hardSegments) {
    const slashResult = splitConditional(seg, SLASH_PATTERN, validCodesSet);
    malformed = malformed || slashResult.malformed;
    for (const part of slashResult.parts) {
      const andResult = splitConditional(part, AND_PATTERN, validCodesSet);
      malformed = malformed || andResult.malformed;
      finalSegments.push(...andResult.parts);
    }
  }

  const tokens = finalSegments.map((seg) => resolveSegment(seg, validCodes));
  return { rawCellValue, tokens, malformed };
}
