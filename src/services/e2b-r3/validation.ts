import type { PVCase } from "./types";

export type ValidationSeverity = "BLOCKING" | "WARNING" | "INFO";

/** Which of the six validation layers this error belongs to — the task's
 *  explicit requirement that errors never collapse into one generic
 *  "invalid XML" bucket. See docs/E2B-R3-NAFDAC-VIGIFLOW.md's validation
 *  layers section. */
export type ValidationLayer =
  | "INPUT_SOURCE" // codebook decoding, malformed values, missing source fields
  | "CANONICAL_PV" // normalized data integrity
  | "SCHEMA" // official ICH E2B(R3) XSD (checked separately, outside this module — see serializer.ts/artifacts)
  | "BUSINESS_RULE" // required ICSR fields, validated-import requirements
  | "VIGIFLOW_PREFLIGHT" // requirements specific to the intended VigiFlow import path
  | "TRANSMISSION_CONFIG"; // sender/receiver/environment configuration

export interface ValidationError {
  code: string;
  severity: ValidationSeverity;
  layer: ValidationLayer;
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
  layer: ValidationLayer,
  message: string,
  remediation: string,
  extra?: Partial<Pick<ValidationError, "e2bField" | "sourceField" | "sourceValue">>,
): ValidationError {
  return { code, severity, layer, caseId, message, remediation, ...extra };
}

/**
 * LAYER A (INPUT_SOURCE): source-codebook decoding results. A local
 * reaction code that never resolved to a real source term (UNKNOWN_CODE),
 * a field that couldn't be confidently split (DELIMITER_QUARANTINED), or a
 * blank reaction field all block validated export here — before business
 * rules, before VigiFlow preflight, before any MedDRA coding is even
 * relevant. This function contains no reference to any specific source
 * (no "Ondo", no column names) — every message is built from the case's
 * own sourceDecoding.sourceProfileId, so it reads correctly for any
 * profile the engine is ever pointed at.
 */
export function validateSourceDecoding(pvCase: PVCase): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = pvCase.sendersCaseId;

  for (const reaction of pvCase.reactions) {
    const d = reaction.sourceDecoding;
    if (d.status === "UNKNOWN_CODE") {
      errors.push(
        err(
          id,
          "E2B-REACTION-CODEBOOK-UNRESOLVED",
          "BLOCKING",
          "INPUT_SOURCE",
          `Local reaction code "${d.localCode}" has no entry in the "${d.sourceProfileId}" source profile's reaction codebook (version "${d.codebookVersion ?? "unknown"}").`,
          `Obtain the official reaction/adverse-event codebook for source profile "${d.sourceProfileId}" and add an entry for code "${d.localCode}", or correct the source data if this is a data-entry error. Never guess what this code means.`,
          { e2bField: "E.i.1.1a", sourceField: "reaction", sourceValue: d.localCode },
        ),
      );
    } else if (d.status === "DELIMITER_QUARANTINED") {
      errors.push(
        err(
          id,
          "E2B-REACTION-DELIMITER-QUARANTINED",
          "BLOCKING",
          "INPUT_SOURCE",
          `Reaction field "${d.localCode}" could not be confidently split into individual values using source profile "${d.sourceProfileId}"'s configured delimiters.`,
          `Confirm the intended separator with the data owner, then either correct the source value or add the separator to this source profile's reactionDelimiter configuration. Never guess a split.`,
          { e2bField: "E.i.1.1a", sourceField: "reaction", sourceValue: d.localCode },
        ),
      );
    }
  }

  return errors;
}

/**
 * LAYER D (BUSINESS_RULE): the required administrative element set
 * (C.1.1, C.1.3, C.1.5, C.1.7, C.1.8, C.2.r.3, C.3.2) plus the four
 * minimum-content criteria (identifiable patient, identifiable reporter,
 * ≥1 reaction, ≥1 suspect/interacting drug). Independent of whether any
 * term is actually MedDRA/WHODrug coded — see validateVigiFlowPreflight
 * for that stricter, VigiFlow-specific layer.
 */
