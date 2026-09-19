import type { LineListFixLocation, LineListIssue } from "@/types/pv";
import type { PVCase } from "@/services/e2b-r3/types";
import {
  E2B_NON_OVERRIDABLE_CODES,
  validateBusinessRules,
  validateSourceDecoding,
  validateVigiFlowPreflight,
  type ValidationError,
} from "@/services/e2b-r3/validation";

/**
 * Brings every E2B(R3)/VigiFlow blocker that lives in the line list's own
 * data onto the line-list page, so a person finishing there does not meet
 * new errors on the E2B page.
 *
 * The findings come from the exact engine export uses (mapJobToCases +
 * the same validate* functions) — this module only decides which of them
 * belong on the line-list page, words them for the person fixing the file,
 * and says where each is fixed. Source-agnostic: nothing here knows any
 * form, column name or source profile.
 */

/** Decided on the E2B page or in Settings, never by editing a line list. */
const NOT_A_LINELIST_CONCERN = new Set([
  "E2B-C1.3-UNRESOLVED", // report type — Settings
  "E2B-C1.7-UNRESOLVED", // expedited-criteria decision — E2B page
  "E2B-C3.2-UNRESOLVED", // sender organisation — Settings
  // Same root cause already reported by E2B-REPORTER-MISSING /
  // E2B-REPORTER-QUALIFICATION-UNRESOLVED; one finding per problem.
  "VIGIFLOW-REPORTER-QUALIFICATION-MISSING",
  "VIGIFLOW-REPORTER-QUALIFICATION-UNRESOLVED",
]);

interface Presentation {
  field?: string;
  fixIn: LineListFixLocation;
  message: (value: string) => string;
}

const PRESENTATION: Record<string, Presentation> = {
  "E2B-REACTION-CODEBOOK-UNRESOLVED": {
    field: "reaction",
    fixIn: "SOURCE_CODEBOOK",
    message: (v) =>
      `Reaction code "${v}" is not in this form's code legend, so it cannot be decoded. Correct the code, or include the form's code legend ("key") rows in the file and re-upload.`,
  },
  "E2B-REACTION-DELIMITER-QUARANTINED": {
    field: "reaction",
    fixIn: "FILE",
    message: (v) =>
      `"${v}" cannot be split into separate reactions safely. Separate distinct reactions with a comma.`,
  },
  "E2B-REACTION-MISSING": {
    field: "reaction",
    fixIn: "FILE",
    message: () => "No reaction is recorded. VigiFlow needs at least one reaction per case.",
  },
  "E2B-PRODUCT-MISSING": {
    field: "product",
    fixIn: "FILE",
    message: () => "No suspect vaccine/product is recorded. VigiFlow needs at least one.",
  },
  "E2B-PATIENT-MISSING": {
    field: "patient_identifier",
    fixIn: "FILE",
    message: () =>
      "No patient identifier (name or initials). VigiFlow needs an identifiable patient.",
  },
  "E2B-REPORTER-MISSING": {
    field: "reporter_designation",
    fixIn: "FILE",
    message: () =>
      "No reporter designation (e.g. Nurse, Doctor, Parent). VigiFlow needs to know who reported.",
  },
  "E2B-REPORTER-QUALIFICATION-UNRESOLVED": {
    field: "reporter_designation",
    fixIn: "REPORTER_DESIGNATIONS",
    message: (v) =>
      `Reporter "${v}" is not mapped to a VigiFlow qualification yet. Decide once; every line list then uses it.`,
  },
  "E2B-OUTCOME-UNMAPPED": {
    field: "outcome",
    fixIn: "SOURCE_CODEBOOK",
    message: (v) =>
      `Outcome "${v}" is a code this form's legend does not define, so it cannot be read. Correct it, or include the form's code legend in the file.`,
  },
  "E2B-OUTCOME-NOT-MAPPABLE": {
    field: "outcome",
    fixIn: "OUTCOME_TERMS",
    message: (v) =>
      `Outcome "${v}" is not one of the six E2B outcomes yet. Decide once which it means; every line list then uses it.`,
  },
  "E2B-SERIOUSNESS-CODE-UNMAPPED": {
    field: "serious_code",
    fixIn: "SOURCE_CODEBOOK",
    message: (v) =>
      `Seriousness code "${v}" is not in this form's code legend, so it cannot be read.`,
  },
  "E2B-SERIOUSNESS-CODE-NOT-MAPPABLE": {
    field: "serious_code",
    fixIn: "SOURCE_CODEBOOK",
    message: (v) =>
      `Seriousness code "${v}" does not correspond to any of the six E2B seriousness criteria.`,
  },
  "E2B-C1.10-FOLLOWUP-REF-MISSING": {
    field: "previous_case_id",
    fixIn: "FILE",
    message: () => "Marked as a follow-up, but the original report's case ID is missing.",
  },
  "VIGIFLOW-MEDDRA-MISSING": {
    field: "reaction",
    fixIn: "REACTION_TERMS",
    message: (v) =>
      `Reaction "${v}" is not a MedDRA term. Choose the right one once; every line list then uses it.`,
  },
};

