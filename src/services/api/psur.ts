import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import { isSpreadsheetFile, mapColumnsByKeywords, parseTabularFile } from "./tabular-parse";
import { ai } from "./ai";
import { RULE_BASED_DETECTION_ENABLED } from "./feature-flags";
import type {
  PsurAdministrativeCheck,
  PsurAiRecommendation,
  PsurBenefitRiskAssessment,
  PsurDeficiencyType,
  PsurDocument,
  PsurEvidenceQuality,
  PsurFinding,
  PsurIntegratedEffectsRow,
  PsurKeyRisk,
  PsurNigerianContext,
  PsurOverallBenefitRiskOutcome,
  PsurRegulatoryDecision,
  PsurRiskMinimisationAction,
  PsurScreeningResult,
  PsurSectionCoverage,
  PsurSectionStatus,
  PsurSignOff,
  PsurSpecialPopulationArea,
  PsurSpecialPopulationItem,
  PsurUncertainty,
  PsurUncertaintyCategory,
  PsurV4SectionId,
} from "@/types/pv";
import { PSUR_V4_TEMPLATE_SECTIONS } from "@/types/pv";
import type {
  AiPsurBenefitRiskOut,
  AiPsurFindingOut,
  AiPsurRecommendationOut,
  AiPsurScreeningOut,
  AiPsurSpecialPopulationItemOut,
  AiPsurNigerianContextOut,
  AiPsurUncertaintyOut,
} from "./ai";
import {
  buildAuthoritativeSectionCoverage,
  reconcileSectionFindings,
} from "@/services/psur/section-consistency";
import {
  buildComplianceDirectiveModel,
  buildExecutiveSummaryModel,
  SUGGESTED_SOURCE_LABEL,
  type ComplianceDirectiveModel,
  type ExecutiveSummaryModel,
} from "@/services/psur/document-model";
import { derivedRequiresMahAction, requiresMahAction } from "@/services/psur/finding-ownership";
import {
  buildNigerianRequirementFindings,
  nigerianExposureRequired,
} from "@/services/psur/nigeria-requirements";

/** Findings are review assistance only — the regulatory assessment is
 *  always recorded by a human reviewer (see AssistLabel in psur.tsx). */

type PsurField = "product" | "reaction" | "seriousness" | "outcome" | "case_date";

const PSUR_FIELD_KEYWORDS: Record<PsurField, [string, number][]> = {
  product: [
    ["drugnamewhodrug", 95],
    ["drugname", 90],
    ["suspectproduct", 90],
    ["medicinalproduct", 85],
    ["product", 25],
    ["drug", 20],
  ],
  reaction: [
    ["reactioneventmeddra", 95],
    ["reactionevent", 85],
    ["adverseevent", 80],
    ["reactionterm", 80],
    ["reaction", 15],
  ],
  seriousness: [
    ["seriousness", 95],
    ["serious", 30],
  ],
  outcome: [
    ["outcome", 85],
    ["resolution", 30],
    ["result", 20],
  ],
  case_date: [
    ["onsetdatetime", 90],
    ["onsetdate", 85],
    ["receiveddate", 60],
    ["reportdate", 60],
    ["date", 15],
  ],
};

const SERIOUS_VALUES = new Set(["SERIOUS", "YES", "Y"]);
const FATAL_VALUES = new Set(["FATAL"]);

interface ParsedCaseRow {
  product?: string;
  reaction?: string;
  seriousness?: string;
  outcome?: string;
  case_date?: string;
}

/** Extends the public PsurDocument shape with the raw parse a spreadsheet
 *  upload was built from, plus fix history, so findings and corrections
 *  can be computed from and applied to real content. */
interface PsurDocumentRow extends PsurDocument {
  columns?: string[];
  mapping?: Record<string, PsurField>;
  parsedRows?: ParsedCaseRow[];
  /** Every original column, keyed by its real header text, for every row
   *  — unlike parsedRows (canonical PsurField-only), nothing is dropped
   *  here. Sent to AI review/fix instead of parsedRows so a column
   *  outside the fixed field list is never invisible to the AI pass.
   *  Absent for any PSUR document not sourced from a raw spreadsheet
   *  (e.g. a PDF, which has no tabular columns to begin with). */
  rawRows?: Record<string, string>[];
  fixedAt?: string;
  fixResolvedCount?: number;
  fixUnresolvedCount?: number;
}

async function readDocument(documentId: string): Promise<PsurDocumentRow> {
  const { data, error } = await supabase
    .from("pv_psur_documents")
    .select("data")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("PSUR/PBRER document not found");
  return data.data as unknown as PsurDocumentRow;
}

async function saveDocument(doc: PsurDocumentRow): Promise<PsurDocumentRow> {
  const { error } = await supabase
    .from("pv_psur_documents")
    .update({ data: toJson(doc) })
    .eq("id", doc.id);
  if (error) throw new Error(error.message);
  return doc;
}

async function readFindings(documentId: string): Promise<PsurFinding[]> {
  const { data, error } = await supabase
    .from("pv_psur_findings")
    .select("data")
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.data as unknown as PsurFinding);
}

async function saveFinding(documentId: string, finding: PsurFinding): Promise<void> {
  const { error } = await supabase
    .from("pv_psur_findings")
    .update({ data: toJson(finding) })
    .eq("id", finding.id)
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
}

function mostCommon(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function detectReportingPeriod(rows: ParsedCaseRow[]): string {
  const dates = rows
    .map((r) => r.case_date)
    .filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)))
    .sort();
  if (dates.length === 0) return "Not yet extracted";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first! : `${first} to ${last}`;
}

function computeStats(rows: ParsedCaseRow[]) {
  return {
    totalCases: rows.length,
    seriousCases: rows.filter(
      (r) => r.seriousness && SERIOUS_VALUES.has(r.seriousness.toUpperCase()),
    ).length,
    fatalCases: rows.filter((r) => r.outcome && FATAL_VALUES.has(r.outcome.toUpperCase())).length,
    missingSeriousness: rows.filter((r) => !r.seriousness).length,
    missingOutcome: rows.filter((r) => !r.outcome).length,
  };
}

/** One AI finding -> one domain PsurFinding — shared by the PDF-upload,
 *  PDF-retry, and spreadsheet review call sites so the mapping (including
 *  the newer v4Section/deficiencyType fields) never drifts between them. */
function mapAiFinding(f: AiPsurFindingOut): PsurFinding {
  return {
    id: newId("pf"),
    category: f.category,
    severity: f.severity,
    section: f.section,
    description: f.description,
    evidence: f.evidence,
    suggestedSource: f.suggested_source ?? undefined,
    v4Section: (f.v4_section ?? undefined) as PsurV4SectionId | undefined,
    deficiencyType: (f.deficiency_type ?? undefined) as PsurDeficiencyType | undefined,
    assistGenerated: true,
    humanAssessment: null,
    source: "ai" as const,
  };
}

/** AI screening result (wire shape) -> domain PsurScreeningResult. */
function mapAiScreening(s: AiPsurScreeningOut | null | undefined): PsurScreeningResult | undefined {
  if (!s) return undefined;
  return {
    performedAt: new Date().toISOString(),
    administrativeChecks: s.administrative_checks.map((c) => ({
      id: c.id as PsurAdministrativeCheck["id"],
      label: c.label,
      status: c.status,
      comment: c.comment,
    })),
    sectionCoverage: s.section_coverage.map((c): PsurSectionCoverage => ({
      section: c.section as PsurV4SectionId,
      status: c.status,
      comment: c.comment,
      notApplicableJustification: c.not_applicable_justification ?? undefined,
      source: "ai",
    })),
    recommendation: s.recommendation,
    assistGenerated: true,
  };
}

/** AI special-populations extraction (wire shape) -> domain
 *  PsurSpecialPopulationItem[] — Section 9, PDF narrative reports only. */
function mapAiSpecialPopulations(
  list: AiPsurSpecialPopulationItemOut[] | undefined,
): PsurSpecialPopulationItem[] {
  return (list ?? []).map((p) => ({
    area: p.area as PsurSpecialPopulationArea,
    status: p.status as PsurSectionStatus,
    comment: p.comment,
    notApplicableJustification: p.not_applicable_justification ?? undefined,
    source: "ai" as const,
  }));
}

/** AI benefit-risk extraction (wire shape) -> domain PsurBenefitRiskAssessment. */
function mapAiBenefitRisk(
  b: AiPsurBenefitRiskOut | null | undefined,
): PsurBenefitRiskAssessment | undefined {
  if (!b) return undefined;
  return {
    keyBenefits: b.key_benefits.map((k) => ({
      id: newId("krb"),
      benefit: k.benefit,
      evidenceSource: k.evidence_source,
      magnitude: k.magnitude,
      evidenceQuality: k.evidence_quality as PsurEvidenceQuality,
    })),
    keyRisks: b.key_risks.map((k): PsurKeyRisk => ({
      id: newId("krk"),
      kind: k.kind === "IDENTIFIED" ? "IDENTIFIED" : "POTENTIAL",
      risk: k.risk,
      severity: k.severity,
      frequency: k.frequency,
      frequencyDataSource: k.frequency_data_source,
      reversibility: k.reversibility,
      duration: k.duration,
      preventabilityRiskManagement: k.preventability_risk_management,
      comment: k.comment,
    })),
    missingInformation: b.missing_information.map((m) => ({
      id: newId("mi"),
      missingInformation: m.missing_information,
      riskMinimisationImplication: m.risk_minimisation_implication,
    })),
    integratedEffectsTable: b.integrated_effects_table.map((r): PsurIntegratedEffectsRow => ({
      dimension: r.dimension as PsurIntegratedEffectsRow["dimension"],
      evidenceAndUncertainty: r.evidence_and_uncertainty,
      reviewerConclusion: r.reviewer_conclusion,
    })),
    patientHcpPerspective: b.patient_hcp_perspective,
    riskMinimisationEffectiveness: {
      outcome: b.risk_minimisation_effectiveness
        .outcome as PsurBenefitRiskAssessment["riskMinimisationEffectiveness"]["outcome"],
      comment: b.risk_minimisation_effectiveness.comment,
    },
    assistGenerated: true,
  };
}