export function validateBusinessRules(pvCase: PVCase): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = pvCase.sendersCaseId;
  const L = "BUSINESS_RULE" as const;

  // C.1.1
  if (!pvCase.sendersCaseId.trim()) {
    errors.push(err(id, "E2B-C1.1-MISSING", "BLOCKING", L, "Case has no sender's case identifier (C.1.1).", "Ensure every row maps to a non-empty case_id, or that the fallback identifier generation ran.", { e2bField: "C.1.1" }));
  }
  // C.1.3 — gated on decision D3 (via transmission configuration)
  if (!pvCase.reportType.present) {
    errors.push(err(id, "E2B-C1.3-UNRESOLVED", "BLOCKING", L, "Report type (C.1.3) is not configured.", "Decision D3 (report type for routine AEFI surveillance) must be confirmed with NAFDAC and supplied via transmission configuration before this case can be exported.", { e2bField: "C.1.3" }));
  }
  // C.1.5
  if (!pvCase.dateMostRecentInfo) {
    errors.push(err(id, "E2B-C1.5-MISSING", "BLOCKING", L, "Date of most recent information (C.1.5) is missing.", "This should never happen from mapSourceRecordToPVCase — investigate the mapping pipeline.", { e2bField: "C.1.5" }));
  }
  // C.1.7
  if (!pvCase.fulfilsExpeditedCriteria.present) {
    errors.push(err(id, "E2B-C1.7-UNRESOLVED", "BLOCKING", L, "Whether this case fulfils local expedited-reporting criteria (C.1.7) has not been determined.", "This requires a genuine clinical/regulatory determination — define the business rule for expedited criteria (likely with NAFDAC pharmacovigilance) rather than inferring it from seriousness.", { e2bField: "C.1.7" }));
  }
  // C.1.8 (worldwide unique ID + first sender)
  if (!pvCase.worldwideUniqueId.trim()) {
    errors.push(err(id, "E2B-C1.8-MISSING", "BLOCKING", L, "Worldwide unique case identification number (C.1.8.1) is missing.", "This must be generated once and persisted — never regenerated on re-export.", { e2bField: "C.1.8.1" }));
  }
  // C.2.r.3 — reporter country, required admin info
  if (!pvCase.reporter.country) {
    errors.push(err(id, "E2B-C2r3-MISSING", "WARNING", L, "Reporter's country code (C.2.r.3) is not set.", "Populate from the active source profile's configured country, or the reporter's known jurisdiction.", { e2bField: "C.2.r.3" }));
  }
  // C.3.2 — sender organisation, gated on decision D4
  if (!pvCase.senderOrganisation) {
    errors.push(err(id, "E2B-C3.2-UNRESOLVED", "BLOCKING", L, "Sender's organisation (C.3.2) is not configured.", "Decision D4 (sender/receiver identifiers, agreed bilaterally with NAFDAC) must be resolved and supplied via transmission configuration.", { e2bField: "C.3.2" }));
  }

  // Minimum-content criteria: identifiable patient, identifiable reporter,
  // at least one reaction, at least one suspect/interacting drug.
  if (!pvCase.patient.identity.present) {
    errors.push(err(id, "E2B-PATIENT-MISSING", "BLOCKING", L, "Case has no identifiable patient (D.1).", "Ensure the source row has a patient identifier/name, or apply an explicit nullFlavor per decision D1.", { e2bField: "D.1" }));
  }
  if (!pvCase.reporter.name.present && !pvCase.reporter.qualificationVerbatim) {
    errors.push(err(id, "E2B-REPORTER-MISSING", "BLOCKING", L, "Case has no identifiable reporter (C.2.r).", "Decision D2 (who the reporter is) must be resolved — the source data alone doesn't establish an identifiable reporter.", { e2bField: "C.2.r" }));
  }
  if (pvCase.reporter.qualificationVerbatim && !pvCase.reporter.qualificationCode) {
    errors.push(
      err(
        id,
        "E2B-REPORTER-QUALIFICATION-UNRESOLVED",
        "BLOCKING",
        L,
        `Reporter designation "${pvCase.reporter.qualificationVerbatim}" has no entry in the active source profile's reporterQualificationMap.`,
        `Add "${pvCase.reporter.qualificationVerbatim}" to the active source profile's reporterQualificationMap (e.g. "Doctor" -> Physician, "Nurse" -> Other health professional), confirmed with the data owner. Never guess a qualification code.`,
        { e2bField: "C.2.r.4", sourceField: "reporter_designation", sourceValue: pvCase.reporter.qualificationVerbatim },
      ),
    );
  }
  if (pvCase.reactions.length === 0) {
    errors.push(err(id, "E2B-REACTION-MISSING", "BLOCKING", L, "Case has no reaction/event recorded.", "Add at least one reaction to this row's source data.", { e2bField: "E.i" }));
  }
  const suspectOrInteracting = pvCase.products.filter(
    (p) => p.characterization === "SUSPECT" || p.characterization === "INTERACTING",
  );
  if (suspectOrInteracting.length === 0) {
    errors.push(err(id, "E2B-PRODUCT-MISSING", "BLOCKING", L, "Case has no suspect or interacting product recorded.", "Add at least one product to this row's source data.", { e2bField: "G.k" }));
  }

  for (const reaction of pvCase.reactions) {
    if (reaction.outcomeUnmapped) {
      errors.push(err(id, "E2B-OUTCOME-UNMAPPED", "BLOCKING", L, `Outcome value "${reaction.outcomeUnmapped}" is not recognised by the active source profile's outcome vocabulary.`, "This is very likely a raw source-form code, not this app's normalised outcome vocabulary — the source's own outcome codebook must be supplied and added to the source profile before this can be mapped. Never guess.", { e2bField: "E.i.7", sourceField: "outcome", sourceValue: reaction.outcomeUnmapped }));
    }
    if (!reaction.onsetDate) {
      errors.push(err(id, "E2B-REACTION-DATE-UNPARSEABLE", "WARNING", L, `Reaction "${reaction.reaction.sourceValue}" has no parseable onset date (E.i.4 — optional, omit rather than guess).`, "Confirm whether this genuinely wasn't captured (likely NASK) or is a source-format parsing gap.", { e2bField: "E.i.4", sourceField: "onset_date" }));
    }
  }

  // C.1.9.1's "false is not a valid value" rule is enforced structurally
  // by the OtherCaseIdentifiers type itself (see types.ts) — nothing to
  // check here at runtime; it's simply unrepresentable to get wrong.

  // C.1.10 — a follow-up is represented in the serialized XML purely by
  // the presence of a linked-report identifier (see serializer.ts's
  // followUpBlock); a case marked isFollowUp:true with no reference would
  // silently serialize as an ordinary initial report, which is worse than
  // rejecting it outright.
  if (pvCase.followUp.isFollowUp && !pvCase.followUp.previousTransmissionRef) {
    errors.push(
      err(
        id,
        "E2B-C1.10-FOLLOWUP-REF-MISSING",
        "BLOCKING",
        L,
        "Case is marked as a follow-up but has no reference to the report it follows.",
        "Supply the worldwide unique case identification number (C.1.8.1) of the report this follows, or correct isFollowUp to false if this is actually a new/initial report.",
        { e2bField: "C.1.10.r" },
      ),
    );
  }

  return errors;
}

