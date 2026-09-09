import type { PVCase } from "./types";

export type ValidationSeverity = "BLOCKING" | "WARNING";

export interface ValidationError {
  code: string;
  severity: ValidationSeverity;
  caseId: string;
  /** The E2B(R3) data element this relates to, where one applies (e.g.
   *  "E.i.2.1b" for a reaction's MedDRA term) — omitted for
   *  application-level checks with no single element. */
  e2bField?: string;
  message: string;
  sourceField?: string;
  sourceValue?: string;
  remediation: string;
}

export interface CaseValidationResult {
  caseId: string;
  errors: ValidationError[];
  blocked: boolean;
}

function err(
  caseId: string,
  code: string,
  severity: ValidationSeverity,
  message: string,
  remediation: string,
  extra?: Partial<Pick<ValidationError, "e2bField" | "sourceField" | "sourceValue">>,
): ValidationError {
  return { code, severity, caseId, message, remediation, ...extra };
}

/**
 * The required administrative element set named explicitly in
 * Ondo_AEFI_E2B_R3_Developer_Spec.docx section 9 (Acceptance criteria) and
 * section 6.3 (Minimum valid ICSR): C.1.1, C.1.3, C.1.5, C.1.7, C.1.8,
 * C.2.r.3, C.3.2 — plus the four minimum-content criteria (identifiable
 * patient, identifiable reporter, at least one reaction, at least one
 * suspect/interacting drug). Independent of whether any term is actually
 * MedDRA/WHODrug coded — see validateVigiFlowPreflight for that stricter
 * layer.
 */