/** Older line-list checks that describe the same problem as an E2B
 *  blocker. Both on one row: keep the older finding (it may carry a fix
 *  action) but give it the E2B wording, severity and fix location. */
const SAME_PROBLEM_AS: Record<string, string[]> = {
  "E2B-OUTCOME-NOT-MAPPABLE": ["OUTCOME_REQUIRES_HUMAN_REVIEW"],
  "E2B-OUTCOME-UNMAPPED": ["UNRECOGNISED_OUTCOME_VALUE"],
  "E2B-REACTION-CODEBOOK-UNRESOLVED": ["INVALID_REACTION_CODE", "REACTION_CODEBOOK_MISSING"],
  "E2B-PATIENT-MISSING": ["MISSING_PATIENT_IDENTIFIER"],
  "E2B-PRODUCT-MISSING": ["MISSING_PRODUCT"],
  "E2B-REACTION-MISSING": ["MISSING_REACTION"],
};

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;

/** Notices that part of the E2B check could not run (a service was
 *  unreachable). While one is present, "no blockers" is unproven. */
export const CHECK_INCOMPLETE_CODES = new Set([
  "MEDDRA_CHECK_UNAVAILABLE",
  "E2B_CHECK_UNAVAILABLE",
]);

export function e2bCheckIncomplete(issues: { code: string }[]): boolean {
  return issues.some((i) => CHECK_INCOMPLETE_CODES.has(i.code));
}

export interface LineListE2bCheckResult {
  issues: LineListIssue[];
  /** Words nothing could resolve, for the organization's term memory. */
  discovered: {
    outcomeTerms: string[];
    reactionTerms: string[];
    designations: string[];
  };
  /** True when the MedDRA service could not be reached, so reactions were
   *  not checked at all (reported once, not per row). */
  meddraUnavailable: boolean;
}

/**
 * @param cases     mapJobToCases output; case i is line-list row i + 1.
 * @param mapping   the job's column mapping (original header -> field), so
 *                  a finding names the column the person actually sees.
 */
