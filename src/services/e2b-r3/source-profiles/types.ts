import type { ReactionOutcome, SeriousnessCriteria, SexCode } from "../types";

/**
 * The Source Profile abstraction. The E2B(R3) engine (mapping, validation,
 * serializer, batching) NEVER knows which real-world line-list produced a
 * PVCase — it only ever sees the canonical model. A SourceProfile is the
 * one place every source-specific assumption lives: column names, local
 * codebooks, delimiter conventions, reporter-designation vocabulary. Adding
 * a new line-list source (a different state, facility, ODK/DHIS2 export,
 * ...) means writing a new SourceProfile object, never touching
 * mapping.ts's engine logic, validation.ts, serializer.ts, or batching.ts.
 * See docs/E2B-R3-SOURCE-PROFILES.md.
 */

/** One entry in a versioned local reaction/adverse-event codebook — the
 *  ONLY legitimate way a local numeric/short code (e.g. Ondo's "19")
 *  becomes a real term. sourceTerm must always be a real, human-supplied
 *  value from the source's own official codebook document — never guessed,
 *  never inferred from the numeric value itself. */
export interface ReactionCodebookEntry {
  localCode: string;
  sourceTerm: string;
  effectiveFrom: string;
  effectiveTo?: string | undefined;
}

export interface ReactionCodebook {
  sourceId: string;
  field: string;
  version: string;
  /** Keyed by the normalized (trimmed, uppercased) local code. Empty is a
   *  completely legitimate state — it means "this source's official
   *  codebook has not been supplied yet," not an error in this module;
   *  every code will correctly quarantine as UNKNOWN_CODE until entries
   *  are added from a real, authoritative document. */
  entries: Record<string, ReactionCodebookEntry>;
}

/** Which separators this profile explicitly recognises for splitting a
 *  multi-value field into individual reaction/product instances. Anything
 *  not in this list (a bare "." is the classic case — could be a decimal,
 *  could be a list) is never auto-split or guessed; the whole raw field is
 *  quarantined instead. Matching is case-insensitive. */
export interface DelimiterConfig {
  separators: string[];
}

/** Canonical field names this engine understands — the RIGHT-hand side of
 *  a SourceProfile's columnMap. Every source profile maps its own raw
 *  column headers to these, so mapping.ts never has to know a source's
 *  actual column names. */
/** The four record sources D.1.1.1-D.1.1.4 distinguish. */
export type PatientRecordNumberSource = "GP" | "SPECIALIST" | "HOSPITAL" | "INVESTIGATION";

export interface ColumnMap {
  caseId?: string;
  patientIdentifier?: string;
  sex?: string;
  age?: string;
  /** D.2.2b — a column stating the unit the age is in ("Age Unit",
   *  "Years/Months"). Separate from `age` because most line lists put the
   *  number in one column and either state the unit in another or not at
   *  all. */
  ageUnit?: string;
  /** D.2.1 — the patient's date of birth, when the source has one. Never
   *  a substitute for `age` and never derived from it. */
  dateOfBirth?: string;
  /** D.2.3 — a column the source itself uses for an age GROUP (infant,
   *  child, adult). Distinct from `age`: a group is not a number, and a
   *  number is not a group. */
  ageGroup?: string;
  reaction?: string;
  onsetDate?: string;
  product?: string;
  vaccinationDate?: string;
  /** When the report was received — E2B C.1.4 / C.1.5. */
  reportDate?: string;
  batchNumber?: string;
  dose?: string;
  outcome?: string;
  seriousness?: string;
  /** A separate NUMERIC seriousness-criterion code, distinct from the
   *  word-shaped `seriousness` field above (e.g. Ondo's "Type of AEFI
   *  (Non-serious or Serious)" word column vs. its "If serious case
   *  select appropriate code below" numeric column — two different real
   *  columns in the same file). Optional: many sources will only have
   *  one or the other. */
  seriousCode?: string;
  reporterDesignation?: string;
  reporterPhone?: string;
  /** C.2.r.3 — the column naming the REPORTER's country, when the source
   *  has one. Overrides SourceProfile.country for that row. */
  reporterCountry?: string;
  /** E.i.9 — the column naming the country the REACTION occurred in. A
   *  separate fact from the reporter's country; never a substitute. */
  reactionCountry?: string;
  /** D.1.1.1-D.1.1.4 — the column holding the patient's medical record
   *  number. Distinct from `patientIdentifier`, which is the patient's
   *  name or initials (D.1). Which facility's record it is comes from
   *  SourceProfile.patientRecordNumberSource. */
  patientId?: string;
  /** C.2.r.1 — the column holding the reporter's own name. Distinct from
   *  `reporterDesignation` (C.2.r.4), which is their role. */
  reporterName?: string;
  isFollowUp?: string;
  previousCaseId?: string;
}

/** A field-specific, versioned code->meaning registry for a coded field
 *  OTHER than reaction (which keeps its own dedicated ReactionCodebook —
 *  it additionally needs compound-value/delimiter handling that
 *  single-value fields like outcome/seriousness don't). Shape
 *  deliberately mirrors ReactionCodebookEntry/ReactionCodebook so the two
 *  stay conceptually consistent. */
export interface FieldCodebookEntry {
  sourceCode: string;
  meaning: string;
}

export interface FieldCodebook {
  field: string;
  version: string;
  entries: Record<string, FieldCodebookEntry>;
}