/** AI uncertainties (wire shape) -> domain PsurUncertainty[]. */
/** Maps the AI's Nigeria-specific answers, defaulting every "provided" flag
 *  to FALSE when the model omitted it. A missing answer is not evidence the
 *  requirement was met — treating silence as "provided" would reinstate
 *  exactly the miss this whole mechanism exists to catch. */
function mapAiNigerianContext(
  raw: AiPsurNigerianContextOut | null | undefined,
  sourceType: "PDF" | "SPREADSHEET",
): PsurNigerianContext | undefined {
  if (!raw) return undefined;
  return {
    exposureRequired: nigerianExposureRequired(sourceType),
    nigerianExposureProvided: raw.nigerian_exposure_provided === true,
    nigerianExposureEvidence: raw.nigerian_exposure_evidence ?? undefined,
    nigerianCaseCountProvided: raw.nigerian_case_count_provided === true,
    nigerianCaseCountEvidence: raw.nigerian_case_count_evidence ?? undefined,
    vigiflowReconciliationProvided: raw.vigiflow_reconciliation_provided === true,
    vigiflowReconciliationEvidence: raw.vigiflow_reconciliation_evidence ?? undefined,
  };
}

function mapAiUncertainties(list: AiPsurUncertaintyOut[] | undefined): PsurUncertainty[] {
  return (list ?? []).map((u) => ({
    id: newId("unc"),
    category: u.category as PsurUncertaintyCategory,
    description: u.description,
    impactOnConclusion: u.impact_on_conclusion,
    addressedByMah: u.addressed_by_mah,
    rationale: u.rationale,
  }));
}

/** AI's non-binding section-12 starting point (wire shape) -> domain
 *  PsurAiRecommendation. Never conflated with PsurDocument.regulatoryDecision
 *  (the assessor's own, separate decision). */
function mapAiRecommendation(
  r: AiPsurRecommendationOut | null | undefined,
): PsurAiRecommendation | undefined {
  if (!r) return undefined;
  return {
    actions: r.actions as PsurRiskMinimisationAction[],
    overallOutcome: (r.overall_outcome ?? undefined) as PsurOverallBenefitRiskOutcome | undefined,
    basis: r.basis,
  };
}

/** Deterministic Administrative Completeness Check for when AI review is
 *  unavailable — honest about what a heuristic pass can't tell: every
 *  check reads NOT_ASSESSABLE rather than guessing YES/NO, every
 *  section's coverage reads "not assessable without AI review" rather
 *  than a fabricated present/absent judgement, and the recommendation
 *  stays PROCEED_TO_SCIENTIFIC_REVIEW (never an automatic rejection). */
function generateFallbackScreening(): PsurScreeningResult {
  return {
    performedAt: new Date().toISOString(),
    administrativeChecks: (
      [
        ["FOLLOWS_E2C_R2_TEMPLATE", "Follows the NAFDAC/ICH E2C(R2) recommended template"],
        [
          "DLP_CORRECTLY_STATED",
          "Reporting interval / Data Lock Point (DLP) correctly stated/calculated",
        ],
        [
          "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED",
          "All mandatory ICH E2C(R2) sections present, or absence justified",
        ],
        [
          "RECEIVED_WITHIN_TIMEFRAME",
          "Submission received within the required regulatory timeframe",
        ],
      ] as const
    ).map(([id, label]) => ({
      id,
      label,
      status: "NOT_ASSESSABLE" as const,
      comment: "AI review is unavailable — this requires manual administrative screening.",
    })),
    sectionCoverage: PSUR_V4_TEMPLATE_SECTIONS.map((s) => ({
      section: s.id,
      // Honest "unknown", never a claimed defect: AI review didn't run,
      // so nothing was actually confirmed missing — see PsurSectionStatus's
      // doc comment for why ASSESSOR_PENDING and MISSING must never be
      // conflated.
      status: "ASSESSOR_PENDING" as const,
      comment: "Not assessable without AI review — check manually against the V4 template.",
      source: "rule" as const,
    })),
    recommendation: "PROCEED_TO_SCIENTIFIC_REVIEW",
    assistGenerated: true,
  };
}

/**
 * Deterministic PDF fallback for when AI review is unavailable — the same
 * honesty contract as generateFallbackScreening above.
 *
 * Nothing here inspects the PDF's text (the bytes are never stored, and
 * no text was extracted on this path), so this function CANNOT know
 * whether any section is present, and must never claim otherwise. The
 * previous implementation selected sections to declare missing with
 * `(idHash + i) % 3 === 0`, asserted "X was not clearly identified in the
 * uploaded document", and cited "Expected heading not found near page N"
 * with N derived from the same hash — a fabricated deficiency carrying a
 * fabricated page citation, tagged REQUEST_FROM_MAH so it flowed into the
 * MAH-facing Compliance Directive. In a regulatory tool that is the exact
 * failure mode every other part of this module is built to prevent.
 *
 * What is honest to say without reading the document: that the automated
 * pass did not run, and that a manual section-by-section assessment
 * against the V4 template is therefore required. One advisory finding,
 * no invented specifics, no claimed absence.
 */
function generatePdfFindingsFallback(doc: PsurDocument): PsurFinding[] {
  return [
    {
      id: newId("pf"),
      category: "MISSING_SECTION",
      severity: "MEDIUM",
      section: "Whole submission — automated review unavailable",
      description:
        "AI review did not run for this document, so no automated section-by-section assessment " +
        "was performed. This is not a finding about the submission's content: nothing has been " +
        "confirmed present or absent. Assess every section manually against the NAFDAC V4 template.",
      evidence: `No automated review result is available for ${doc.filename}.`,
      suggestedSource: {
        type: "OTHER",
        note: "Work through the 13 V4 template sections manually and record each section's status in the Section Coverage panel above.",
      },
      deficiencyType: "INADEQUATE_EVIDENCE",
      assistGenerated: true,
      humanAssessment: null,
      source: "rule",
    },
  ];
}

function generateSpreadsheetFindingsFallback(doc: PsurDocumentRow): PsurFinding[] {
  const rows = doc.parsedRows ?? [];
  const stats = computeStats(rows);
  const findings: PsurFinding[] = [];

  findings.push({
    id: newId("pf"),
    category: "NUMERICAL",
    severity: "LOW",
    section: "Cumulative case counts",
    description: `This tabulation contains ${stats.totalCases} case(s): ${stats.seriousCases} flagged serious, ${stats.fatalCases} with a fatal outcome.`,
    evidence: `Computed directly from ${doc.filename} (${stats.totalCases} data row(s), reporting period ${doc.reportingPeriod}).`,
    assistGenerated: true,
    humanAssessment: null,
    source: "rule",
  });

  if (stats.missingSeriousness > 0) {
    findings.push({
      id: newId("pf"),
      category: "CONSISTENCY",
      severity: stats.missingSeriousness === rows.length ? "HIGH" : "MEDIUM",
      section: "Seriousness classification",
      description: `${stats.missingSeriousness} of ${rows.length} case(s) have no seriousness value recorded in the tabulation.`,
      evidence: "Rows with a blank seriousness column.",
      assistGenerated: true,
      humanAssessment: null,
      source: "rule",
    });
  }

  if (stats.missingOutcome > 0) {
    findings.push({
      id: newId("pf"),
      category: "CONSISTENCY",
      severity: stats.missingOutcome === rows.length ? "HIGH" : "MEDIUM",
      section: "Outcome classification",
      description: `${stats.missingOutcome} of ${rows.length} case(s) have no outcome value recorded in the tabulation.`,
      evidence: "Rows with a blank outcome column.",
      assistGenerated: true,
      humanAssessment: null,
      source: "rule",
    });
  }

  findings.push({
    id: newId("pf"),
    category: "BENEFIT_RISK",
    severity: "LOW",
    section: "Benefit-risk analysis",
    description: `Confirm the benefit-risk conclusion for ${doc.product} reflects any safety signals identified elsewhere in this system.`,
    evidence: "Cross-reference with the Signals workspace before finalising.",
    suggestedSource: {
      type: "PUBLISHED_LITERATURE",
      note: "Cross-reference against the current RSI/SmPC and any recent published literature on this product before finalising the benefit-risk conclusion.",
    },
    assistGenerated: true,
    humanAssessment: null,
    source: "rule",
  });

  return findings;
}

/**
 * Re-runs the section/finding reconciliation guarantee after an assessor
 * edit that can CHANGE a derived section status, and persists whatever it
 * synthesizes.
 *
 * Sections 9-13's coverage status is derived from their own structured
 * data (see section-consistency.ts), so saving Section 9/10/11 can flip a
 * section to MISSING or PRESENT_BUT_INCOMPLETE long after the upload-time
 * reconciliation ran. Without this, the invariant that module exists to
 * enforce — "every deficient section has a corresponding actionable
 * finding" — held only for the AI's original judgement and broke the
 * moment a human corrected it. The visible symptom was the Section
 * Coverage panel printing its own "No corresponding finding yet — this
 * should not happen" diagnostic, with the deficiency then unable to be
 * accepted and therefore never reaching the Compliance Directive.
 *
 * reconcileSectionFindings is idempotent (it no-ops for any section that
 * already has a finding), so this is always safe to call on every save.
 */
async function reconcileAfterAssessorEdit(doc: PsurDocumentRow): Promise<void> {
  const existing = await readFindings(doc.id);
  const synthesized = reconcileSectionFindings(buildAuthoritativeSectionCoverage(doc), existing);
  if (synthesized.length === 0) return;
  await persistFindings(doc.id, synthesized);
}

