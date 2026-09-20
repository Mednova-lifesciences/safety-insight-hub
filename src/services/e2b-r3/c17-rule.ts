import type { PVCase, PVReaction } from "./types";
import { mapSeriousness } from "./mapping";

/**
 * C.1.7 — "Does this case fulfil the local criteria for an expedited
 * report?" — expressed as data an assessor can change, not as code.
 *
 * The default is the seriousness rule every framework agrees on:
 *
 *  - ICH E2D: expedited reporting is for SERIOUS reactions (with
 *    unexpectedness and suspected causality; a spontaneous report already
 *    implies causality).
 *  - EU GVP VI: every serious report is expedited (15 days), expected or
 *    not.
 *  - NAFDAC's Good Pharmacovigilance Practice Guidelines (2021), §5.72:
 *    serious unexpected 72 hours, serious expected 15 days — so in Nigeria
 *    every serious case is expedited.
 *  - WHO/Nigeria AEFI surveillance: a serious AEFI is notified within 24
 *    hours, alongside clusters, immunization errors and events causing
 *    significant community concern.
 *
 * Seriousness is therefore the one condition that makes a case expedited
 * everywhere; frameworks differ only on what ELSE they add. Anything the
 * rule cannot settle from the data is left for a person — this file never
 * decides a case by itself, it only recommends.
 *
 * Nothing here knows any source form or column name: it reads the
 * canonical PVCase the mapping layer produces, so it works for any line
 * list.
 */

/** The six ICH/WHO seriousness criteria, plus the case-level "serious" a
 *  line list usually states in one column. */
export type C17Criterion =
  | "DEATH"
  | "LIFE_THREATENING"
  | "HOSPITALIZATION"
  | "DISABILITY"
  | "CONGENITAL_ANOMALY"
  | "MEDICALLY_IMPORTANT"
  | "SERIOUS_AS_REPORTED";

/** Vaccine-specific triggers WHO and Nigeria's AEFI programme add. A line
 *  list rarely has a column for these, so they are recognised from the
 *  file's own words when it does, and left to the reviewer otherwise. */
export type C17VaccineTrigger = "CLUSTER" | "IMMUNIZATION_ERROR" | "PUBLIC_CONCERN";

export const C17_CRITERION_LABELS: Record<C17Criterion, string> = {
  DEATH: "Results in death",
  LIFE_THREATENING: "Life-threatening",
  HOSPITALIZATION: "Needed or prolonged hospitalisation",
  DISABILITY: "Persistent or significant disability",
  CONGENITAL_ANOMALY: "Congenital anomaly or birth defect",
  MEDICALLY_IMPORTANT: "Other medically important event",
  SERIOUS_AS_REPORTED: 'The file records the case as "serious"',
};

export const C17_TRIGGER_LABELS: Record<C17VaccineTrigger, string> = {
  CLUSTER: "Cluster of events",
  IMMUNIZATION_ERROR: "Immunization error",
  PUBLIC_CONCERN: "Event causing significant community concern",
};

export interface C17Rule {
  /** Set by whoever changes the rule, e.g. "1.0". Recorded on every
   *  assessment so a decision can always be traced to the rule text that
   *  produced it. */
  version: string;
  name: string;
  jurisdiction: string;
  /** Which criteria make a case expedited. */
  criteria: Record<C17Criterion, boolean>;
  vaccineTriggers: Record<C17VaccineTrigger, boolean>;
  /** Reaction wording that counts as "other medically important" on its
   *  own (e.g. anaphylaxis, convulsion). Matched case-insensitively
   *  against the reaction's own words and its coded term. */
  medicallyImportantTerms: string[];
  /** Ask the model to read the case when the rule cannot decide from the
   *  data. Its answer is only ever a suggestion for a person. */
  aiAssistWhenUnclear: boolean;
  /** Free text the assessors keep for themselves — why the rule says what
   *  it says, who agreed it. */
  notes: string;
}

/** The rule as researched and agreed: any seriousness criterion makes the
 *  case expedited. Used until an organization saves its own. */
