import type { SourceProfile } from "./source-profiles/types";
import type { CodedTerm, ReactionOutcome } from "./types";
import type { MedDraCodingProvider } from "./coding-provider";

/**
 * Organization-wide memory of how a source's own words map to E2B values.
 *
 * Line lists spell the same thing many ways ("Hospitalized", "Recoverd",
 * "feverr"). Each such word is decided ONCE per organization — in
 * Settings for outcomes, on the line-list page for reactions — and every
 * current and future line list reuses that decision. Nothing here is tied
 * to one source form: keys are normalized text, never column names or
 * profile ids.
 */
export type TermKind = "OUTCOME" | "REACTION";

export interface OrgTermMapping {
  id: string;
  kind: TermKind;
  /** The word as first seen in a line list. */
  term: string;
  termKey: string;
  /** OUTCOME: a ReactionOutcome. REACTION: a MedDRA LLT code. Absent until
   *  a person decides. */
  mappedValue?: string | undefined;
  /** REACTION: the LLT name for mappedValue. */
  mappedLabel?: string | undefined;
  /** A model's proposal, shown pre-selected but never applied on its own. */
  aiSuggestion?: string | undefined;
  aiSuggestionLabel?: string | undefined;
  aiConfidence?: number | undefined;
  aiReason?: string | undefined;
  firstSeenFile?: string | undefined;
  decidedBy?: string | undefined;
  decidedAt?: string | undefined;
  createdAt: string;
}

export const REACTION_OUTCOMES: readonly ReactionOutcome[] = [
  "RECOVERED",
  "RECOVERING",
  "NOT_RECOVERED",
  "RECOVERED_WITH_SEQUELAE",
  "FATAL",
  "UNKNOWN",
];

export const REACTION_OUTCOME_LABELS: Record<ReactionOutcome, string> = {
  RECOVERED: "Recovered / resolved",
  RECOVERING: "Recovering / resolving",
  NOT_RECOVERED: "Not recovered / not resolved / ongoing",
  RECOVERED_WITH_SEQUELAE: "Recovered / resolved with sequelae",
  FATAL: "Fatal",
  UNKNOWN: "Unknown",
};

/** Same key mapping.ts's mapConceptToOutcome looks up, so a saved term is
 *  found regardless of spacing, "_" or "-". */
export function outcomeTermKey(term: string): string {
  return term
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

/** Case- and spacing-insensitive, but otherwise exact: "Feverr" and
 *  "Fever" stay different words, so a typo's correction is always a
 *  recorded human decision rather than a guess. */
export function reactionTermKey(term: string): string {
  return term.trim().replace(/\s+/g, " ").toUpperCase();
}

export function termKey(kind: TermKind, term: string): string {
  return kind === "OUTCOME" ? outcomeTermKey(term) : reactionTermKey(term);
}

function isReactionOutcome(value: string | undefined): value is ReactionOutcome {
  return !!value && (REACTION_OUTCOMES as readonly string[]).includes(value);
}

/** Layers the organization's decided outcome words under the profile's own
 *  explicit outcomeMap (which still wins) — undecided words stay absent, so
 *  they keep blocking exactly as before. */
export function applyOrgOutcomeTerms(
  profile: SourceProfile,
  mappings: readonly OrgTermMapping[] | undefined,
): SourceProfile {
  const decided: Record<string, ReactionOutcome> = {};
  for (const m of mappings ?? []) {
    if (m.kind === "OUTCOME" && isReactionOutcome(m.mappedValue)) {
      decided[m.termKey] = m.mappedValue;
    }
  }
  if (Object.keys(decided).length === 0) return profile;
  return { ...profile, outcomeMap: { ...decided, ...(profile.outcomeMap ?? {}) } };
}

/** Puts the organization's confirmed reaction corrections in front of the
 *  MedDRA provider: a word a person already coded is answered from that
 *  decision; everything else goes to the dictionary as before. */
export function withOrgReactionTerms(
  provider: MedDraCodingProvider,
  mappings: readonly OrgTermMapping[] | undefined,
): MedDraCodingProvider {
  const confirmed = new Map<string, OrgTermMapping>();
  for (const m of mappings ?? []) {
    if (m.kind === "REACTION" && m.mappedValue) confirmed.set(m.termKey, m);
  }
  if (confirmed.size === 0) return provider;
  return {
    ...provider,
    async resolveReaction(verbatimText: string): Promise<CodedTerm> {
      const hit = confirmed.get(reactionTermKey(verbatimText));
      if (!hit) return provider.resolveReaction(verbatimText);
      return {
        sourceValue: verbatimText,
        status: "MAPPED",
        mappingMethod: "AUTHORIZED_MAPPING_TABLE",
        codedTerm: hit.mappedLabel ?? hit.mappedValue,
        code: hit.mappedValue,
        dictionaryVersion: provider.getVersion() ?? undefined,
      };
    },
  };
}
