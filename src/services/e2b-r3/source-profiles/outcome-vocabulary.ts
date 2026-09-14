import type { ReactionOutcome } from "../types";
import type { SourceProfile } from "./types";

/**
 * A source's own words for how a reaction ended, resolved to the six
 * outcomes ICH E2B(R3) E.i.7 actually has.
 *
 * The fixed synonym dictionary in mapping.ts (CANONICAL_OUTCOME_CONCEPTS)
 * knows "Recovered", "Resolving", "Fatal" and a handful of others. Real
 * files do not write it that way. Live uploads produced "Fully better",
 * "Still recovering" and "Rétabli" — every one a plain statement of
 * outcome, every one blocking export as OUTCOME_REQUIRES_HUMAN_REVIEW
 * because no approved mapping existed for it.
 *
 * The important difference from column-header reading, where the model
 * OVERRULES the keyword table: here the deterministic dictionary wins and
 * the model only fills what it could not resolve. E.i.7 is a closed,
 * six-value regulatory codelist with an authoritative synonym set — there
 * is nothing for a model to improve on, and letting one re-decide a term
 * the dictionary already knows could turn "Died" into "Recovered". Header
 * naming is open-ended natural language; outcome vocabulary is not.
 */
export interface ResolvedOutcomeTerm {
  /** The source's word, as written. */
  term: string;
  outcome: ReactionOutcome;
  confidence: number;
  reason: string;
  /** True when the model proposed this but it was NOT applied and a person
   *  must decide — see OUTCOMES_NEVER_AUTO_APPLIED. */
  requiresConfirmation?: boolean;
  /** Set when a person rejected the proposal. The term stays in the record
   *  so it is never silently re-proposed, and is never applied. */
  rejected?: boolean;
  /** Who resolved a term that needed a person, and when. A death entered
   *  into a regulatory submission must be attributable. */
  confirmedBy?: string;
  confirmedAt?: string;
}

/** Keyed by normaliseOutcomeKey(term). */
export type OutcomeVocabulary = Record<string, ResolvedOutcomeTerm>;

/** Higher than the column-mapping floor. A wrong column mislabels a field
 *  and shows up immediately; a wrong outcome is a plausible-looking
 *  clinical claim that reaches a regulator looking exactly like a right
 *  one. */
export const AI_OUTCOME_CONFIDENCE_FLOOR = 0.8;

/**
 * FATAL is never applied from a model proposal, at any confidence.
 *
 * Both directions of error here are the worst this system can make:
 * inventing a death that did not happen, or recording one that did as
 * something milder. Neither is a data-quality annoyance — it is the
 * difference between a signal being raised and not. So the model may
 * SAY it reads a term as fatal, and that proposal is shown to a person
 * prominently, but only a person may enter it.
 */
export const OUTCOMES_NEVER_AUTO_APPLIED: readonly ReactionOutcome[] = ["FATAL"];

const VALID_OUTCOMES: readonly ReactionOutcome[] = [
  "RECOVERED",
  "RECOVERING",
  "NOT_RECOVERED",
  "RECOVERED_WITH_SEQUELAE",
  "FATAL",
  "UNKNOWN",
];

/** Same normalisation mapConceptToOutcome applies, so a term accepted here
 *  is looked up by exactly the key that function will build. */
export function normaliseOutcomeKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

export interface OutcomeProposal {
  term: string;
  outcome?: string | null;
  confidence: number;
  reason: string;
}

export interface OutcomeAcceptance {
  /** Applied to the profile, and therefore to validation and export. */
  accepted: OutcomeVocabulary;
  /** Understood but deliberately not applied — currently FATAL only. */
  pending: OutcomeVocabulary;
}

/**
 * Applies every guard to the model's proposals. Nothing here trusts the
 * response: a term the dictionary can already resolve is ignored outright,
 * an outcome outside E.i.7's six values is discarded rather than coerced,
 * and anything under the confidence floor is left for a person.
 */
export function acceptOutcomeProposals(
  proposals: OutcomeProposal[],
  /** Terms the deterministic path already resolves. Never overridden. */
  alreadyResolved: (term: string) => boolean,
): OutcomeAcceptance {
  const accepted: OutcomeVocabulary = {};
  const pending: OutcomeVocabulary = {};

  for (const p of proposals) {
    if (!p.term || !p.outcome) continue;
    const outcome = p.outcome as ReactionOutcome;
    if (!VALID_OUTCOMES.includes(outcome)) continue;
    if (p.confidence < AI_OUTCOME_CONFIDENCE_FLOOR) continue;
    if (alreadyResolved(p.term)) continue;

    const key = normaliseOutcomeKey(p.term);
    if (!key) continue;
    const entry: ResolvedOutcomeTerm = {
      term: p.term,
      outcome,
      confidence: p.confidence,
      reason: p.reason,
    };
    if (OUTCOMES_NEVER_AUTO_APPLIED.includes(outcome)) {
      pending[key] = { ...entry, requiresConfirmation: true };
    } else {
      accepted[key] = entry;
    }
  }
  return { accepted, pending };
}

/**
 * Layers an accepted vocabulary onto a profile's own outcomeMap.
 *
 * The profile's existing entries win: those were decided by a human
 * configuring that source, and a model does not get to overwrite a
 * configured mapping.
 */
export function withOutcomeVocabulary(
  profile: SourceProfile,
  vocabulary: OutcomeVocabulary | undefined,
): SourceProfile {
  const entries = Object.entries(vocabulary ?? {});
  if (entries.length === 0) return profile;
  const fromAi: Record<string, ReactionOutcome> = {};
  for (const [key, term] of entries) {
    if (term.requiresConfirmation || term.rejected) continue;
    fromAi[key] = term.outcome;
  }
  return { ...profile, outcomeMap: { ...fromAi, ...(profile.outcomeMap ?? {}) } };
}

/**
 * Records a person's decision on a term the model was not allowed to apply
 * on its own — today, one it read as fatal.
 *
 * Confirming clears requiresConfirmation, which is what actually lets the
 * outcome through withOutcomeVocabulary and unblocks the rows using it.
 * Rejecting keeps the term in the record marked `rejected`, so it is
 * neither applied nor asked about again: a person has already answered,
 * and re-proposing it every run would be pestering them with a decision
 * they made.
 *
 * Either way the actor and time are recorded. A death reaching a
 * regulatory submission has to be attributable to whoever entered it.
 */
export function decideOutcomeTerm(
  vocabulary: OutcomeVocabulary,
  key: string,
  decision: { accept: boolean; actor: string; at?: string },
): OutcomeVocabulary {
  const existing = vocabulary[key];
  if (!existing) return vocabulary;
  const decided: ResolvedOutcomeTerm = {
    ...existing,
    confirmedBy: decision.actor,
    confirmedAt: decision.at ?? new Date().toISOString(),
  };
  if (decision.accept) {
    delete decided.requiresConfirmation;
    delete decided.rejected;
  } else {
    delete decided.requiresConfirmation;
    decided.rejected = true;
  }
  return { ...vocabulary, [key]: decided };
}