async function persistFindings(documentId: string, findings: PsurFinding[]): Promise<void> {
  if (findings.length === 0) return;
  const { error } = await supabase
    .from("pv_psur_findings")
    .insert(findings.map((f) => ({ id: f.id, document_id: documentId, data: toJson(f) })));
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Document generation (Executive Summary / Compliance Directive). Both
// render from the SAME pure model (services/psur/document-model.ts),
// built from the SAME authoritative saved state (buildAuthoritativeSectionCoverage,
// the real findings list, the assessor's own Section 9-13 records) every
// other part of this file and the assessment page read — never a second,
// independent interpretation invented at export time.
// ---------------------------------------------------------------------

function docBaseName(doc: PsurDocument): string {
  return doc.filename.replace(/\.[^.]+$/, "");
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DOC_DISCLAIMER =
  "System-generated draft for assessor review. This is NOT an official NAFDAC-issued document unless separately approved and issued through NAFDAC's formal process.";

function renderExecutiveSummaryText(m: ExecutiveSummaryModel): string {
  const lines: string[] = [];
  const rule = "-".repeat(60);
  lines.push("PSUR/PBRER EXECUTIVE SUMMARY (INTERNAL / ASSESSOR-FACING)");
  lines.push("=".repeat(60));
  lines.push(DOC_DISCLAIMER);
  lines.push("");
  lines.push(`Document: ${m.meta.filename}`);
  lines.push(`Internal reference: ${m.meta.documentId}`);
  lines.push(`Product: ${m.meta.product}`);
  lines.push(`Marketing Authorisation Holder (MAH): ${m.meta.mah}`);
  lines.push(`Reporting period: ${m.meta.reportingPeriod}`);
  lines.push(`Uploaded by: ${m.meta.uploadedBy} on ${m.meta.uploadedAtLabel}`);
  lines.push(`Assessment status: ${m.meta.stage}`);
  lines.push(`Generated: ${m.meta.generatedAtLabel}`);
  lines.push("");

  lines.push("ADMINISTRATIVE COMPLETENESS CHECK");
  lines.push(rule);
  if (m.administrative) {
    lines.push(`AI recommendation: ${m.administrative.aiRecommendation}`);
    lines.push(
      m.administrative.assessorDecision
        ? `Assessor decision: ${m.administrative.assessorDecision.decision} (${m.administrative.assessorDecision.by}, ${fmtDateLocal(m.administrative.assessorDecision.at)}) — ${m.administrative.assessorDecision.rationale}`
        : "Assessor decision: not yet recorded.",
    );
    for (const c of m.administrative.checks) {
      lines.push(`  [${c.status}] ${c.label} — ${c.comment}`);
    }
  } else {
    lines.push("Not yet run for this document.");
  }
  lines.push("");

  lines.push("SECTION COVERAGE (authoritative — matches the assessment page)");
  lines.push(rule);
  for (const c of m.sectionCoverage) {
    const name = PSUR_V4_TEMPLATE_SECTIONS.find((s) => s.id === c.section)?.name ?? c.section;
    lines.push(
      `[${c.status}] ${name}${c.notApplicableJustification ? ` — N/A: ${c.notApplicableJustification}` : ""}`,
    );
  }
  lines.push("");

  lines.push("FINDINGS OVERVIEW");
  lines.push(rule);
  lines.push(`Total findings detected: ${m.findings.total}`);
  lines.push(
    `Accepted: ${m.findings.accepted} (HIGH ${m.findings.acceptedBySeverity.HIGH} / MEDIUM ${m.findings.acceptedBySeverity.MEDIUM} / LOW ${m.findings.acceptedBySeverity.LOW})`,
  );
  lines.push(`  Requiring MAH action: ${m.findings.mahActionCount}`);
  lines.push(`  Assessor-internal: ${m.findings.assessorInternalCount}`);
  lines.push(`  Resolved: ${m.findings.resolvedCount}`);
  lines.push(`  Still outstanding: ${m.findings.outstandingCount}`);
  lines.push(`Dismissed: ${m.findings.dismissed}`);
  lines.push(`Still pending review: ${m.findings.pending}`);
  lines.push("");

  lines.push("ACCEPTED FINDINGS (detail)");
  lines.push(rule);
  if (m.findings.acceptedFindings.length === 0) {
    lines.push("No findings have been accepted yet.");
  }
  for (const f of m.findings.acceptedFindings) {
    const mahTag = requiresMahAction(f) ? "MAH action needed" : "assessor-internal";
    lines.push(
      `  [${f.severity}] ${f.section} — ${mahTag} — ${f.resolved ? "RESOLVED" : "OUTSTANDING"}`,
    );
    lines.push(`    ${f.description}`);
    lines.push(`    Evidence: ${f.evidence}`);
    if (f.rationale) lines.push(`    Reviewer rationale: ${f.rationale}`);
    if (f.resolved && f.resolution) lines.push(`    Resolution: ${f.resolution}`);
  }
  lines.push("");

  lines.push("SECTION 10 — BENEFIT-RISK ASSESSMENT");
  lines.push(rule);
  if (m.benefitRisk.recorded && m.benefitRisk.data) {
    const b = m.benefitRisk.data;
    lines.push(
      `Status: ${m.benefitRisk.assessorOwned ? "reviewed/edited by assessor" : "AI draft, not yet reviewed by assessor"}`,
    );
    lines.push(`Key benefits recorded: ${b.keyBenefits.length}`);
    lines.push(
      `Key risks recorded: ${b.keyRisks.length} (${b.keyRisks.filter((k) => k.kind === "IDENTIFIED").length} identified / ${b.keyRisks.filter((k) => k.kind === "POTENTIAL").length} potential)`,
    );
    lines.push(`Missing-information items: ${b.missingInformation.length}`);
    lines.push(
      `Risk minimisation effectiveness: ${b.riskMinimisationEffectiveness.outcome}${b.riskMinimisationEffectiveness.comment ? ` — ${b.riskMinimisationEffectiveness.comment}` : ""}`,
    );
  } else {
    lines.push("Not yet recorded.");
  }
  lines.push("");

  lines.push("SECTION 11 — UNCERTAINTIES AFFECTING THE BENEFIT-RISK ASSESSMENT");
  lines.push(rule);
  if (m.uncertainties.status === "CONFIRMED_NONE" && m.uncertainties.noneConfirmed) {
    lines.push(
      `Assessor confirmed no uncertainties apply this interval (${m.uncertainties.noneConfirmed.by}, ${fmtDateLocal(m.uncertainties.noneConfirmed.at)}).`,
    );
  } else if (m.uncertainties.status === "RECORDED") {
    for (const u of m.uncertainties.items) {
      lines.push(
        `  ${u.category.replaceAll("_", " ")} — impact: ${u.impactOnConclusion}, addressed by MAH: ${u.addressedByMah}`,
      );
      lines.push(`    ${u.description}`);
    }
  } else {
    lines.push("Not yet recorded — Section 11 is still outstanding.");
  }
  lines.push(
    m.uncertainties.evaluatorComments
      ? `Evaluator's comments: ${m.uncertainties.evaluatorComments}`
      : "Evaluator's comments: not yet recorded.",
  );
  lines.push("");

  lines.push("SECTION 12 — REGULATORY DECISION & RECOMMENDED ACTIONS");
  lines.push(rule);
  if (m.regulatoryDecision) {
    lines.push("Assessor's own decision (never AI-decided):");
    lines.push(`  Overall outcome: ${m.regulatoryDecision.overallOutcome ?? "not set"}`);
    lines.push(`  Actions: ${m.regulatoryDecision.actions.join(", ") || "none recorded"}`);
    lines.push(`  Basis: ${m.regulatoryDecision.basis}`);
    lines.push(
      `  Specific safety/benefit-risk finding supporting the recommendation: ${
        m.regulatoryDecision.supportingFinding?.trim() || "not recorded"
      }`,
    );
    lines.push(
      `  Decided by: ${m.regulatoryDecision.decidedBy} on ${fmtDateLocal(m.regulatoryDecision.decidedAt)}`,
    );
  } else {
    lines.push("Not yet recorded by the assessor.");
    if (m.aiRecommendation) {
      lines.push(
        `  AI SUGGESTION ONLY (non-binding, not a decision): ${m.aiRecommendation.overallOutcome ?? "no outcome suggested"}${m.aiRecommendation.actions.length ? ` — ${m.aiRecommendation.actions.join(", ")}` : ""}`,
      );
      if (m.aiRecommendation.basis) lines.push(`  Basis: ${m.aiRecommendation.basis}`);
    }
  }
  lines.push("");

  lines.push("SECTION 13 — CONCLUSION, SIGN-OFF & DOCUMENT CONTROL");
  lines.push(rule);
  if (m.signOff) {
    lines.push(`Conclusion: ${m.signOff.conclusion}`);
    lines.push(`Reviewer confidence: ${m.signOff.reviewerConfidence ?? "not set"}`);
    if (m.signOff.references) lines.push(`References: ${m.signOff.references}`);
    lines.push(
      `Evaluator: ${m.signOff.evaluatorName ?? "not yet signed"}${m.signOff.evaluatorSignedAt ? ` (${fmtDateLocal(m.signOff.evaluatorSignedAt)})` : ""}`,
    );
    lines.push(
      `Peer reviewer: ${m.signOff.peerReviewerName ?? "not yet signed"}${m.signOff.peerReviewedAt ? ` (${fmtDateLocal(m.signOff.peerReviewedAt)})` : ""}`,
    );
  } else {
    lines.push("Not yet recorded — Section 13 is still outstanding.");
  }

  return lines.join("\n");
}

function fmtDateLocal(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

function renderComplianceDirectiveText(m: ComplianceDirectiveModel): string {
  const lines: string[] = [];
  const rule = "-".repeat(60);
  lines.push("PSUR/PBRER COMPLIANCE DIRECTIVE (DRAFT)");
  lines.push("=".repeat(60));
  lines.push(DOC_DISCLAIMER);
  lines.push("");
  lines.push(`Product: ${m.meta.product}`);
  lines.push(`Marketing Authorisation Holder (MAH): ${m.meta.mah}`);
  lines.push(`Reporting period: ${m.meta.reportingPeriod}`);
  lines.push(`Document reference: ${m.meta.filename} (internal ref: ${m.meta.documentId})`);
  lines.push(`Date generated: ${m.meta.generatedAtLabel}`);
  lines.push("");
  lines.push("INTRODUCTION");
  lines.push(rule);
  lines.push(m.introduction);
  lines.push("");
  lines.push(`DEFICIENCIES REQUIRING MAH ACTION (${m.deficiencies.length})`);
  lines.push(rule);
  if (m.deficiencies.length === 0) {
    lines.push("No outstanding MAH-facing deficiencies at this time.");
  }
  for (const d of m.deficiencies) {
    lines.push(
      `${d.referenceNo} — ${d.v4SectionLabel} [${d.severity}]${d.deficiencyType ? ` (${d.deficiencyType})` : ""}`,
    );
    lines.push(`  What was identified: ${d.whatWasIdentified}`);
    lines.push(`  Why this matters: ${d.whyMaterial}`);
    lines.push(`  Required action: ${d.requiredAction}`);
    if (d.assessorObservation) lines.push(`  Assessor observation: ${d.assessorObservation}`);
    if (d.suggestedSource)
      lines.push(`  Suggested source: ${d.suggestedSource.label} — ${d.suggestedSource.note}`);
    if (d.ownershipOverride)
      lines.push(
        `  Referred to the MAH by assessor decision: ${d.ownershipOverride.by} on ${d.ownershipOverride.atLabel} — ${d.ownershipOverride.rationale}`,
      );
    lines.push(`  Status: ${d.status}`);
    lines.push("");
  }
  if (m.regulatoryContext) {
    lines.push("REGULATORY CONTEXT");
    lines.push(rule);
    lines.push(`Overall benefit-risk outcome: ${m.regulatoryContext.overallOutcome}`);
    lines.push(`Actions requested of the MAH: ${m.regulatoryContext.mahFacingActions.join(", ")}`);
    lines.push(`Basis: ${m.regulatoryContext.basis}`);
    lines.push(
      `Decided by: ${m.regulatoryContext.decidedBy} on ${m.regulatoryContext.decidedAtLabel}`,
    );
    lines.push("");
  }

  // Response deadline and next-PSUR date are separate obligations and are
  // never derived from one another; each appears only when recorded.
  if (m.followUp.responseDeadline || m.followUp.nextPsurDueDate || m.followUp.informationRequired) {
    lines.push("REQUIRED FOLLOW-UP");
    lines.push(rule);
    if (m.followUp.informationRequired) {
      lines.push(`Information required: ${m.followUp.informationRequired}`);
    }
    lines.push(
      `Response deadline: ${m.followUp.responseDeadline ?? "not specified in this directive"}`,
    );
    lines.push(`Next PSUR/PBRER due date: ${m.followUp.nextPsurDueDate ?? "not yet determined"}`);
    lines.push("");
  }

  lines.push("ASSESSED BY");
  lines.push(rule);
  lines.push(`Evaluator / Assessing Officer: ${m.signatory.evaluatorName ?? "pending signature"}`);
  lines.push(`Date: ${m.signatory.evaluatorSignedAtLabel ?? "pending"}`);
  lines.push(`Signature: ${m.signatory.evaluatorName ? "recorded electronically" : "pending"}`);
  lines.push("");
  lines.push(`Peer reviewer: ${m.signatory.peerReviewerName ?? "pending signature"}`);
  lines.push(`Date: ${m.signatory.peerReviewedAtLabel ?? "pending"}`);
  lines.push(`Signature: ${m.signatory.peerReviewerName ? "recorded electronically" : "pending"}`);
  lines.push("");
  lines.push(
    `Note: ${m.resolvedCount} previously-identified deficiency/deficiencies already resolved and ${m.dismissedCount} finding(s) dismissed as not applicable are not restated in this directive.`,
  );
  return lines.join("\n");
}

function docxHeading(
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1,
): Paragraph {
  return new Paragraph({ text, heading: level });
}

function docxLabelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })],
  });
}

