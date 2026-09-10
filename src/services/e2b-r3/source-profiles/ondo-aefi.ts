import type { SourceProfile } from "./types";

/**
 * The Ondo State AEFI line-list, represented as a source profile instead
 * of being hardcoded into the E2B engine. Everything Ondo-specific about
 * this dataset lives here: its column names (which happen to already be
 * the canonical names, since the existing upstream line-list ingestion in
 * src/services/api/linelist.ts already normalizes headers before this
 * profile ever sees a row — see docs/E2B-R3-SOURCE-PROFILES.md), its
 * (currently unsupplied) reaction codebook, its delimiter conventions, and
 * the reporter-qualification mapping MedNova supplied.
 */
export const ondoAefiProfile: SourceProfile = {
  id: "ondo-aefi",
  name: "Ondo State AEFI Line List",
  sourceVersion: "2026",
  effectiveDate: "2026-01-01",
  country: "NG",
  timezone: "Africa/Lagos",
  columnMap: {
    caseId: "case_id",
    patientIdentifier: "patient_identifier",
    sex: "sex",
    age: "age",
    reaction: "reaction",
    onsetDate: "onset_date",
    product: "product",
    vaccinationDate: "vaccination_date",
    batchNumber: "vaccine_batch",
    dose: "dose",
    outcome: "outcome",
    seriousness: "seriousness",
    // A genuinely separate real column from `seriousness` above (see
    // ColumnMap.seriousCode's doc comment) — mapped to the same
    // canonical field name (`serious_code`) linelist.ts's own upstream
    // ingestion already reserves for it. NOTE: as of this session,
    // linelist.ts's FIELD_KEYWORDS does not yet recognise this file's
    // actual header text ("If serious case select appropriste code 2
    // below.") — a separate, pre-existing upstream column-mapping gap,
    // not something this profile can fix on its own. See
    // docs/E2B-R3-SOURCE-PROFILES.md.
    seriousCode: "serious_code",
    reporterDesignation: "reporter_designation",
    reporterPhone: "reporter_phone",
    isFollowUp: "is_followup",
    previousCaseId: "previous_case_id",
  },
  // Comma and semicolon are the delimiters this dataset has been
  // confirmed to use for real (e.g. "8,19,21"). "AND" is deliberately NOT
  // listed here — it's handled generically by the compound-source-parser
  // as a CONDITIONAL delimiter (commits to a split only when every
  // resulting part is an exact codebook entry), so it never needs to be,
  // and must not be, declared as an unconditional profile separator —
  // that would defeat the "don't blindly split on 'and'" safety rule
  // (compound-source-parser.ts) for this profile specifically. A bare "."
  // (e.g. "8.19.21", "M.R") is also deliberately not listed — those
  // values are never split on "." at all.
  reactionDelimiter: { separators: [",", ";"] },
  // Ondo State's own official AEFI reaction codebook (what local codes
  // like "19", "8", "21" actually mean) has never been supplied by the
  // Ondo AEFI/immunisation focal person or DSNO — see
  // docs/E2B-R3-NAFDAC-VIGIFLOW.md's external-dependencies table. Empty on
  // purpose: every real Ondo reaction code correctly quarantines as
  // UNKNOWN_CODE until a real codebook document is provided and its
  // entries added here (or loaded from a supplied file at that time).
  reactionCodebook: { sourceId: "ondo-aefi", field: "reaction", version: "UNSUPPLIED", entries: {} },
  // Supplied by MedNova (not invented by this codebase) as example
  // category mappings against the ICH Appendix I(F) qualification
  // codelist (1=Physician, 2=Pharmacist, 3=Other health professional,
  // 4=Lawyer, 5=Consumer or other non-health professional). Keys are
  // matched case-insensitively against the source's free-text designation.
  reporterQualificationMap: {
    DOCTOR: "1",
    "MEDICAL OFFICER": "1",
    PHYSICIAN: "1",
    PHARMACIST: "2",
    NURSE: "3",
    MIDWIFE: "3",
    CHEW: "3",
    CHO: "3",
    JCHEW: "3",
    VACCINATOR: "3",
    PATIENT: "5",
    PARENT: "5",
    CAREGIVER: "5",
    "COMMUNITY INFORMANT": "5",
  },
  caseIdPrefix: "NG-MEDNOVA",
};