/**
 * LAYER E (VIGIFLOW_PREFLIGHT): the stricter gate for "VigiFlow / NAFDAC
 * Validated Import" mode. A genuinely MedDRA-coded reaction is required —
 * MedDRA remains non-negotiable because VigiFlow's validated-import path
 * itself requires it.
 *
 * WHODrug is deliberately NOT a blocker here (Option A, per MedNova's
 * business decision): the reported/verbatim product name is always
 * exportable on its own. Its absence is surfaced as INFO, never BLOCKING —
 * see VIGIFLOW-WHODRUG-OPTION-A-INFO below.
 */
export function validateVigiFlowPreflight(pvCase: PVCase): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = pvCase.sendersCaseId;
  const L = "VIGIFLOW_PREFLIGHT" as const;

  const codedReactions = pvCase.reactions.filter((r) => r.reaction.status === "MAPPED");
  if (codedReactions.length === 0) {
    if (pvCase.reactions.length === 0) {
      errors.push(err(id, "VIGIFLOW-MEDDRA-MISSING", "BLOCKING", L, "No reaction present to code at all.", "Add at least one reaction to this case.", { e2bField: "E.i.2.1b" }));
    }
    for (const r of pvCase.reactions) {
      if (r.sourceDecoding.status !== "DECODED") continue; // already reported by validateSourceDecoding — avoid double-blocking on the same root cause
      errors.push(err(id, "VIGIFLOW-MEDDRA-MISSING", "BLOCKING", L, "Reaction is not mapped to a valid MedDRA term.", `Decoded source term "${r.sourceDecoding.sourceTerm}" cannot be converted to MedDRA because no MedDRA dictionary/subscription is configured. A source category number must never be emitted as E.i.2.1b.`, { e2bField: "E.i.2.1b", sourceField: "reaction", sourceValue: r.reaction.sourceValue }));
    }
  }

  // WHODrug Option A: informational only, never blocking. The verbatim
  // product name is always exportable regardless of coding status.
  const suspectOrInteracting = pvCase.products.filter(
    (p) => p.characterization === "SUSPECT" || p.characterization === "INTERACTING",
  );
  const uncodedSuspectProducts = suspectOrInteracting.filter((p) => p.product.status !== "MAPPED");
  if (uncodedSuspectProducts.length > 0) {
    errors.push(
      err(
        id,
        "VIGIFLOW-WHODRUG-OPTION-A-INFO",
        "INFO",
        L,
        "WHODrug coding not configured — exporting reported product name using Option A.",
        "No action required for Option A export. If MedNova later obtains a WHODrug Global licence and the required UMC E2B(R3) extension, configure a real WhoDrugCodingProvider (see coding-provider.ts) to populate coded product data on future exports.",
        { e2bField: "G.k.2.1.1b" },
      ),
    );
  }

  if (!pvCase.reporter.qualificationVerbatim && !pvCase.reporter.qualificationCode) {
    errors.push(err(id, "VIGIFLOW-REPORTER-QUALIFICATION-MISSING", "BLOCKING", L, "No reporter qualification/designation captured.", "VigiFlow's validated import requires a reporter qualification (C.2.r.4).", { e2bField: "C.2.r.4" }));
  } else if (pvCase.reporter.qualificationVerbatim && !pvCase.reporter.qualificationCode) {
    // Same root cause as E2B-REPORTER-QUALIFICATION-UNRESOLVED in
    // validateBusinessRules — not duplicated here as a second BLOCKING
    // error, but still worth a VigiFlow-specific note for this layer.
    errors.push(err(id, "VIGIFLOW-REPORTER-QUALIFICATION-UNRESOLVED", "BLOCKING", L, `Reporter designation "${pvCase.reporter.qualificationVerbatim}" has no confirmed qualification code.`, "See E2B-REPORTER-QUALIFICATION-UNRESOLVED — resolve via the source profile's reporterQualificationMap.", { e2bField: "C.2.r.4" }));
  }

  return errors;
}

