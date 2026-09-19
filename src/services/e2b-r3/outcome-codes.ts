import type { ReactionOutcome } from "./types";

/** Canonical ICH E2B(R3) E.i.7 values. Never source-specific or editable. */
export const E2B_OUTCOME_CODES: Readonly<Record<ReactionOutcome, string>> = {
  RECOVERED: "1",
  RECOVERING: "2",
  NOT_RECOVERED: "3",
  RECOVERED_WITH_SEQUELAE: "4",
  FATAL: "5",
  UNKNOWN: "0",
};

export function e2bOutcomeCode(outcome: ReactionOutcome): string {
  return E2B_OUTCOME_CODES[outcome];
}