function buildExecutiveSummaryDocx(m: ExecutiveSummaryModel): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: "PSUR/PBRER Executive Summary", heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: DOC_DISCLAIMER, italics: true })] }),
    new Paragraph({ text: "" }),
    docxLabelValue("Document", m.meta.filename),
    docxLabelValue("Product", m.meta.product),
    docxLabelValue("Marketing Authorisation Holder (MAH)", m.meta.mah),
    docxLabelValue("Reporting period", m.meta.reportingPeriod),
    docxLabelValue("Uploaded by", `${m.meta.uploadedBy} on ${m.meta.uploadedAtLabel}`),
    docxLabelValue("Assessment status", m.meta.stage),
    docxLabelValue("Generated", m.meta.generatedAtLabel),
    new Paragraph({ text: "" }),

    docxHeading("Administrative Completeness Check"),
    ...(m.administrative
      ? [
          docxLabelValue("AI recommendation", m.administrative.aiRecommendation),
          docxLabelValue(
            "Assessor decision",
            m.administrative.assessorDecision
              ? `${m.administrative.assessorDecision.decision} (${m.administrative.assessorDecision.by}, ${fmtDateLocal(m.administrative.assessorDecision.at)}) — ${m.administrative.assessorDecision.rationale}`
              : "not yet recorded",
          ),
          ...m.administrative.checks.map(
            (c) => new Paragraph({ text: `[${c.status}] ${c.label} — ${c.comment}` }),
          ),
        ]
      : [new Paragraph({ text: "Not yet run for this document." })]),
    new Paragraph({ text: "" }),

    docxHeading("Section Coverage"),
    new Paragraph({
      children: [
        new TextRun({ text: "Authoritative — matches the assessment page.", italics: true }),
      ],
    }),
    ...m.sectionCoverage.map((c) => {
      const name = PSUR_V4_TEMPLATE_SECTIONS.find((s) => s.id === c.section)?.name ?? c.section;
      return new Paragraph({
        text: `[${c.status}] ${name}${c.notApplicableJustification ? ` — N/A: ${c.notApplicableJustification}` : ""}`,
      });
    }),
    new Paragraph({ text: "" }),

    docxHeading("Findings Overview"),
    new Paragraph({ text: `Total findings detected: ${m.findings.total}` }),
    new Paragraph({
      text: `Accepted: ${m.findings.accepted} (HIGH ${m.findings.acceptedBySeverity.HIGH} / MEDIUM ${m.findings.acceptedBySeverity.MEDIUM} / LOW ${m.findings.acceptedBySeverity.LOW})`,
    }),
    new Paragraph({ text: `  Requiring MAH action: ${m.findings.mahActionCount}` }),
    new Paragraph({ text: `  Assessor-internal: ${m.findings.assessorInternalCount}` }),
    new Paragraph({ text: `  Resolved: ${m.findings.resolvedCount}` }),
    new Paragraph({ text: `  Still outstanding: ${m.findings.outstandingCount}` }),
    new Paragraph({ text: `Dismissed: ${m.findings.dismissed}` }),
    new Paragraph({ text: `Still pending review: ${m.findings.pending}` }),
    new Paragraph({ text: "" }),

    docxHeading("Accepted Findings (detail)"),
    ...(m.findings.acceptedFindings.length === 0
      ? [new Paragraph({ text: "No findings have been accepted yet." })]
      : m.findings.acceptedFindings.flatMap((f) => {
          const mahTag = requiresMahAction(f) ? "MAH action needed" : "assessor-internal";
          return [
            new Paragraph({
              children: [
                new TextRun({
                  text: `[${f.severity}] ${f.section} — ${mahTag} — ${f.resolved ? "RESOLVED" : "OUTSTANDING"}`,
                  bold: true,
                }),
              ],
            }),
            new Paragraph({ text: f.description }),
            new Paragraph({
              children: [new TextRun({ text: `Evidence: ${f.evidence}`, italics: true })],
            }),
            ...(f.rationale ? [new Paragraph({ text: `Reviewer rationale: ${f.rationale}` })] : []),
            ...(f.resolved && f.resolution
              ? [new Paragraph({ text: `Resolution: ${f.resolution}` })]
              : []),
            new Paragraph({ text: "" }),
          ];
        })),

    docxHeading("10. Benefit-Risk Assessment"),
    ...(m.benefitRisk.recorded && m.benefitRisk.data
      ? [
          new Paragraph({
            text: `Status: ${m.benefitRisk.assessorOwned ? "reviewed/edited by assessor" : "AI draft, not yet reviewed by assessor"}`,
          }),
          new Paragraph({
            text: `Key benefits recorded: ${m.benefitRisk.data.keyBenefits.length}`,
          }),
          new Paragraph({ text: `Key risks recorded: ${m.benefitRisk.data.keyRisks.length}` }),
          new Paragraph({
            text: `Missing-information items: ${m.benefitRisk.data.missingInformation.length}`,
          }),
          new Paragraph({
            text: `Risk minimisation effectiveness: ${m.benefitRisk.data.riskMinimisationEffectiveness.outcome}`,
          }),
        ]
      : [new Paragraph({ text: "Not yet recorded." })]),
    new Paragraph({ text: "" }),

    docxHeading("11. Uncertainties Affecting the Benefit-Risk Assessment"),
    ...(m.uncertainties.status === "CONFIRMED_NONE" && m.uncertainties.noneConfirmed
      ? [
          new Paragraph({
            text: `Assessor confirmed no uncertainties apply this interval (${m.uncertainties.noneConfirmed.by}, ${fmtDateLocal(m.uncertainties.noneConfirmed.at)}).`,
          }),
        ]
      : m.uncertainties.status === "RECORDED"
        ? m.uncertainties.items.map(
            (u) =>
              new Paragraph({
                text: `${u.category.replaceAll("_", " ")} — impact: ${u.impactOnConclusion}, addressed by MAH: ${u.addressedByMah} — ${u.description}`,
              }),
          )
        : [new Paragraph({ text: "Not yet recorded — Section 11 is still outstanding." })]),
    new Paragraph({
      text: m.uncertainties.evaluatorComments
        ? `Evaluator's comments: ${m.uncertainties.evaluatorComments}`
        : "Evaluator's comments: not yet recorded.",
    }),
    new Paragraph({ text: "" }),

    docxHeading("12. Regulatory Decision & Recommended Actions"),
    ...(m.regulatoryDecision
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Assessor's own decision (never AI-decided):", bold: true }),
            ],
          }),
          new Paragraph({
            text: `Overall outcome: ${m.regulatoryDecision.overallOutcome ?? "not set"}`,
          }),
          new Paragraph({
            text: `Actions: ${m.regulatoryDecision.actions.join(", ") || "none recorded"}`,
          }),
          new Paragraph({ text: `Basis: ${m.regulatoryDecision.basis}` }),
          new Paragraph({
            text: `Specific safety/benefit-risk finding supporting the recommendation: ${
              m.regulatoryDecision.supportingFinding?.trim() || "not recorded"
            }`,
          }),
          new Paragraph({
            text: `Decided by: ${m.regulatoryDecision.decidedBy} on ${fmtDateLocal(m.regulatoryDecision.decidedAt)}`,
          }),
        ]
      : [
          new Paragraph({ text: "Not yet recorded by the assessor." }),
          ...(m.aiRecommendation
            ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `AI suggestion only (non-binding, not a decision): ${m.aiRecommendation.overallOutcome ?? "no outcome suggested"}`,
                      italics: true,
                    }),
                  ],
                }),
              ]
            : []),
        ]),
    new Paragraph({ text: "" }),

    docxHeading("13. Conclusion, Sign-off & Document Control"),
    ...(m.signOff
      ? [
          new Paragraph({ text: `Conclusion: ${m.signOff.conclusion}` }),
          new Paragraph({
            text: `Reviewer confidence: ${m.signOff.reviewerConfidence ?? "not set"}`,
          }),
          new Paragraph({
            text: `Evaluator: ${m.signOff.evaluatorName ?? "not yet signed"}`,
          }),
          new Paragraph({
            text: `Peer reviewer: ${m.signOff.peerReviewerName ?? "not yet signed"}`,
          }),
        ]
      : [new Paragraph({ text: "Not yet recorded — Section 13 is still outstanding." })]),
  ];

  return new Document({ sections: [{ properties: {}, children }] });
}

