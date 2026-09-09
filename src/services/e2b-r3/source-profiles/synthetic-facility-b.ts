import type { SourceProfile } from "./types";

/**
 * A SECOND, wholly synthetic source profile — NOT a real patient dataset,
 * not modelled on any real facility. Its entire purpose is the
 * architectural acceptance test: prove the same E2B(R3) engine (mapping,
 * validation, batching, serializer) can process a line list with
 * completely different column names, a different multi-value delimiter,
 * and a different reporter-designation vocabulary than Ondo's, by
 * changing ONLY this profile — never mapping.ts, validation.ts,
 * serializer.ts, or batching.ts. See
 * src/services/e2b-r3/source-agnosticism.test.ts.
 *
 * Unlike ondoAefiProfile, this profile ships with a small POPULATED
 * reaction codebook — since it's entirely fictional test data, inventing
 * a codebook for it carries none of the real-world risk that inventing
 * one for Ondo's actual codes would; it exists only to prove the DECODED
 * path (not just the UNKNOWN_CODE/quarantine path) works end to end.
 */
export const syntheticFacilityBProfile: SourceProfile = {
  id: "synthetic-facility-b",
  name: "Synthetic Facility B (test fixture only — not a real source)",
  sourceVersion: "test-1",
  effectiveDate: "2026-01-01",
  country: "NG",
  timezone: "Africa/Lagos",
  columnMap: {
    caseId: "record_id",
    patientIdentifier: "subject_name",
    sex: "gender",
    age: "age_years",
    reaction: "event_category",
    onsetDate: "event_date",
    product: "suspect_product",
    vaccinationDate: "admin_date",
    batchNumber: "lot_no",
    dose: "dose_given",
    outcome: "result",
    seriousness: "severity",
    reporterDesignation: "reporter_profession",
    reporterPhone: "contact_number",
    isFollowUp: "is_repeat_report",
    previousCaseId: "original_record_id",
  },
  // Deliberately a pipe, not Ondo's comma/semicolon/AND — proves the
  // delimiter itself is profile configuration, not an engine constant.
  reactionDelimiter: { separators: ["|"] },
  reactionCodebook: {
    sourceId: "synthetic-facility-b",
    field: "event_category",
    version: "test-1.0",
    entries: {
      C01: { localCode: "C01", sourceTerm: "Fever (synthetic test codebook entry)", effectiveFrom: "2026-01-01" },
      C02: { localCode: "C02", sourceTerm: "Injection site swelling (synthetic test codebook entry)", effectiveFrom: "2026-01-01" },
      C03: { localCode: "C03", sourceTerm: "Rash (synthetic test codebook entry)", effectiveFrom: "2026-01-01" },
    },
  },
  reporterQualificationMap: {
    CLINICIAN: "1",
    DRUGGIST: "2",
    "COMMUNITY HEALTH WORKER": "3",
    GUARDIAN: "5",
  },
  caseIdPrefix: "TEST-FACILITY-B",
};