export const DEFAULT_C17_RULE: C17Rule = {
  version: "1.0",
  name: "Seriousness-based expedited reporting (ICH / WHO / NAFDAC)",
  jurisdiction: "NG",
  criteria: {
    DEATH: true,
    LIFE_THREATENING: true,
    HOSPITALIZATION: true,
    DISABILITY: true,
    CONGENITAL_ANOMALY: true,
    MEDICALLY_IMPORTANT: true,
    SERIOUS_AS_REPORTED: true,
  },
  vaccineTriggers: {
    CLUSTER: true,
    IMMUNIZATION_ERROR: true,
    PUBLIC_CONCERN: true,
  },
  medicallyImportantTerms: [
    "anaphylaxis",
    "anaphylactic",
    "convulsion",
    "seizure",
    "encephalopathy",
    "encephalitis",
    "meningitis",
    "acute flaccid paralysis",
    "paralysis",
    "intussusception",
    "thrombocytopenia",
    "sepsis",
    "abscess",
    "toxic shock",
  ],
  aiAssistWhenUnclear: true,
  notes:
    "Every framework checked expedites a serious case: ICH E2D, EU GVP VI, US FDA, NAFDAC GVP 2021 §5.72 (serious unexpected 72 hours, serious expected 15 days) and WHO/Nigeria AEFI surveillance (serious AEFI notified within 24 hours). Unexpectedness is deliberately not judged here: it needs the product's approved labelling, which a line list does not carry.",
};

/**
 * The medically important terms, tidied: blanks dropped, surrounding spaces
 * removed, and the same wording kept once however it was capitalised. Listing
 * a term twice changes no decision and only makes the list harder to read.
 */
export function normalizeMedicallyImportantTerms(terms: readonly string[]): string[] {
  const byWording = new Map<string, string>();
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!byWording.has(key)) byWording.set(key, trimmed);
  }
  return [...byWording.values()];
}

export type C17Recommendation = "YES" | "NO" | "NEEDS_REVIEW";

export interface C17Evidence {
  /** The criterion or trigger this supports. */
  key: C17Criterion | C17VaccineTrigger;
  label: string;
  /** What in the case says so, in the file's own words. */
  detail: string;
}

export interface C17Evaluation {
  recommendation: C17Recommendation;
  matched: C17Evidence[];
  /** Criteria the rule checked and positively ruled out. */
  unmet: string[];
  /** What the rule would have needed to decide, when it could not. */
  missingFacts: string[];
  rationale: string;
}