function buildComplianceDirectiveDocx(m: ComplianceDirectiveModel): Document {
  const headerCell = (text: string) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] });
  const cell = (text: string) => new TableCell({ children: [new Paragraph(text)] });

  const table =
    m.deficiencies.length > 0
      ? new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                headerCell("Ref."),
                headerCell("V4 Section"),
                headerCell("Severity"),
                headerCell("What was identified / why it matters"),
                headerCell("Required action"),
                headerCell("Status"),
              ],
            }),
            ...m.deficiencies.map(
              (d) =>
                new TableRow({
                  children: [
                    cell(d.referenceNo),
                    cell(d.v4SectionLabel),
                    cell(d.severity),
                    cell(`${d.whatWasIdentified}\n\nEvidence: ${d.whyMaterial}`),
                    cell(
                      d.requiredAction +
                        (d.suggestedSource
                          ? `\n\nSuggested source: ${d.suggestedSource.label} — ${d.suggestedSource.note}`
                          : "") +
                        (d.assessorObservation
                          ? `\n\nAssessor observation: ${d.assessorObservation}`
                          : "") +
                        (d.ownershipOverride
                          ? `\n\nReferred to the MAH by assessor decision: ${d.ownershipOverride.by} on ${d.ownershipOverride.atLabel} — ${d.ownershipOverride.rationale}`
                          : ""),
                    ),
                    cell(d.status),
                  ],
                }),
            ),
          ],
        })
      : new Paragraph({ text: "No outstanding MAH-facing deficiencies at this time." });

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: "PSUR/PBRER Compliance Directive", heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: DOC_DISCLAIMER, italics: true })] }),
    new Paragraph({ text: "" }),
    docxLabelValue("Product", m.meta.product),
    docxLabelValue("Marketing Authorisation Holder (MAH)", m.meta.mah),
    docxLabelValue("Reporting period", m.meta.reportingPeriod),
    docxLabelValue("Document reference", `${m.meta.filename} (internal ref: ${m.meta.documentId})`),
    docxLabelValue("Date generated", m.meta.generatedAtLabel),
    new Paragraph({ text: "" }),
    docxHeading("Introduction"),
    new Paragraph({ text: m.introduction }),
    new Paragraph({ text: "" }),
    docxHeading(`Deficiencies Requiring MAH Action (${m.deficiencies.length})`),
    table,
    new Paragraph({ text: "" }),
  ];

  if (m.regulatoryContext) {
    children.push(
      docxHeading("Regulatory Context"),
      new Paragraph({
        text: `Overall benefit-risk outcome: ${m.regulatoryContext.overallOutcome}`,
      }),
      new Paragraph({
        text: `Actions requested of the MAH: ${m.regulatoryContext.mahFacingActions.join(", ")}`,
      }),
      new Paragraph({ text: `Basis: ${m.regulatoryContext.basis}` }),
      new Paragraph({
        text: `Decided by: ${m.regulatoryContext.decidedBy} on ${m.regulatoryContext.decidedAtLabel}`,
      }),
      new Paragraph({ text: "" }),
    );
  }

  if (m.followUp.responseDeadline || m.followUp.nextPsurDueDate || m.followUp.informationRequired) {
    children.push(docxHeading("Required follow-up", HeadingLevel.HEADING_2));
    if (m.followUp.informationRequired) {
      children.push(
        new Paragraph({ text: `Information required: ${m.followUp.informationRequired}` }),
      );
    }
    children.push(
      new Paragraph({
        text: `Response deadline: ${m.followUp.responseDeadline ?? "not specified in this directive"}`,
      }),
      new Paragraph({
        text: `Next PSUR/PBRER due date: ${m.followUp.nextPsurDueDate ?? "not yet determined"}`,
      }),
      new Paragraph({ text: "" }),
    );
  }

  children.push(
    docxHeading("Assessed by", HeadingLevel.HEADING_2),
    docxLabelValue(
      "Evaluator / Assessing Officer",
      m.signatory.evaluatorName ?? "pending signature",
    ),
    docxLabelValue("Date", m.signatory.evaluatorSignedAtLabel ?? "pending"),
    docxLabelValue("Signature", m.signatory.evaluatorName ? "recorded electronically" : "pending"),
    new Paragraph({ text: "" }),
    docxLabelValue("Peer reviewer", m.signatory.peerReviewerName ?? "pending signature"),
    docxLabelValue("Date", m.signatory.peerReviewedAtLabel ?? "pending"),
    docxLabelValue(
      "Signature",
      m.signatory.peerReviewerName ? "recorded electronically" : "pending",
    ),
    new Paragraph({ text: "" }),
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Note: ${m.resolvedCount} previously-identified deficiency/deficiencies already resolved and ${m.dismissedCount} finding(s) dismissed as not applicable are not restated in this directive.`,
          italics: true,
        }),
      ],
    }),
  );

  return new Document({ sections: [{ properties: {}, children }] });
}

export const psur = {
  documents: async (): Promise<PsurDocument[]> => {
    const { data, error } = await supabase.from("pv_psur_documents").select("data");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as PsurDocument)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  /**
   * A PDF's bytes only ever exist in the browser for the duration of this
   * call — there is no document storage in this app — so AI review for a
   * PDF has to happen right here, once, while the file is still in
   * memory, rather than lazily later. If OpenAI is unavailable or fails,
   * this falls back to the deterministic metadata-based findings so the
   * document still ends up reviewed either way.
   */
  upload: async (file: File): Promise<PsurDocument> => {
    const actor = currentActor();

    if (isSpreadsheetFile(file)) {
      let doc: PsurDocumentRow;
      try {
        const { headers, rows } = await parseTabularFile(file);
        const mapping = mapColumnsByKeywords(headers, PSUR_FIELD_KEYWORDS);
        const parsedRows: ParsedCaseRow[] = rows.map((row) => {
          const parsed: ParsedCaseRow = {};
          headers.forEach((header, i) => {
            const field = mapping[header];
            if (field && row[i]) parsed[field] = row[i];
          });
          return parsed;
        });
        const rawRows: Record<string, string>[] = rows.map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((header, i) => {
            obj[header] = row[i] ?? "";
          });
          return obj;
        });
        doc = {
          id: newId("psur"),
          filename: file.name,
          product:
            mostCommon(parsedRows.map((r) => r.product).filter((v): v is string => !!v)) ??
            "Not yet extracted",
          reportingPeriod: detectReportingPeriod(parsedRows),
          uploadedAt: new Date().toISOString(),
          uploadedBy: actor.name,
          stage: "UPLOADED",
          pages: parsedRows.length,
          sourceType: "SPREADSHEET",
          columns: headers,
          mapping,
          parsedRows,
          rawRows,
        };
      } catch (err) {
        doc = {
          id: newId("psur"),
          filename: file.name,
          product: "Not yet extracted",
          reportingPeriod: "Not yet extracted",
          uploadedAt: new Date().toISOString(),
          uploadedBy: actor.name,
          stage: "FAILED",
          pages: 0,
          sourceType: "SPREADSHEET",
        };
        const { error } = await supabase
          .from("pv_psur_documents")
          .insert({ id: doc.id, data: toJson(doc) });
        if (error) throw new Error(error.message);
        await recordAudit({
          action: "PSUR_UPLOADED",
          entity: "PsurDocument",
          entityId: doc.id,
          newValue: `${file.name} — could not be parsed: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        return doc;
      }

      const { error } = await supabase
        .from("pv_psur_documents")
        .insert({ id: doc.id, data: toJson(doc) });
      if (error) throw new Error(error.message);
      await recordAudit({
        action: "PSUR_UPLOADED",
        entity: "PsurDocument",
        entityId: doc.id,
        newValue: `${file.name} (${doc.pages} case rows parsed)`,
      });
      return doc;
    }

    // PDF path — create the record, then review inline while the file is
    // still available.
    const doc: PsurDocumentRow = {
      id: newId("psur"),
      filename: file.name,
      product: "Not yet extracted",
      reportingPeriod: "Not yet extracted",
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.name,
      stage: "UPLOADED",
      // Nothing has opened the PDF at this point, so this is a size-based
      // guess, not a page count — flagged as such so the UI never renders
      // it as a fact. Replaced with the real count below the moment the
      // backend reports pages_extracted from pdfplumber.
      pages: Math.max(1, Math.round(file.size / 3000)),
      pagesEstimated: true,
      sourceType: "PDF",
    };
    const { error } = await supabase
      .from("pv_psur_documents")
      .insert({ id: doc.id, data: toJson(doc) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "PSUR_UPLOADED",
      entity: "PsurDocument",
      entityId: doc.id,
      newValue: file.name,
    });

    try {
      const aiResult = await ai.psur.reviewPdf(file, doc.product, doc.reportingPeriod);
      const findings: PsurFinding[] = aiResult.ai_used
        ? aiResult.findings.map(mapAiFinding)
        : RULE_BASED_DETECTION_ENABLED
          ? generatePdfFindingsFallback(doc)
          : [];
      const screening = aiResult.ai_used
        ? mapAiScreening(aiResult.screening)
        : generateFallbackScreening();
      const specialPopulations = aiResult.ai_used
        ? mapAiSpecialPopulations(aiResult.special_populations)
        : undefined;
      const benefitRisk = aiResult.ai_used ? mapAiBenefitRisk(aiResult.benefit_risk) : undefined;
      const uncertainties = aiResult.ai_used
        ? mapAiUncertainties(aiResult.uncertainties)
        : undefined;
      const nigerianContext = aiResult.ai_used
        ? mapAiNigerianContext(aiResult.nigerian_context, "PDF")
        : undefined;
      // Guarantee every section the coverage check calls MISSING/
      // PRESENT_BUT_INCOMPLETE has a corresponding actionable finding —
      // see section-consistency.ts's module doc comment for why this is
      // necessary rather than trusting the AI's two separate judgements
      // (coverage vs. findings) to already agree.
      const coverage = buildAuthoritativeSectionCoverage({
        screening,
        sourceType: "PDF",
        nigerianContext,
        specialPopulations,
        benefitRisk,
        uncertainties,
      });
      // The Nigeria-specific findings come first so reconcileSectionFindings
      // sees them and does not also synthesize a generic "section is
      // incomplete" finding for the same section.
      findings.push(...buildNigerianRequirementFindings(nigerianContext, findings));
      findings.push(...reconcileSectionFindings(coverage, findings));
      await persistFindings(doc.id, findings);
      const reviewed: PsurDocumentRow = {
        ...doc,
        stage: "REVIEWED",
        // The record was seeded with "Not yet extracted" placeholders at
        // upload time with nothing that ever filled them in afterward —
        // apply whatever the AI pass could confidently read off the
        // document text itself, and only for a value it actually found.
        ...(aiResult.ai_used && aiResult.product ? { product: aiResult.product } : {}),
        ...(aiResult.ai_used && aiResult.reporting_period
          ? { reportingPeriod: aiResult.reporting_period }
          : {}),
        ...(aiResult.ai_used && aiResult.mah ? { mah: aiResult.mah } : {}),
        // pdfplumber actually opened the file — replace the upload-time
        // size estimate with the real page count. Reported even when the
        // AI call itself failed, since extraction happens first.
        ...(typeof aiResult.pages_extracted === "number" && aiResult.pages_extracted > 0
          ? { pages: aiResult.pages_extracted, pagesEstimated: false }
          : {}),
        screening,
        ...(specialPopulations ? { specialPopulations } : {}),
        ...(benefitRisk ? { benefitRisk } : {}),
        ...(uncertainties ? { uncertainties } : {}),
        ...(nigerianContext ? { nigerianContext } : {}),
        ...(aiResult.ai_used
          ? { aiRecommendation: mapAiRecommendation(aiResult.ai_recommendation) }
          : {}),
      };
      await saveDocument(reviewed);
      await recordAudit({
        action: "PSUR_REVIEWED",
        entity: "PsurDocument",
        entityId: doc.id,
        newValue: `${findings.length} finding(s) generated${aiResult.ai_used ? " (AI)" : RULE_BASED_DETECTION_ENABLED ? " (rule-based fallback)" : " (AI unavailable, rule-based fallback disabled)"}`,
      });
      return reviewed;
    } catch {
      // Review endpoint unreachable entirely — leave the document
      // UPLOADED; review() will retry with the deterministic fallback
      // when the user opens it (there are no parsedRows for a PDF, so it
      // can only use the metadata-based generator at that point).
      return doc;
    }
  },

  review: async (
    documentId: string,
  ): Promise<{ document: PsurDocument; findings: PsurFinding[] }> => {
    const document = await readDocument(documentId);
    let findings = await readFindings(documentId);

    if (findings.length === 0 && document.stage !== "REVIEWED" && document.stage !== "FAILED") {
      let screening: PsurScreeningResult | undefined;
      if (document.sourceType === "SPREADSHEET" && document.parsedRows) {
        const stats = computeStats(document.parsedRows);
        try {
          const aiResult = await ai.psur.reviewSpreadsheet({
            filename: document.filename,
            columns: document.columns ?? [],
            rows: (document.rawRows ?? document.parsedRows) as Record<string, string>[],
            product: document.product,
            reportingPeriod: document.reportingPeriod,
            stats,
          });
          findings = aiResult.ai_used
            ? aiResult.findings.map(mapAiFinding)
            : RULE_BASED_DETECTION_ENABLED
              ? generateSpreadsheetFindingsFallback(document)
              : [];
          screening = aiResult.ai_used
            ? mapAiScreening(aiResult.screening)
            : generateFallbackScreening();
        } catch {
          findings = RULE_BASED_DETECTION_ENABLED
            ? generateSpreadsheetFindingsFallback(document)
            : [];
          screening = generateFallbackScreening();
        }
      } else {
        // PDF that somehow reached review() without being reviewed at
        // upload time (e.g. the AI endpoint was unreachable then) — the
        // original bytes are gone, so only the metadata-based fallback
        // is possible here (when RULE_BASED_DETECTION_ENABLED is on).
        findings = RULE_BASED_DETECTION_ENABLED ? generatePdfFindingsFallback(document) : [];
        screening = generateFallbackScreening();
      }

      findings.push(
        ...reconcileSectionFindings(buildAuthoritativeSectionCoverage({ screening }), findings),
      );
      await persistFindings(documentId, findings);
      const next: PsurDocumentRow = { ...document, stage: "REVIEWED", screening };
      await saveDocument(next);
      await recordAudit({
        action: "PSUR_REVIEWED",
        entity: "PsurDocument",
        entityId: documentId,
        newValue: `${findings.length} finding(s) generated`,
      });
      return { document: next, findings };
    }

    // Already-reviewed documents still have to satisfy the reconciliation
    // guarantee. Reconciling only on the first-pass branch above left every
    // document reviewed before that guarantee existed permanently
    // inconsistent: a section whose authoritative status is MISSING, with no
    // finding tagged to it, which the assessor therefore cannot accept and
    // which can never reach a Compliance Directive. The Section Coverage
    // panel says so out loud ("No corresponding finding yet — this should
    // not happen"), and on real submissions this was the norm, not the
    // exception.
    //
    // Safe to run on every read: reconcileSectionFindings is idempotent and
    // pure, and only writes when it actually synthesizes something, so a
    // consistent document does no database work at all.
    // The Nigeria-specific requirements heal the same way: a document
    // reviewed before those were assessed separately carries no finding for
    // them, and would otherwise show a deficient S5/S7 with nothing an
    // assessor could accept. Synthesized first so reconciliation sees them.
    const nigerian = buildNigerianRequirementFindings(document.nigerianContext, findings);
    const missing = [
      ...nigerian,
      ...reconcileSectionFindings(buildAuthoritativeSectionCoverage(document), [
        ...findings,
        ...nigerian,
      ]),
    ];
    if (missing.length > 0) {
      await persistFindings(documentId, missing);
      await recordAudit({
        action: "PSUR_SECTION_FINDINGS_RECONCILED",
        entity: "PsurDocument",
        entityId: documentId,
        newValue: `${missing.length} section finding(s) synthesized for deficient sections that had none`,
      });
      findings = [...findings, ...missing];
    }

    return { document, findings };
  },

  recordAssessment: async (
    documentId: string,
    findingId: string,
    assessment: "ACCEPTED" | "DISMISSED",
    rationale: string,
  ): Promise<PsurFinding> => {
    const findings = await readFindings(documentId);
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) throw new Error("Finding not found");
    const actor = currentActor();
    const next: PsurFinding = {
      ...finding,
      humanAssessment: assessment,
      respondedBy: actor.name,
      respondedAt: new Date().toISOString(),
      rationale,
    };
    await saveFinding(documentId, next);
    await recordAudit({
      action: "PSUR_FINDING_ASSESSED",
      entity: "PsurFinding",
      entityId: findingId,
      previousValue: finding.humanAssessment ?? "PENDING",
      newValue: assessment,
      reason: rationale,
    });
    return next;
  },

  /**
   * The assessor's own decision on WHO must act on a finding, overriding
   * the deterministic derivation in services/psur/finding-ownership.ts.
   *
   * This is what moves a finding into or out of the MAH-facing Compliance
   * Directive, so it is a regulated action: it requires a rationale and
   * writes an audit event naming what the rules had concluded and what the
   * assessor changed it to. The derived value is never overwritten — the
   * override is stored alongside it, so "the rule said X, this person said
   * Y because Z" stays reconstructable.
   */
  recordActionOwnerOverride: async (
    documentId: string,
    findingId: string,
    owner: "MAH" | "ASSESSOR",
    rationale: string,
  ): Promise<PsurFinding> => {
    const findings = await readFindings(documentId);
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) throw new Error("Finding not found");
    const actor = currentActor();
    const derived = derivedRequiresMahAction(finding) ? "MAH" : "ASSESSOR";
    const next: PsurFinding = {
      ...finding,
      actionOwnerOverride: {
        owner,
        by: actor.name,
        at: new Date().toISOString(),
        rationale,
      },
    };
    await saveFinding(documentId, next);
    await recordAudit({
      action: "PSUR_FINDING_ACTION_OWNER_OVERRIDDEN",
      entity: "PsurFinding",
      entityId: findingId,
      previousValue: `derived: ${derived}`,
      newValue: `assessor: ${owner}`,
      reason: rationale,
    });
    return next;
  },

  /** Clears an assessor's ownership override, returning the finding to
   *  whatever the derivation concludes. Audited like setting one. */
  clearActionOwnerOverride: async (documentId: string, findingId: string): Promise<PsurFinding> => {
    const findings = await readFindings(documentId);
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) throw new Error("Finding not found");
    const previous = finding.actionOwnerOverride;
    const next: PsurFinding = { ...finding, actionOwnerOverride: undefined };
    await saveFinding(documentId, next);
    await recordAudit({
      action: "PSUR_FINDING_ACTION_OWNER_OVERRIDE_CLEARED",
      entity: "PsurFinding",
      entityId: findingId,
      previousValue: previous ? `assessor: ${previous.owner}` : "none",
      newValue: `derived: ${derivedRequiresMahAction(next) ? "MAH" : "ASSESSOR"}`,
    });
    return next;
  },

  /** The assessor's own decision on whether to proceed to scientific
   *  review or return the submission to the MAH first — the AI's
   *  `screening.recommendation` is only ever a suggestion; this is what
   *  actually governs the workflow going forward. */
  recordScreeningOverride: async (
    documentId: string,
    decision: "PROCEED_TO_SCIENTIFIC_REVIEW" | "RETURN_TO_MAH_FIRST",
    rationale: string,
  ): Promise<PsurDocument> => {
    const document = await readDocument(documentId);
    if (!document.screening) throw new Error("No screening result to override yet");
    const actor = currentActor();
    const next: PsurDocumentRow = {
      ...document,
      screening: {
        ...document.screening,
        humanOverride: { decision, by: actor.name, at: new Date().toISOString(), rationale },
      },
    };
    await saveDocument(next);
    await recordAudit({
      action: "PSUR_SCREENING_OVERRIDDEN",
      entity: "PsurDocument",
      entityId: documentId,
      previousValue: document.screening.recommendation,
      newValue: decision,
      reason: rationale,
    });
    return next;
  },

  /** Assessor edits to the Section 10 benefit-risk sub-tables — replaces
   *  the whole structure (the UI always sends the full edited object back,
   *  same pattern as a form save) and marks it no longer purely
   *  AI-generated once a human has touched it. */
  updateBenefitRisk: async (
    documentId: string,
    benefitRisk: PsurBenefitRiskAssessment,
  ): Promise<PsurDocument> => {
    const document = await readDocument(documentId);
    const next: PsurDocumentRow = {
      ...document,
      benefitRisk: { ...benefitRisk, assistGenerated: false },
    };
    await saveDocument(next);
    await reconcileAfterAssessorEdit(next);
    await recordAudit({
      action: "PSUR_BENEFIT_RISK_UPDATED",
      entity: "PsurDocument",
      entityId: documentId,
      newValue: `${benefitRisk.keyBenefits.length} benefit(s), ${benefitRisk.keyRisks.length} risk(s) recorded by assessor`,
    });
    return next;
  },

  /** Assessor edits to the Section 9 special-populations breakdown — full
   *  replace, same ownership pattern as updateBenefitRisk. Each item's
   *  `source` is stamped "assessor" here so the overall S9 coverage
   *  status (derived from these items — see buildAuthoritativeSectionCoverage)
   *  is correctly attributed once a human has actually reviewed it. */
  updateSpecialPopulations: async (
    documentId: string,
    items: PsurSpecialPopulationItem[],
  ): Promise<PsurDocument> => {
    const document = await readDocument(documentId);
    const next: PsurDocumentRow = {
      ...document,
      specialPopulations: items.map((i) => ({ ...i, source: "assessor" as const })),
    };
    await saveDocument(next);
    await reconcileAfterAssessorEdit(next);
    await recordAudit({
      action: "PSUR_SPECIAL_POPULATIONS_UPDATED",
      entity: "PsurDocument",
      entityId: documentId,
      newValue: `${items.length} special-population area(s) recorded by assessor`,
    });
    return next;
  },

  /** Assessor edits to the Section 11 uncertainties list — full replace.
   *  `confirmNoneApply` is the explicit "I reviewed this and genuinely
   *  none apply" record the V4 template requires — structurally distinct
   *  from an empty list nobody has looked at yet (see
   *  PsurDocument.uncertaintiesNoneConfirmed). Adding at least one
   *  uncertainty always clears any prior "none apply" confirmation, since
   *  the two are mutually exclusive claims. */
  updateUncertainties: async (
    documentId: string,
    uncertainties: PsurUncertainty[],
    confirmNoneApply = false,
    evaluatorComments?: string,
  ): Promise<PsurDocument> => {
    const document = await readDocument(documentId);
    const actor = currentActor();
    const next: PsurDocumentRow = {
      ...document,
      uncertainties,
      // Section 11's "Evaluator's comments" field — only overwritten when
      // this call actually carries a value, so saving the uncertainty rows
      // alone never silently blanks an appraisal the assessor already wrote.
      ...(evaluatorComments !== undefined ? { evaluatorComments } : {}),
      uncertaintiesNoneConfirmed:
        uncertainties.length === 0 && confirmNoneApply
          ? {
              by: actor.name,
              at: new Date().toISOString(),
              rationale: "Assessor confirmed no uncertainties apply this interval.",
            }
          : uncertainties.length === 0
            ? document.uncertaintiesNoneConfirmed
            : undefined,
    };
    await saveDocument(next);
    await reconcileAfterAssessorEdit(next);
    await recordAudit({
      action: "PSUR_UNCERTAINTIES_UPDATED",
      entity: "PsurDocument",
      entityId: documentId,
      newValue:
        uncertainties.length > 0
          ? `${uncertainties.length} uncertainty/uncertainties recorded`
          : confirmNoneApply
            ? "Assessor confirmed no uncertainties apply"
            : "No uncertainties recorded",
    });
    return next;
  },

  /** The assessor's ACTUAL Section 12 decision — structurally separate
   *  from `document.aiRecommendation` (the AI's non-binding starting
   *  point), never defaulted from it. */
  updateRegulatoryDecision: async (
    documentId: string,
    decision: Omit<PsurRegulatoryDecision, "decidedBy" | "decidedAt">,
  ): Promise<PsurDocument> => {
    const document = await readDocument(documentId);
    const actor = currentActor();
    const next: PsurDocumentRow = {
      ...document,
      regulatoryDecision: {
        ...decision,
        decidedBy: actor.name,
        decidedAt: new Date().toISOString(),
      },
    };
    await saveDocument(next);
    await recordAudit({
      action: "PSUR_REGULATORY_DECISION_RECORDED",
      entity: "PsurDocument",
      entityId: documentId,
      newValue: `${decision.overallOutcome ?? "no outcome set"} — ${decision.actions.length} action(s)`,
    });
    return next;
  },

  /** Section 13 — pure assessor input, never AI-generated (see
   *  PsurSignOff). Signing sets the evaluator/peer-reviewer timestamps
   *  only for whichever name is present in this call, so an evaluator can
   *  sign before a peer reviewer does. */
  updateSignOff: async (documentId: string, signOff: PsurSignOff): Promise<PsurDocument> => {
    const document = await readDocument(documentId);
    const now = new Date().toISOString();
    const next: PsurDocumentRow = {
      ...document,
      signOff: {
        ...signOff,
        ...(signOff.evaluatorName ? { evaluatorSignedAt: signOff.evaluatorSignedAt ?? now } : {}),
        ...(signOff.peerReviewerName ? { peerReviewedAt: signOff.peerReviewedAt ?? now } : {}),
      },
    };
    await saveDocument(next);
    await recordAudit({
      action: "PSUR_SIGNED_OFF",
      entity: "PsurDocument",
      entityId: documentId,
      newValue: `Conclusion recorded, reviewer confidence: ${signOff.reviewerConfidence ?? "not set"}`,
    });
    return next;
  },

  /**
   * Applies OpenAI-proposed resolutions for the ACCEPTED findings only —
   * dismissed and still-pending findings are never touched. For a
   * spreadsheet document, cell-level corrections are applied to the
   * stored rows (the same corrected-in-place model line-list uses); for a
   * PDF, since the original bytes were never kept, the result is a
   * clearly-labelled corrections report rather than a rewritten PDF.
   */
  runFullFix: async (
    documentId: string,
  ): Promise<{
    document: PsurDocument;
    findings: PsurFinding[];
    resolvedCount: number;
    unresolvedCount: number;
    aiUsed: boolean;
    aiError?: string | undefined;
  }> => {
    const document = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const accepted = findings.filter((f) => f.humanAssessment === "ACCEPTED");
    if (accepted.length === 0) {
      throw new Error("No accepted findings to fix yet — accept at least one finding first.");
    }

    const fixResult = await ai.psur.fix({
      filename: document.filename,
      sourceType: document.sourceType ?? "PDF",
      acceptedFindings: accepted.map((f) => ({
        id: f.id,
        category: f.category,
        section: f.section,
        description: f.description,
        evidence: f.evidence,
      })),
      columns: document.columns,
      rows: (document.rawRows ?? document.parsedRows) as Record<string, string>[] | undefined,
    });

    const resolutionByFindingId = new Map(fixResult.resolutions.map((r) => [r.finding_id, r]));
    const unresolvedByFindingId = new Map(fixResult.unresolved.map((u) => [u.finding_id, u]));

    for (const finding of accepted) {
      const resolution = resolutionByFindingId.get(finding.id);
      const unresolved = unresolvedByFindingId.get(finding.id);
      if (resolution) {
        await saveFinding(documentId, {
          ...finding,
          resolution: resolution.resolution_text,
          resolved: true,
        });
      } else if (unresolved) {
        await saveFinding(documentId, {
          ...finding,
          resolution: unresolved.reason,
          resolved: false,
        });
      }
    }

    let updatedDoc: PsurDocumentRow = document;
    if (document.sourceType === "SPREADSHEET" && document.parsedRows) {
      // A resolution's column may reference any original header, not just
      // one of the fixed PsurField names — never drop it just because it
      // isn't one of those. Write into rawRows by original header (what
      // the export reads from) and into parsedRows too when that header
      // also happens to map to a canonical PsurField.
      const parsedRows = [...document.parsedRows];
      const rawRows = document.rawRows ? [...document.rawRows] : undefined;
      for (const r of fixResult.resolutions) {
        if (r.row == null || !r.column) continue;
        const idx = r.row - 1;
        if (idx < 0) continue;
        if (rawRows && idx < rawRows.length && r.column in rawRows[idx]!) {
          rawRows[idx] = {
            ...rawRows[idx]!,
            [r.column]: r.new_value ?? rawRows[idx]![r.column] ?? "",
          };
        }
        const canonicalField = document.mapping?.[r.column];
        if (canonicalField && idx < parsedRows.length) {
          const currentRow = parsedRows[idx];
          if (currentRow) {
            parsedRows[idx] = {
              ...currentRow,
              [canonicalField]: r.new_value ?? currentRow[canonicalField],
            };
          }
        }
      }
      updatedDoc = { ...document, parsedRows, ...(rawRows ? { rawRows } : {}) };
    }

    updatedDoc = {
      ...updatedDoc,
      fixedAt: new Date().toISOString(),
      fixResolvedCount: fixResult.resolutions.length,
      fixUnresolvedCount: fixResult.unresolved.length,
    };
    await saveDocument(updatedDoc);
    await recordAudit({
      action: "PSUR_FULL_FIX_APPLIED",
      entity: "PsurDocument",
      entityId: documentId,
      newValue: `${fixResult.resolutions.length} finding(s) resolved, ${fixResult.unresolved.length} left unresolved`,
      reason: `Prompt ${fixResult.prompt_version}`,
    });

    return {
      document: updatedDoc,
      findings: await readFindings(documentId),
      resolvedCount: fixResult.ai_used ? fixResult.resolutions.length : 0,
      unresolvedCount: fixResult.ai_used ? fixResult.unresolved.length : accepted.length,
      aiUsed: fixResult.ai_used,
      aiError: fixResult.error ?? undefined,
    };
  },

  /**
   * Downloads the corrected report as a Word (.docx) document — for a
   * spreadsheet source, the current (post-fix) data as a table; for a PDF
   * source, a reconstructed narrative built from every ACCEPTED finding,
   * with an AI-resolved MISSING_SECTION finding rendered as an actual
   * heading + body text (the section the AI added), and every other
   * accepted finding rendered as a correction note. The original PDF bytes
   * are never stored by this app, so this is a rebuilt document reflecting
   * the reviewed content, not a byte-for-byte edit of the upload.
   */
  downloadFixedDocument: async (documentId: string): Promise<void> => {
    const doc = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const accepted = findings.filter((f) => f.humanAssessment === "ACCEPTED");

    const metadataParagraphs = [
      new Paragraph({
        text: doc.filename,
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({ text: `Product: ${doc.product}` }),
      new Paragraph({ text: `Reporting period: ${doc.reportingPeriod}` }),
      new Paragraph({
        text:
          `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC` +
          (doc.fixedAt
            ? ` — corrections last applied ${doc.fixedAt.slice(0, 16).replace("T", " ")} UTC`
            : ""),
      }),
      new Paragraph({ text: "" }),
    ];

    let bodyChildren: (Paragraph | Table)[];

    if (
      doc.sourceType === "SPREADSHEET" &&
      doc.columns &&
      (doc.rawRows || (doc.mapping && doc.parsedRows))
    ) {
      const { columns } = doc;
      // Read from rawRows (every original column, post-fix) when present —
      // falling back to the canonical-field reconstruction only for a
      // document with no raw parse at all.
      const dataRows: string[][] = doc.rawRows
        ? doc.rawRows.map((row) => columns.map((header) => row[header] ?? ""))
        : doc.parsedRows!.map((row) =>
            columns.map((header) =>
              doc.mapping![header] ? (row[doc.mapping![header]!] ?? "") : "",
            ),
          );

      const headerRow = new TableRow({
        tableHeader: true,
        children: columns.map(
          (h) =>
            new TableCell({
              width: {
                size: Math.max(1, Math.floor(100 / columns.length)),
                type: WidthType.PERCENTAGE,
              },
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
            }),
        ),
      });
      const dataTableRows = dataRows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph(cell)],
                }),
            ),
          }),
      );

      bodyChildren = [
        new Paragraph({
          text: `Case data (${dataRows.length} row(s)) — reflects any AI corrections applied.`,
        }),
        new Paragraph({ text: "" }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...dataTableRows],
        }),
      ];
    } else if (accepted.length === 0) {
      bodyChildren = [
        new Paragraph({
          text: "No findings have been accepted yet, so there is nothing to add to this report. Accept a finding and run Run Full Fix first.",
        }),
      ];
    } else {
      bodyChildren = accepted.flatMap((f) => {
        const isAddedSection = f.category === "MISSING_SECTION" && f.resolved && f.resolution;
        return [
          new Paragraph({
            text: f.section,
            heading: HeadingLevel.HEADING_1,
          }),
          ...(isAddedSection
            ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "AI-drafted section content — requires human sign-off",
                      italics: true,
                    }),
                  ],
                }),
                new Paragraph({ text: f.resolution! }),
              ]
            : [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${f.category.replaceAll("_", " ")} · ${f.severity} severity`,
                      bold: true,
                    }),
                  ],
                }),
                new Paragraph({ text: f.description }),
                new Paragraph({
                  children: [new TextRun({ text: `Evidence: ${f.evidence}`, italics: true })],
                }),
                new Paragraph({
                  text: f.resolved
                    ? `Correction applied: ${f.resolution}`
                    : `Unresolved: ${f.resolution ?? "not yet processed by Run Full Fix"}`,
                }),
              ]),
          new Paragraph({ text: "" }),
        ];
      });
    }

    const wordDoc = new Document({
      sections: [
        {
          properties: {},
          children: [...metadataParagraphs, ...bodyChildren],
        },
      ],
    });
    const blob = await Packer.toBlob(wordDoc);
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename.replace(/\.[^.]+$/, "") + "-fixed.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /**
   * INTERNAL/assessor-facing overview of the whole assessment — "what did
   * the assessment find and where does it stand." Built entirely from
   * buildExecutiveSummaryModel (the same authoritative model the
   * assessment page itself would render), so this can never say something
   * the on-screen page doesn't. DOCX is the primary, professional format;
   * downloadExecutiveSummaryText below remains available as a lightweight
   * plain-text alternative.
   */
  downloadExecutiveSummary: async (documentId: string): Promise<void> => {
    const doc = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const model = buildExecutiveSummaryModel(doc, findings);
    await downloadBlob(
      await Packer.toBlob(buildExecutiveSummaryDocx(model)),
      docBaseName(doc) + "-executive-summary.docx",
    );
  },

  /** Plain-text alternative to the DOCX above — same model, same content. */
  downloadExecutiveSummaryText: async (documentId: string): Promise<void> => {
    const doc = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const model = buildExecutiveSummaryModel(doc, findings);
    await downloadBlob(
      new Blob([renderExecutiveSummaryText(model)], { type: "text/plain" }),
      docBaseName(doc) + "-executive-summary.txt",
    );
  },

  /**
   * EXTERNAL/MAH-facing directive — "what does the MAH need to
   * address/provide/correct." Deliberately narrower than the Executive
   * Summary: built from buildComplianceDirectiveModel, which includes
   * ONLY findings the assessor has ACCEPTED, that genuinely require MAH
   * action, and that are NOT YET resolved (accepting a finding records it
   * as a valid deficiency — it does not by itself mean it's fixed).
   * System-generated draft for assessor review, never presented as an
   * official NAFDAC issuance. DOCX is the primary, professional format.
   */
  downloadComplianceDirective: async (documentId: string): Promise<void> => {
    const doc = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const model = buildComplianceDirectiveModel(doc, findings);
    await downloadBlob(
      await Packer.toBlob(buildComplianceDirectiveDocx(model)),
      docBaseName(doc) + "-compliance-directive.docx",
    );
  },

  /** Plain-text alternative to the DOCX above — same model, same content. */
  downloadComplianceDirectiveText: async (documentId: string): Promise<void> => {
    const doc = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const model = buildComplianceDirectiveModel(doc, findings);
    await downloadBlob(
      new Blob([renderComplianceDirectiveText(model)], { type: "text/plain" }),
      docBaseName(doc) + "-compliance-directive.txt",
    );
  },
};
