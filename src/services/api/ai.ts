import { apiRequest, apiUpload } from "./client";

/**
 * Client for the server-side AI workflows (src/server/routes/ai_*.py).
 * The OpenAI API key never reaches the browser — every call here goes
 * through the FastAPI backend, which is the only thing that talks to
 * OpenAI directly. If the backend isn't configured with a key, these
 * endpoints still respond normally (ai_used: false, a human-readable
 * error) rather than failing — callers use that to fall back to
 * deterministic behaviour instead of surfacing an error.
 */

export interface AiLineListIssueOut {
  row: number;
  column: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  /** LOW means this finding depended on inferring an unfamiliar column's
   *  role, a typo/near-miss judgment call, or a plausibility check rather
   *  than an exact rule — the app never auto-applies a fix for one of
   *  these without a human deciding first. */
  confidence: "HIGH" | "LOW";
  code: string;
  message: string;
  value: string | null;
  fixable: boolean;
  source: "ai";
  /** Normalized issue classification and affected canonical field(s),
   *  used to safely merge this finding with a matching rule finding
   *  instead of showing both. Absent/empty when the model didn't (or
   *  couldn't) classify a particular finding — it still displays, just
   *  isn't merge-eligible. */
  issueType?: string | null;
  affectedFields?: string[];
}

export interface AiAnalyzeResponse {
  findings: AiLineListIssueOut[];
  ai_used: boolean;
  prompt_version: string;
  model?: string | null;
  error?: string | null;
}

export interface AiCorrection {
  row: number;
  column: string;
  new_value: string;
  reason: string;
}

export interface AiUnresolved {
  row: number;
  column: string;
  reason: string;
}

export interface AiFixResponse {
  corrections: AiCorrection[];
  unresolved: AiUnresolved[];
  ai_used: boolean;
  prompt_version: string;
  error?: string | null;
}

export interface AiPsurFindingOut {
  category: "MISSING_SECTION" | "CONSISTENCY" | "NUMERICAL" | "SIGNAL" | "BENEFIT_RISK";
  severity: "HIGH" | "MEDIUM" | "LOW";
  section: string;
  description: string;
  evidence: string;
}

export interface AiPsurReviewResponse {
  findings: AiPsurFindingOut[];
  ai_used: boolean;
  prompt_version: string;
  pages_extracted?: number | null;
  truncated?: boolean;
  model?: string | null;
  error?: string | null;
}

export interface AiPsurResolution {
  finding_id: string;
  resolution_text: string;
  row?: number | null;
  column?: string | null;
  new_value?: string | null;
}

export interface AiPsurUnresolved {
  finding_id: string;
  reason: string;
}

export interface AiPsurFixResponse {
  resolutions: AiPsurResolution[];
  unresolved: AiPsurUnresolved[];
  ai_used: boolean;
  prompt_version: string;
  error?: string | null;
}

export interface AiIcsrExtraction {
  reporterName: string | null;
  reporterQualification: string | null;
  reporterCountry: string | null;
  reporterContact: string | null;
  patientIdentifier: string | null;
  patientAge: string | null;
  patientSex: "MALE" | "FEMALE" | "UNKNOWN" | null;
  patientWeightKg: string | null;
  patientMedicalHistory: string | null;
  productName: string | null;
  productDose: string | null;
  productRoute: string | null;
  productIndication: string | null;
  therapyStartDate: string | null;
  productAction: string | null;
  reactionTerm: string | null;
  onsetDate: string | null;
  endDate: string | null;
  outcome:
    | "RECOVERED"
    | "RECOVERING"
    | "NOT_RECOVERED"
    | "RECOVERED_WITH_SEQUELAE"
    | "FATAL"
    | "UNKNOWN"
    | null;
  reportedSeriousness: "SERIOUS" | "NON_SERIOUS" | "UNASSESSED" | null;
  narrative: string | null;
  additionalInformation: string | null;
  /** Every suspected drug found — element 0 always mirrors the singular
   *  product* fields above. Absent/empty on responses from before this
   *  field existed; callers should fall back to the singular fields. */
  suspectedDrugs?: AiIcsrDrugFinding[];
  concomitantMedicines?: AiIcsrConcomitantMed[];
  /** Exact labels from the known seriousness-criteria checkbox list that
   *  the image showed as actually marked. */
  seriousnessCriteria?: string[];
  /** Meaningful fields found on the document that don't map to any
   *  canonical field above — never silently discarded just because our
   *  fixed schema has no slot for them yet. Absent on responses from
   *  before this field existed. */
  dynamicFields?: AiIcsrDynamicFieldFinding[];
  lowConfidenceFields: string[];
}

export interface AiIcsrDynamicFieldFinding {
  label: string;
  value: string | null;
  originalLabel: string | null;
  confidence: number | null;
}

