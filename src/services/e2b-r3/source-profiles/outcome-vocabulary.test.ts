import { describe, expect, it } from "vitest";
import {
  AI_OUTCOME_CONFIDENCE_FLOOR,
  acceptOutcomeProposals,
  decideOutcomeTerm,
  normaliseOutcomeKey,
  withOutcomeVocabulary,
  type OutcomeVocabulary,
} from "./outcome-vocabulary";
import { getSourceProfile } from "./registry";
import { mapConceptToOutcome } from "../mapping";

const never = () => false;
const p = (term: string, outcome: string | null, confidence = 0.95, reason = "r") => ({
  term,
  outcome,
  confidence,
  reason,
});

describe("acceptOutcomeProposals — the guards", () => {
  it("resolves the real terms that blocked live exports", () => {
    const { accepted } = acceptOutcomeProposals(
      [
        p("Fully better", "RECOVERED"),
        p("Still recovering", "RECOVERING"),
        p("Rétabli", "RECOVERED"),
      ],
      never,
    );
    expect(Object.keys(accepted)).toHaveLength(3);
    expect(accepted[normaliseOutcomeKey("Fully better")]!.outcome).toBe("RECOVERED");
    expect(accepted[normaliseOutcomeKey("Rétabli")]!.outcome).toBe("RECOVERED");
  });

  it("NEVER auto-applies FATAL, at any confidence — a person enters a death", () => {
    const { accepted, pending } = acceptOutcomeProposals([p("Died at home", "FATAL", 1)], never);
    expect(accepted).toEqual({});
    expect(pending[normaliseOutcomeKey("Died at home")]!.requiresConfirmation).toBe(true);
  });

  it("discards an outcome outside the E.i.7 six rather than coercing it", () => {
    const { accepted, pending } = acceptOutcomeProposals(
      [p("Referred", "HOSPITALISED"), p("Closed", "RESOLVED_ISH")],
      never,
    );
    expect(accepted).toEqual({});
    expect(pending).toEqual({});
  });

  it("leaves a term the model was unsure of for a human", () => {
    const { accepted } = acceptOutcomeProposals(
      [p("Improved somewhat", "RECOVERING", AI_OUTCOME_CONFIDENCE_FLOOR - 0.01)],
      never,
    );
    expect(accepted).toEqual({});
  });

  it("never re-decides a term the deterministic dictionary already resolves", () => {
    // The guard that stops "Died" being turned into anything else.
    const alreadyResolved = (t: string) => mapConceptToOutcome(t) !== undefined;
    const { accepted, pending } = acceptOutcomeProposals(
      [p("Died", "RECOVERED", 0.99), p("Recovered", "NOT_RECOVERED", 0.99)],
      alreadyResolved,
    );
    expect(accepted).toEqual({});
    expect(pending).toEqual({});
  });

  it("a null outcome is a legitimate answer and resolves nothing", () => {
    const { accepted, pending } = acceptOutcomeProposals([p("Referred to hospital", null)], never);
    expect(accepted).toEqual({});
    expect(pending).toEqual({});
  });
});

describe("withOutcomeVocabulary", () => {
  const base = getSourceProfile("ondo-aefi");

  it("makes an accepted term resolve through the normal mapping path", () => {
    const vocab: OutcomeVocabulary = {
      [normaliseOutcomeKey("Fully better")]: {
        term: "Fully better",
        outcome: "RECOVERED",
        confidence: 0.95,
        reason: "r",
      },
    };
    const profile = withOutcomeVocabulary(base, vocab);
    expect(mapConceptToOutcome("Fully better", profile)).toBe("RECOVERED");
    // and the untouched dictionary still works
    expect(mapConceptToOutcome("Recovered", profile)).toBe("RECOVERED");
  });

  it("does not apply a term awaiting human confirmation", () => {
    const vocab: OutcomeVocabulary = {
      [normaliseOutcomeKey("Passed on")]: {
        term: "Passed on",
        outcome: "FATAL",
        confidence: 0.99,
        reason: "r",
        requiresConfirmation: true,
      },
    };
    const profile = withOutcomeVocabulary(base, vocab);
    expect(mapConceptToOutcome("Passed on", profile)).toBeUndefined();
  });

  it("a mapping configured on the profile outranks the model's", () => {
    const configured = { ...base, outcomeMap: { FULLYBETTER: "RECOVERING" as const } };
    const vocab: OutcomeVocabulary = {
      FULLYBETTER: { term: "Fully better", outcome: "RECOVERED", confidence: 1, reason: "r" },
    };
    expect(mapConceptToOutcome("Fully better", withOutcomeVocabulary(configured, vocab))).toBe(
      "RECOVERING",
    );
  });

  it("an empty vocabulary returns the profile untouched", () => {
    expect(withOutcomeVocabulary(base, {})).toBe(base);
    expect(withOutcomeVocabulary(base, undefined)).toBe(base);
  });
});

describe("decideOutcomeTerm — a person answers what the model may not", () => {
  const key = normaliseOutcomeKey("Passed away at home");
  const base: OutcomeVocabulary = {
    [key]: {
      term: "Passed away at home",
      outcome: "FATAL",
      confidence: 0.99,
      reason: "The term explicitly states that the patient died.",
      requiresConfirmation: true,
    },
  };

  it("confirming is what actually lets the outcome through", () => {
    const after = decideOutcomeTerm(base, key, { accept: true, actor: "A. Coordinator" });
    expect(after[key]!.requiresConfirmation).toBeUndefined();
    expect(after[key]!.confirmedBy).toBe("A. Coordinator");
    expect(after[key]!.confirmedAt).toBeTruthy();
    const profile = withOutcomeVocabulary(getSourceProfile("ondo-aefi"), after);
    expect(mapConceptToOutcome("Passed away at home", profile)).toBe("FATAL");
  });

  it("rejecting keeps the term on record, unapplied and never re-proposed", () => {
    const after = decideOutcomeTerm(base, key, { accept: false, actor: "A. Coordinator" });
    expect(after[key]!.rejected).toBe(true);
    expect(after[key]!.requiresConfirmation).toBeUndefined();
    const profile = withOutcomeVocabulary(getSourceProfile("ondo-aefi"), after);
    expect(mapConceptToOutcome("Passed away at home", profile)).toBeUndefined();
  });

  it("does not mutate the vocabulary it was given", () => {
    decideOutcomeTerm(base, key, { accept: true, actor: "A" });
    expect(base[key]!.requiresConfirmation).toBe(true);
  });

  it("a term that is no longer there is a no-op, not a crash", () => {
    expect(decideOutcomeTerm(base, "NOSUCHTERM", { accept: true, actor: "A" })).toBe(base);
  });
});