export function validateBusinessRules(pvCase: PVCase): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = pvCase.sendersCaseId;

  // C.1.1
  if (!pvCase.sendersCaseId.trim()) {
    errors.push(err(id, "E2B-C1.1-MISSING", "BLOCKING", "Case has no sender's case identifier (C.1.1).", "Ensure every row maps to a non-empty case_id, or that the fallback identifier generation ran.", { e2bField: "C.1.1" }));
  }
  // C.1.3 — gated on decision D3
  if (!pvCase.reportType.present) {
    errors.push(err(id, "E2B-C1.3-UNRESOLVED", "BLOCKING", "Report type (C.1.3) is not configured.", "Decision D3 (report type for routine AEFI surveillance) must be confirmed with NAFDAC and supplied as mapping configuration before this case can be exported.", { e2bField: "C.1.3" }));
  }
  // C.1.5
  if (!pvCase.dateMostRecentInfo) {
    errors.push(err(id, "E2B-C1.5-MISSING", "BLOCKING", "Date of most recent information (C.1.5) is missing.", "This should never happen from mapRowToPVCase — investigate the mapping pipeline.", { e2bField: "C.1.5" }));
  }
  // C.1.7
  if (!pvCase.fulfilsExpeditedCriteria.present) {
    errors.push(err(id, "E2B-C1.7-UNRESOLVED", "BLOCKING", "Whether this case fulfils local expedited-reporting criteria (C.1.7) has not been determined.", "This requires a genuine clinical/regulatory determination — define the business rule for AEFI expedited criteria (likely with NAFDAC pharmacovigilance) rather than inferring it from seriousness.", { e2bField: "C.1.7" }));
  }
  // C.1.8 (worldwide unique ID + first sender)
  if (!pvCase.worldwideUniqueId.trim()) {
    errors.push(err(id, "E2B-C1.8-MISSING", "BLOCKING", "Worldwide unique case identification number (C.1.8.1) is missing.", "This must be generated once and persisted — never regenerated on re-export.", { e2bField: "C.1.8.1" }));
  }
  // C.2.r.3 — reporter country, required admin info
  if (!pvCase.reporter.country) {
    errors.push(err(id, "E2B-C2r3-MISSING", "WARNING", "Reporter's country code (C.2.r.3) is not set.", "Populate from the organisation's known jurisdiction (e.g. NG) — required administrative info per the spec.", { e2bField: "C.2.r.3" }));
  }
  // C.3.2 — sender organisation, gated on decision D4
  if (!pvCase.senderOrganisation) {
    errors.push(err(id, "E2B-C3.2-UNRESOLVED", "BLOCKING", "Sender's organisation (C.3.2) is not configured.", "Decision D4 (sender/receiver identifiers, agreed bilaterally with NAFDAC) must be resolved and supplied as mapping configuration.", { e2bField: "C.3.2" }));
  }

  // Minimum-content criteria (spec 6.3): identifiable patient, identifiable
  // reporter, at least one reaction, at least one suspect/interacting drug.
  if (!pvCase.patient.identity.present) {
    errors.push(err(id, "E2B-PATIENT-MISSING", "BLOCKING", "Case has no identifiable patient (D.1).", "Ensure the source row has a patient identifier/name, or apply an explicit nullFlavor per decision D1.", { e2bField: "D.1" }));
  }
  if (!pvCase.reporter.name.present && !pvCase.reporter.qualificationVerbatim) {
    errors.push(err(id, "E2B-REPORTER-MISSING", "BLOCKING", "Case has no identifiable reporter (C.2.r).", "Decision D2 (who the reporter is) must be resolved — the source data alone doesn't establish an identifiable reporter.", { e2bField: "C.2.r" }));
  }
  if (pvCase.reactions.length === 0) {
    errors.push(err(id, "E2B-REACTION-MISSING", "BLOCKING", "Case has no reaction/event recorded.", "Add at least one reaction to this row's source data.", { e2bField: "E.i" }));
  }
  const suspectOrInteracting = pvCase.products.filter(
    (p) => p.characterization === "SUSPECT" || p.characterization === "INTERACTING",
  );
  if (suspectOrInteracting.length === 0) {
    errors.push(err(id, "E2B-PRODUCT-MISSING", "BLOCKING", "Case has no suspect or interacting product recorded.", "Add at least one product to this row's source data.", { e2bField: "G.k" }));
  }

  for (const reaction of pvCase.reactions) {
    if (reaction.outcomeUnmapped) {
      errors.push(err(id, "E2B-OUTCOME-UNMAPPED", "BLOCKING", `Outcome value "${reaction.outcomeUnmapped}" is not one of this app's recognised outcome words.`, "This is very likely a raw source-form code (Ondo's own outcome codebook), not this app's normalised outcome vocabulary — the Ondo outcome codebook must be supplied before this can be mapped. Never guess.", { e2bField: "E.i.7", sourceField: "outcome", sourceValue: reaction.outcomeUnmapped }));
    }
    if (!reaction.onsetDate) {
      errors.push(err(id, "E2B-REACTION-DATE-UNPARSEABLE", "WARNING", `Reaction "${reaction.reaction.sourceValue}" has no parseable onset date (E.i.4 — optional, omit rather than guess).`, "Confirm whether this genuinely wasn't captured (likely NASK) or is a source-format parsing gap — see decision needed in section 6.1 of the spec.", { e2bField: "E.i.4", sourceField: "onset_date" }));
    }
  }

  // C.1.9.1's "false is not a valid value" rule is enforced structurally
  // by the OtherCaseIdentifiers type itself (see types.ts) — nothing to
  // check here at runtime; it's simply unrepresentable to get wrong.

  // C.1.10 — a follow-up is represented in the serialized XML purely by
  // the presence of a linked-report identifier (see serializer.ts's
  // followUpBlock); a case marked isFollowUp:true with no reference would
  // silently serialize as an ordinary initial report, which is worse than
  // rejecting it outright — matches PVCase.followUp's own doc comment.
  if (pvCase.followUp.isFollowUp && !pvCase.followUp.previousTransmissionRef) {
    errors.push(
      err(
        id,
        "E2B-C1.10-FOLLOWUP-REF-MISSING",
        "BLOCKING",
        "Case is marked as a follow-up but has no reference to the report it follows.",
        "Supply the worldwide unique case identification number (C.1.8.1) of the report this follows, or correct isFollowUp to false if this is actually a new/initial report.",
        { e2bField: "C.1.10.r" },
      ),
    );
  }

  return errors;
}

/**
 * The stricter gate for "VigiFlow / NAFDAC Validated Import" mode. Per the
 * spec (section 5.5/5.6) and UMC's published validated-import
 * requirements: a genuinely MedDRA-coded reaction and a genuinely
 * WHODrug-or-equivalent-coded suspect/interacting product, on top of
 * everything validateBusinessRules already checks.
 */