function reactionWords(reaction: PVReaction): string {
  return [
    reaction.reaction.sourceValue,
    reaction.reaction.codedTerm,
    reaction.sourceDecoding.sourceTerm,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Criteria the case states outright, per reaction (E.i.3.2a-f). */
function statedCriteria(pvCase: PVCase): Map<C17Criterion, string> {
  const found = new Map<C17Criterion, string>();
  for (const reaction of pvCase.reactions) {
    const c = reaction.seriousnessCriteria;
    const term = reaction.reaction.sourceValue || reaction.sourceDecoding.sourceTerm || "reaction";
    if (c.resultsInDeath) found.set("DEATH", `"${term}" is recorded as resulting in death.`);
    if (c.lifeThreatening)
      found.set("LIFE_THREATENING", `"${term}" is recorded as life-threatening.`);
    if (c.hospitalization)
      found.set(
        "HOSPITALIZATION",
        `"${term}" is recorded as needing or prolonging hospitalisation.`,
      );
    if (c.disabling) found.set("DISABILITY", `"${term}" is recorded as causing disability.`);
    if (c.congenitalAnomaly)
      found.set("CONGENITAL_ANOMALY", `"${term}" is recorded as a congenital anomaly.`);
    if (c.otherMedicallyImportant)
      found.set("MEDICALLY_IMPORTANT", `"${term}" is recorded as medically important.`);
    if (reaction.outcome === "FATAL" && !found.has("DEATH")) {
      found.set("DEATH", `The outcome of "${term}" is recorded as fatal.`);
    }
  }
  return found;
}

/**
 * Applies a rule to one case. Pure: the same case and rule always give the
 * same answer, and nothing outside the case is consulted.
 */
export function evaluateC17(pvCase: PVCase, rule: C17Rule): C17Evaluation {
  const matched: C17Evidence[] = [];
  const stated = statedCriteria(pvCase);

  for (const [key, detail] of stated) {
    if (rule.criteria[key]) {
      matched.push({ key, label: C17_CRITERION_LABELS[key], detail });
    }
  }

  // A case-level "serious" column is how most line lists state it.
  const reported = pvCase.aggregateSeriousnessAsReported?.trim();
  const reportedSerious = reported ? mapSeriousness(reported) : undefined;
  if (rule.criteria.SERIOUS_AS_REPORTED && reportedSerious === true) {
    matched.push({
      key: "SERIOUS_AS_REPORTED",
      label: C17_CRITERION_LABELS.SERIOUS_AS_REPORTED,
      detail: `The file records this case as "${reported}".`,
    });
  }

  // Reaction wording that is medically important on its own.
  if (rule.criteria.MEDICALLY_IMPORTANT && !stated.has("MEDICALLY_IMPORTANT")) {
    for (const reaction of pvCase.reactions) {
      const words = reactionWords(reaction);
      const hit = rule.medicallyImportantTerms.find(
        (term) => term.trim() && words.includes(term.trim().toLowerCase()),
      );
      if (hit) {
        matched.push({
          key: "MEDICALLY_IMPORTANT",
          label: C17_CRITERION_LABELS.MEDICALLY_IMPORTANT,
          detail: `"${reaction.reaction.sourceValue}" matches the medically important term "${hit}".`,
        });
        break;
      }
    }
  }

  // Vaccine triggers, when the file says so in its own words.
  const caseWords = [pvCase.narrative, pvCase.aggregateSeriousnessAsReported]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const triggerWords: Record<C17VaccineTrigger, RegExp> = {
    CLUSTER: /\bcluster\b/,
    IMMUNIZATION_ERROR:
      /\b(immuni[sz]ation error|vaccination error|wrong (dose|vaccine|site)|programme error)\b/,
    PUBLIC_CONCERN: /\b(public concern|community concern|parental concern)\b/,
  };
  for (const key of Object.keys(triggerWords) as C17VaccineTrigger[]) {
    if (rule.vaccineTriggers[key] && triggerWords[key].test(caseWords)) {
      matched.push({
        key,
        label: C17_TRIGGER_LABELS[key],
        detail: `The case record mentions ${C17_TRIGGER_LABELS[key].toLowerCase()}.`,
      });
    }
  }

  if (matched.length > 0) {
    return {
      recommendation: "YES",
      matched,
      unmet: [],
      missingFacts: [],
      rationale: `Meets ${matched.length === 1 ? "a criterion" : "criteria"} of "${rule.name}" (v${rule.version}): ${matched
        .map((m) => m.label.toLowerCase())
        .join("; ")}.`,
    };
  }

  // Nothing matched. Say NO only where the case actually states it is not
  // serious; silence is not evidence.
  const enabled = (Object.keys(rule.criteria) as C17Criterion[]).filter((k) => rule.criteria[k]);
  if (reportedSerious === false) {
    return {
      recommendation: "NO",
      matched: [],
      unmet: enabled.map((k) => C17_CRITERION_LABELS[k]),
      missingFacts: [],
      rationale: `The file records this case as "${reported}", and no other criterion of "${rule.name}" (v${rule.version}) is met.`,
    };
  }

  const anyCriteriaRecorded = pvCase.reactions.some((r) =>
    Object.values(r.seriousnessCriteria).some((v) => v !== undefined),
  );
  if (anyCriteriaRecorded) {
    return {
      recommendation: "NO",
      matched: [],
      unmet: enabled.map((k) => C17_CRITERION_LABELS[k]),
      missingFacts: [],
      rationale: `The case records seriousness criteria and none of them is met under "${rule.name}" (v${rule.version}).`,
    };
  }

  return {
    recommendation: "NEEDS_REVIEW",
    matched: [],
    unmet: [],
    missingFacts: [
      "The case does not say whether it is serious: no seriousness column, no seriousness criteria, and no fatal outcome.",
    ],
    rationale: `"${rule.name}" (v${rule.version}) turns on whether the case is serious, and this case does not say. A qualified reviewer must decide.`,
  };
}