export function checkCasesForE2b(
  cases: PVCase[],
  mapping: Record<string, string>,
): LineListE2bCheckResult {
  const headerFor = new Map<string, string>();
  for (const [header, field] of Object.entries(mapping)) headerFor.set(field, header);
  const columnFor = (field: string | undefined) =>
    field ? (headerFor.get(field) ?? field) : "(case)";

  const meddraUnavailable = cases.some((c) =>
    c.reactions.some((r) => r.reaction.status === "PROVIDER_UNAVAILABLE"),
  );

  const issues: LineListIssue[] = [];
  const seen = new Set<string>();
  cases.forEach((pvCase, index) => {
    const row = pvCase.sourceInformation?.sourceRow ?? index + 1;
    const errors: ValidationError[] = [
      ...validateSourceDecoding(pvCase),
      ...validateBusinessRules(pvCase),
      ...validateVigiFlowPreflight(pvCase),
    ];
    for (const e of errors) {
      if (e.severity !== "BLOCKING" || NOT_A_LINELIST_CONCERN.has(e.code)) continue;
      // Reported once for the whole file rather than on every row.
      if (e.code === "VIGIFLOW-MEDDRA-MISSING" && meddraUnavailable) continue;
      const shown = PRESENTATION[e.code];
      const field = shown?.field ?? e.sourceField;
      const value = e.sourceValue ?? "";
      const key = `${row}|${e.code}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        row,
        column: columnFor(field),
        severity: E2B_NON_OVERRIDABLE_CODES.has(e.code) ? "CRITICAL" : "HIGH",
        confidence: "HIGH",
        code: e.code,
        message: shown ? shown.message(value) : e.message,
        value: e.sourceValue ?? null,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_VALUE_INVALID",
        ...(field ? { affectedFields: [field] } : {}),
        fixable: false,
        blocksE2b: true,
        fixIn: shown?.fixIn ?? "FILE",
        ...(e.e2bField ? { e2bField: e.e2bField } : {}),
      });
    }
  });

  if (meddraUnavailable) {
    issues.push({
      row: 0,
      column: "(all reactions)",
      severity: "MEDIUM",
      confidence: "HIGH",
      code: "MEDDRA_CHECK_UNAVAILABLE",
      message:
        "Reactions could not be checked against MedDRA because the coding service was unreachable. Re-run validation once it is available; reactions that are not MedDRA terms will block E2B.",
      value: null,
      source: "rule",
      sources: ["rule"],
      fixable: false,
    });
  }

  const outcomeTerms = new Set<string>();
  const reactionTerms = new Set<string>();
  const designations = new Set<string>();
  for (const c of cases) {
    for (const r of c.reactions) {
      if (r.outcomeResolution?.status === "HUMAN_REVIEW_REQUIRED") {
        const term = r.outcomeResolution.decodedSourceValue ?? r.outcomeResolution.rawSourceValue;
        if (term) outcomeTerms.add(term);
      }
      if (r.sourceDecoding.status === "DECODED" && r.reaction.status === "UNMAPPED") {
        reactionTerms.add(r.reaction.sourceValue);
      }
    }
    if (c.reporter.qualificationVerbatim && !c.reporter.qualificationCode) {
      designations.add(c.reporter.qualificationVerbatim);
    }
  }

  return {
    issues,
    discovered: {
      outcomeTerms: [...outcomeTerms],
      reactionTerms: [...reactionTerms],
      designations: [...designations],
    },
    meddraUnavailable,
  };
}

/**
 * Merges E2B blockers into the line list's own rule findings: where an
 * older check already reports the same problem on the same row, that
 * finding is kept (with any fix action it has) and takes the E2B wording,
 * severity and fix location; otherwise the E2B finding is added.
 */
export function mergeE2bIssues(
  ruleIssues: LineListIssue[],
  e2bIssues: LineListIssue[],
): LineListIssue[] {
  const merged = ruleIssues.map((i) => ({ ...i }));
  for (const e2b of e2bIssues) {
    const equivalents = SAME_PROBLEM_AS[e2b.code] ?? [];
    const existing = merged.find((i) => i.row === e2b.row && equivalents.includes(i.code));
    if (!existing) {
      merged.push(e2b);
      continue;
    }
    existing.message = e2b.message;
    existing.blocksE2b = true;
    existing.fixIn = e2b.fixIn;
    if (e2b.e2bField) existing.e2bField = e2b.e2bField;
    if (SEVERITY_RANK[e2b.severity] > SEVERITY_RANK[existing.severity]) {
      existing.severity = e2b.severity;
    }
  }
  return merged;
}