/**
 * LAYER F (TRANSMISSION_CONFIG): sender/receiver/environment values —
 * checked completely independently of case content, since a technically
 * perfect case is still not transmittable without real trading-partner
 * configuration. See transmission-config.ts.
 */
export function validateTransmissionConfig(
  caseId: string,
  gaps: string[],
): ValidationError[] {
  return gaps.map((gap) =>
    err(
      caseId,
      "TRANSMISSION-CONFIG-INCOMPLETE",
      "BLOCKING",
      "TRANSMISSION_CONFIG",
      `Transmission configuration incomplete: ${gap}`,
      "Confirm this value with NAFDAC/UMC and supply it via transmission-config.ts before validated export.",
    ),
  );
}

export function validateCase(pvCase: PVCase, mode: "BUSINESS_RULES" | "VIGIFLOW_PREFLIGHT"): CaseValidationResult {
  const errors =
    mode === "BUSINESS_RULES"
      ? [...validateSourceDecoding(pvCase), ...validateBusinessRules(pvCase)]
      : [...validateSourceDecoding(pvCase), ...validateBusinessRules(pvCase), ...validateVigiFlowPreflight(pvCase)];
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
    unknownReactionCodes: number;
    quarantinedReactionFields: number;
    /** Informational only under Option A — never contributes to `blocked`. */
    whodrugNotConfiguredInfo: number;
    missingReporter: number;
    unresolvedReporterQualification: number;
    missingPatientIdentifier: number;
    invalidDates: number;
  };
}

export function runPreflight(cases: PVCase[]): PreflightSummary {
  const results = cases.map((c) => validateCase(c, "VIGIFLOW_PREFLIGHT"));
  const blockedCases = results.filter((r) => r.blocked).length;
  const counts = {
    uncodedReactions: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "VIGIFLOW-MEDDRA-MISSING").length, 0),
    unknownReactionCodes: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "E2B-REACTION-CODEBOOK-UNRESOLVED").length, 0),
    quarantinedReactionFields: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "E2B-REACTION-DELIMITER-QUARANTINED").length, 0),
    whodrugNotConfiguredInfo: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "VIGIFLOW-WHODRUG-OPTION-A-INFO").length, 0),
    missingReporter: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "VIGIFLOW-REPORTER-QUALIFICATION-MISSING" || e.code === "E2B-REPORTER-MISSING").length, 0),
    unresolvedReporterQualification: results.reduce((n, r) => n + r.errors.filter((e) => e.code === "E2B-REPORTER-QUALIFICATION-UNRESOLVED" || e.code === "VIGIFLOW-REPORTER-QUALIFICATION-UNRESOLVED").length, 0),
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