export interface SourceProfile {
  /** Stable identifier, e.g. "ondo-aefi" — the E2B engine only ever
   *  records this for audit/traceability, never branches on it. */
  id: string;
  name: string;
  /** Version of the profile's OWN configuration (not any one codebook's
   *  version — see ReactionCodebook.version for that). */
  sourceVersion: string;
  effectiveDate: string;
  /** ISO 3166-1 alpha-2 — the country this source form's reports come
   *  from (C.2.r.3), used when the file itself has no reporter-country
   *  column. Omitted by a profile that does not stand for one country;
   *  the country resolver then applies the application fallback. */
  country?: string | undefined;
  /** Which of the four D.1.1 record numbers `columnMap.patientId` holds.
   *  ICH makes the source of the number part of the data element — GP,
   *  specialist, hospital or investigation each have their own namespace
   *  OID — so a profile that maps a patient-id column says which one it
   *  is. Without it the number is imported and kept, but not exported as
   *  a record number of a provenance nobody stated. */
  patientRecordNumberSource?: PatientRecordNumberSource | undefined;
  /**
   * D.2.2b — the unit this source's age column is always in, when the
   * FORM itself settles the question (a column headed "Age (years)", or a
   * register whose instructions require months under two). Declared here,
   * never inferred from the values.
   *
   * Ranks below a unit the row itself states and above the application's
   * years default, so a source that knows its own unit never has an
   * assumption recorded against every one of its cases.
   */
  ageUnit?: "800" | "801" | "802" | "803" | "804" | "805" | undefined;
  timezone: string;
  columnMap: ColumnMap;
  /**
   * How this source WRITES its reaction field — a property of the form,
   * declared here, never inferred from the data.
   *
   *  - "CODED"    : the column holds local codes that mean nothing without
   *                 this profile's codebook ("19", "28pains"). An entry
   *                 that is not in the codebook must quarantine: guessing
   *                 what a code means is how a wrong reaction reaches a
   *                 regulator.
   *  - "VERBATIM" : the column already holds the reaction as words
   *                 ("Abscess", "Myalgia"). There is nothing to decode, so
   *                 demanding a codebook lookup rejects every row of a
   *                 perfectly good file.
   *
   * Defaults to "CODED" when a profile omits it, which preserves the
   * existing behaviour of every profile written before this existed.
   *
   * Deliberately NOT auto-detected. "Is this a code or a word?" looks
   * decidable until a source uses alphanumeric codes like "R19" or "AE-03",
   * at which point sniffing would pass a raw code to a regulator as if it
   * were the reaction itself. Only the person configuring the source knows,
   * so only they may say.
   */
  reactionEncoding?: "CODED" | "VERBATIM" | undefined;
  reactionDelimiter: DelimiterConfig;
  /** Product names may contain punctuation that is part of the registered
   * name (for example "Vaccine, Paediatric / IPV"). When omitted, preserve
   * the historical behaviour of using reaction delimiters for products. */
  productDelimiter?: DelimiterConfig | undefined;
  /** Only consulted when reactionEncoding is "CODED". A VERBATIM source
   *  legitimately has no codebook at all. */
  reactionCodebook: ReactionCodebook;
  /** C.2.r.4 — free-text reporter designation (as it appears in the
   *  source, e.g. "CHEW") -> one of the five Appendix I(F) qualification
   *  codes. Keyed case-insensitively. A designation with no entry here is
   *  NOT guessed — it quarantines the case for validated export (see
   *  validation.ts's E2B-REPORTER-QUALIFICATION-UNRESOLVED). */
  reporterQualificationMap: Record<string, "1" | "2" | "3" | "4" | "5">;
  /** Explicit, source-specific DECODED-CONCEPT -> canonical ReactionOutcome
   *  mapping (e.g. a source's own "Discharged home" -> RECOVERED, if a
   *  human/config author has actually decided that equivalence). Checked
   *  BEFORE the engine's built-in synonym dictionary for the six ICH
   *  outcome concepts (mapping.ts's CANONICAL_OUTCOME_CONCEPTS) — a
   *  profile can override or extend it, but a decoded concept matching
   *  neither is NEVER guessed at; see mapping.ts's resolveFieldConcept
   *  and types.ts's FieldMappingResolution/HUMAN_REVIEW_REQUIRED. */
  outcomeMap?: Record<string, ReactionOutcome> | undefined;
  /** Same principle as outcomeMap, for the numeric seriousness-CRITERION
   *  code's decoded concept -> one of E2B(R3)'s six fixed E.i.3.2a-f
   *  criteria (mapping.ts's mapConceptToSeriousnessCriteria). Checked
   *  before the built-in ICH criterion-keyword dictionary. */
  seriousnessCriterionMap?: Record<string, Partial<SeriousnessCriteria>> | undefined;
  seriousnessMap?: Record<string, boolean> | undefined;
  sexMap?: Record<string, SexCode> | undefined;
  /** Prefix used only when a row's own case-id column is blank and a
   *  fallback identifier must be generated — never overrides a real
   *  supplied case id. */
  caseIdPrefix?: string | undefined;
  /** Discovered, field-specific code registries for coded fields OTHER
   *  than reaction — keyed by canonical field name ("outcome",
   *  "seriousness", ...). Empty/absent by default; populated only by
   *  merging a real DiscoveredSourceCodebook via
   *  source-profiles/runtime-profile.ts's resolveRuntimeSourceProfile —
   *  never hand-authored with a specific source's real mappings, and
   *  never mutated on the base profile object itself. */
  fieldCodebooks?: Record<string, FieldCodebook> | undefined;
}