export function validateVigiFlowPreflight(pvCase: PVCase): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = pvCase.sendersCaseId;

  const codedReactions = pvCase.reactions.filter((r) => r.reaction.status === "MAPPED");
  if (codedReactions.length === 0) {
    if (pvCase.reactions.length === 0) {
      errors.push(err(id, "VIGIFLOW-MEDDRA-MISSING", "BLOCKING", "No reaction present to code at all.", "Add at least one reaction to this case.", { e2bField: "E.i.2.1b" }));
    }
    for (const r of pvCase.reactions) {
      errors.push(err(id, "VIGIFLOW-MEDDRA-MISSING", "BLOCKING", "Reaction is not mapped to a valid MedDRA term.", `Ondo source reaction code "${r.reaction.sourceValue}" cannot be converted to MedDRA because the official Ondo reaction codebook has not been provided, and no MedDRA dictionary/subscription (decision D5) is configured. A source category number must never be emitted as E.i.2.1b.`, { e2bField: "E.i.2.1b", sourceField: "reaction", sourceValue: r.reaction.sourceValue }));
    }
  }

  const codedProducts = pvCase.products.filter((p) => p.product.status === "MAPPED");
  if (codedProducts.length === 0) {
    const suspectOrInteracting = pvCase.products.filter(
      (p) => p.characterization === "SUSPECT" || p.characterization === "INTERACTING",
    );
    if (suspectOrInteracting.length === 0) {
      errors.push(err(id, "VIGIFLOW-WHODRUG-MISSING", "BLOCKING", "No suspect/interacting product present to code at all.", "Add at least one suspect or interacting product to this case.", { e2bField: "G.k.2.2" }));
    }
    for (const p of suspectOrInteracting) {
      errors.push(err(id, "VIGIFLOW-WHODRUG-MISSING", "BLOCKING", "Suspect/interacting product is not coded.", `Whether WHODrug coding is required by NAFDAC for "${p.product.sourceValue}" is decision D6 — unresolved. Until it is, and until a WHODrug source is licensed/configured, this product cannot be marked coded.`, { e2bField: "G.k.2.1.1b", sourceField: "product", sourceValue: p.product.sourceValue }));
    }
  }

  if (!pvCase.reporter.qualificationVerbatim && !pvCase.reporter.qualificationCode) {
    errors.push(err(id, "VIGIFLOW-REPORTER-QUALIFICATION-MISSING", "BLOCKING", "No reporter qualification/designation captured.", "VigiFlow's validated import requires a reporter qualification (C.2.r.4) — this is one of the two fields the spec identifies as currently failing validated import.", { e2bField: "C.2.r.4" }));
  }

  return errors;
}

export function validateCase(pvCase: PVCase, mode: "BUSINESS_RULES" | "VIGIFLOW_PREFLIGHT"): CaseValidationResult {
  const errors =
    mode === "BUSINESS_RULES"
      ? validateBusinessRules(pvCase)
      : [...validateBusinessRules(pvCase), ...validateVigiFlowPreflight(pvCase)];
  return {
    caseId: pvCase.sendersCaseId,
    errors,
    blocked: errors.some((e) => e.severity === "BLOCKING"),
  };
}

export interface PreflightSummary {
  totalCases: number;
  blockedCases: number;
  readyCases: number;
  status: "READY_FOR_VALIDATED_IMPORT" | "BLOCKED";
  results: CaseValidationResult[];
  counts: {
    uncodedReactions: number;
    uncodedSuspectDrugs: number;
    missingReporter: number;
    missingPatientIdentifier: number;
    invalidDates: number;
  };
}

export function runPreflight(cases: PVCase[]): PreflightSummary {
  const results = cases.map((c) => validateCase(c, "VIGIFLOW_PREFLIGHT"));
  const blockedCases = results.filter((r) => r.blocked).length;
  const counts = {
    uncodedReactions: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "VIGIFLOW-MEDDRA-MISSING").length, 0),
    uncodedSuspectDrugs: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "VIGIFLOW-WHODRUG-MISSING").length, 0),
    missingReporter: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "VIGIFLOW-REPORTER-QUALIFICATION-MISSING" || e.code === "E2B-REPORTER-MISSING").length, 0),
    missingPatientIdentifier: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "E2B-PATIENT-MISSING").length, 0),
    invalidDates: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "E2B-REACTION-DATE-UNPARSEABLE").length, 0),
  };
  return {
    totalCases: cases.length,
    blockedCases,
    readyCases: cases.length - blockedCases,
    status: blockedCases === 0 && cases.length > 0 ? "READY_FOR_VALIDATED_IMPORT" : "BLOCKED",
    results,
    counts,
  };
}