export interface AiIcsrDrugFinding {
  productName: string | null;
  productDose: string | null;
  productRoute: string | null;
  productIndication: string | null;
  therapyStartDate: string | null;
  productAction: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
}

export interface AiIcsrConcomitantMed {
  name: string | null;
  dose: string | null;
  indication: string | null;
}

export interface AiIcsrExtractionSummary {
  canonical_fields_detected: number;
  dynamic_fields_detected: number;
  low_confidence_fields: number;
}

export interface AiIcsrExtractionResponse {
  extracted: AiIcsrExtraction | null;
  ai_used: boolean;
  prompt_version: string;
  model?: string | null;
  error?: string | null;
  extraction_summary?: AiIcsrExtractionSummary | null;
}

export interface AiCodingCandidate {
  term: string;
  rationale: string;
  confidence: number;
}

export interface AiCodingSuggestResponse {
  candidates: AiCodingCandidate[];
  ai_used: boolean;
  prompt_version: string;
  model?: string | null;
  error?: string | null;
}

export interface AiLiteratureAnalysis {
  is_safety_relevant: boolean;
  products: string[];
  reaction_terms: string[];
  seriousness_criteria: string[];
  risk_level: "HIGH" | "MODERATE" | "LOW";
  summary: string;
  rationale: string;
}

export interface AiLiteratureAnalyzeResponse {
  analysis: AiLiteratureAnalysis | null;
  ai_used: boolean;
  prompt_version: string;
  model?: string | null;
  error?: string | null;
}

export interface AiLiteratureDocumentResponse {
  extracted_text: string;
  truncated: boolean;
  pages_extracted?: number | null;
  analysis: AiLiteratureAnalysis | null;
  ai_used: boolean;
  prompt_version: string;
  model?: string | null;
  error?: string | null;
}

export const ai = {
  status: () => apiRequest<{ configured: boolean }>("/api/ai/linelist/status"),

  linelist: {
    analyze: (body: {
      headers: string[];
      mapping: Record<string, string>;
      rows: Record<string, string>[];
    }) => apiRequest<AiAnalyzeResponse>("/api/ai/linelist/analyze", { method: "POST", body }),
    fix: (body: {
      headers: string[];
      mapping: Record<string, string>;
      rows: Record<string, string>[];
      issues: unknown[];
    }) => apiRequest<AiFixResponse>("/api/ai/linelist/fix", { method: "POST", body }),
  },

  psur: {
    reviewPdf: (file: File, product: string, reportingPeriod: string) =>
      apiUpload<AiPsurReviewResponse>("/api/ai/psur/review-pdf", file, {
        product,
        reportingPeriod,
      }),
    reviewSpreadsheet: (body: {
      filename: string;
      columns: string[];
      rows: Record<string, string>[];
      product: string;
      reportingPeriod: string;
      stats: Record<string, unknown>;
    }) =>
      apiRequest<AiPsurReviewResponse>("/api/ai/psur/review-spreadsheet", { method: "POST", body }),
    fix: (body: {
      filename: string;
      sourceType: "PDF" | "SPREADSHEET";
      acceptedFindings: {
        id: string;
        category: string;
        section: string;
        description: string;
        evidence: string;
      }[];
      columns?: string[] | undefined;
      rows?: Record<string, string>[] | undefined;
    }) => apiRequest<AiPsurFixResponse>("/api/ai/psur/fix", { method: "POST", body }),
  },

  icsr: {
    extractImage: (file: File) =>
      apiUpload<AiIcsrExtractionResponse>("/api/ai/icsr/extract-image", file),
  },

  coding: {
    /** Never returns a dictionary code — only a candidate standardised term
     *  name for a human to verify against the real MedDRA/WHODrug
     *  dictionary. See CODING_TERM_SUGGEST_PROMPT and AiCodingCandidate's
     *  code-shaped-term rejection (src/server/ai/schemas.py) for the two
     *  layers that enforce this. */
    suggest: (body: { dictionary: "MedDRA" | "WHODrug"; text: string }) =>
      apiRequest<AiCodingSuggestResponse>("/api/ai/coding/suggest", { method: "POST", body }),
  },

  literature: {
    /** Structured clinical reading of one screened article — layered on
     *  top of the deterministic keyword engine, never a replacement for
     *  it. Output is labelled AI assist; a human decides what becomes a
     *  signal or case. */
    analyze: (body: { title: string; text: string }) =>
      apiRequest<AiLiteratureAnalyzeResponse>("/api/ai/literature/analyze", {
        method: "POST",
        body,
      }),
    /** Upload an actual article document (PDF / Word / plain text): the
     *  backend extracts the text server-side and analyses it in one
     *  request. The extracted text always comes back so the keyword
     *  engine can screen it even when the AI layer is unavailable. */
    analyzeDocument: (file: File) =>
      apiUpload<AiLiteratureDocumentResponse>("/api/ai/literature/analyze-document", file),
  },
};
