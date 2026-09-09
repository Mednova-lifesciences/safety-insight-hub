/**
 * Normalized, XML-independent domain model for an Individual Case Safety
 * Report (ICSR), built against the ICH E2B(R3) Implementation Guide as
 * refined by scripts/Ondo_AEFI_E2B_R3_Developer_Spec.docx (the authoritative
 * project-specific build spec — element numbers, conformance, and OIDs
 * below are taken from section 5 of that document, not invented).
 *
 * Deliberately does NOT use E2B/HL7 element names as field names. The XML
 * shape (see regulatory-assets/e2b-r3/official-ich/ — the real E2B(R3)
 * structure is a nested HL7 v3 message, not a flat tag-per-field document)
 * is a *serialization concern*, built from this model in a later stage —
 * never the other way around.
 */

/** HL7/E2B(R3) exceptional-value flavors — a required element with no
 *  value must still be present, carrying one of these; an optional element
 *  with no value must be omitted entirely (never an empty tag). The choice
 *  between these is a data-provenance decision, never a developer default
 *  (spec section 6.1) — e.g. "231 empty reaction start dates" almost
 *  certainly means NASK (never asked), not ASKU (asked, unknown), but that
 *  must be confirmed with the data owner, not assumed here. */
export type NullFlavor =
  | "NI" // No information
  | "MSK" // Masked — data exists but withheld (itself discloses that it exists)
  | "UNK" // Unknown — a proper value applies but isn't known
  | "NA" // Not applicable
  | "ASKU" // Asked but unknown
  | "NASK"; // Not asked

/** A required E2B(R3) value that may legitimately be unknown — forces
 *  every call site to handle the nullFlavor case explicitly rather than
 *  falling back to an empty string or a guessed default. */
export type RequiredValue<T> = { present: true; value: T } | { present: false; nullFlavor: NullFlavor };

/** Where a coded value actually came from, and how confident that coding
 *  is. Four distinct states, deliberately not collapsed into one another —
 *  each means something different for what a reviewer or the UI should do:
 *   - MAPPED: a real provider (licensed dictionary or an explicitly
 *     configured authorized mapping table) actually resolved this term.
 *   - UNMAPPED: a real provider was consulted but had no match for this
 *     specific value — the provider exists, this term just isn't in it.
 *   - INVALID: a provider was consulted and positively rejected the input
 *     (e.g. a malformed/empty verbatim value) — distinct from "no match
 *     found," since the fix here is data cleanup, not dictionary coverage.
 *   - PROVIDER_UNAVAILABLE: no provider was configured at all, so no
 *     mapping was even attempted — the honest default when neither a
 *     MedDRA/WHODrug license nor an authorized mapping table exists yet
 *     (see coding-provider.ts). This is the actual state of every reaction
 *     and product in this application today.
 *  Never invented, never silently defaulted to a guess. */
export type CodingStatus = "MAPPED" | "UNMAPPED" | "INVALID" | "PROVIDER_UNAVAILABLE";

export interface CodedTerm {
  /** What the source actually said, verbatim — always preserved regardless
   *  of coding outcome (E.i.1.1a / G.k.2.2 require the verbatim source
   *  term regardless of coding status; normalization must never overwrite
   *  it — spec 5.6). */
  sourceValue: string;
  /** The dictionary term this maps to, once actually coded. Undefined
   *  while status is anything other than MAPPED. */
  codedTerm?: string | undefined;
  /** MedDRA LLT code (E.i.2.1b) or WHODrug identifier. A source category
   *  number (e.g. Ondo's "19") must never appear here — spec 5.5. */
  code?: string | undefined;
  /** Dictionary version the code was assigned under (E.i.2.1a for
   *  reactions) — one version per ICSR; different ICSRs in one batch may
   *  use different versions (spec 6.2). A code without a version is not
   *  fully traceable. */
  dictionaryVersion?: string | undefined;
  status: CodingStatus;
  /** "LICENSED_DICTIONARY" for a real live dictionary/API, "AUTHORIZED_MAPPING_TABLE"
   *  for a pre-approved static table explicitly supplied as configuration
   *  (e.g. Ondo's own reaction codebook once NAFDAC/Ondo actually provide
   *  one — see coding-provider.ts's AuthorizedMappingTable providers),
   *  "AI_SUGGESTION" for an unverified model suggestion a human hasn't
   *  confirmed (never usable for export on its own), "NONE" when nothing
   *  attempted a mapping. */
  mappingMethod: "LICENSED_DICTIONARY" | "AUTHORIZED_MAPPING_TABLE" | "AI_SUGGESTION" | "NONE";
}

/** WHODrug Global C3's coded product shape — richer than a generic
 *  CodedTerm because C3's data model is itself richer than MedDRA's flat
 *  term hierarchy (spec section 3 of this task; UMC's WHODrug Global C3
 *  E2B(R3) mapping guidance). Every field beyond the base CodedTerm ones
 *  is populated ONLY by a real WhoDrugCodingProvider that actually looked
 *  the product up — never guessed from the product's free-text name. */
export interface WhoDrugCodedProduct extends CodedTerm {
  /** WHODrug Global C3 Medicinal Product ID (MPID) — the primary coded
   *  identifier for G.k.2.1.1b when coding at product level. */
  mpid?: string | undefined;
  /** Active ingredient/substance name, where the provider can supply it. */
  substanceName?: string | undefined;
  /** WHODrug Global C3 Substance ID — used for G.k.2.3.r.2b when coding at
   *  substance level (e.g. a vaccine with no exact MPID match but a known
   *  active substance). */
  substanceId?: string | undefined;
  strength?: string | undefined;
  pharmaceuticalForm?: string | undefined;
  /** WHODrug Global RID (Record Identification Number) — required by some
   *  E2B(R3) receivers for legacy-format cross-reference. Never invented;
   *  only ever set by a real provider. See coding-provider.ts's
   *  WHODRUG_GLOBAL_RID_OID for the fixed OID this identifies against. */
  rid?: string | undefined;
}

export type SexCode = "MALE" | "FEMALE" | "UNKNOWN_NOT_SPECIFIED";

export interface PVPatient {
  /** D.1 — at least one element in this section must be populated; full
   *  names must not be carried here (spec 5.4 / decision D1). Which of
   *  (a) derived initials, (b) a medical-record-number OID, or (c) a
   *  nullFlavor is used is decision D1 — not a developer default. Until
   *  D1 is recorded, this stays a RequiredValue so the gap is explicit
   *  rather than silently defaulted to option (a). */
  identity: RequiredValue<{ kind: "INITIALS"; initials: string } | { kind: "MEDICAL_RECORD_NUMBER"; number: string; sourceOid: string }>;
  sex?: SexCode | undefined;
  /** Raw age value as captured — see ageUnit for why this isn't coded
   *  further without a confirmed unit. */
  age?: string | undefined;
  /** Explicit E2B(R3) age-unit code (800=Decade,801=Year,802=Month,
   *  803=Week,804=Day,805=Hour) — left undefined, not guessed, when the
   *  source doesn't state a unit. An age value present with ageUnit
   *  undefined must render as a REQUIRES_REVIEW item, never silently
   *  assumed to be years — this matters especially for pediatric AEFI data. */
  ageUnit?: "800" | "801" | "802" | "803" | "804" | "805" | undefined;
}

/** C.1.3 — 1=Spontaneous report, 2=Report from study, 3=Other,
 *  4=Not available to sender. Which value routine AEFI surveillance uses
 *  is decision D3 (MedNova + NAFDAC) — never a developer default. */
export type ReportType = "1" | "2" | "3" | "4";

export interface PVReporter {
  /** C.2.r.1 — who the reporter actually is (the AEFI form signatory, the
   *  vaccinator, the state surveillance officer, ...) is decision D2 —
   *  not invented by the application. */
  name: RequiredValue<string>;
  /** C.2.r.3 — required administrative info; ISO 3166-1 alpha-2. Also
   *  feeds the country segment of C.1.1. */
  country?: string | undefined;
  qualificationVerbatim?: string | undefined;
  /** C.2.r.4 — coded per Appendix I(F), bound per decision D2. A free-text
   *  designation like "CHEW" is never auto-assigned a numeric qualification
   *  code by guessing. */
  qualificationCode?: "1" | "2" | "3" | "4" | "5" | undefined;
  organization?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
}

/** E.i.3.2a-f — captured PER REACTION/EVENT in E2B(R3), never once per
 *  case (spec 5.5: "there is no single case-level serious flag to map the
 *  current free-text value onto"). This is a structural correction from
 *  this codebase's first-draft model, which incorrectly put seriousness
 *  on PVCase. */
export interface SeriousnessCriteria {
  resultsInDeath?: boolean | undefined;
  lifeThreatening?: boolean | undefined;
  hospitalization?: boolean | undefined;
  disabling?: boolean | undefined;
  congenitalAnomaly?: boolean | undefined;
  otherMedicallyImportant?: boolean | undefined;
}

export type ReactionOutcome =
  | "RECOVERED"
  | "RECOVERING"
  | "NOT_RECOVERED"
  | "RECOVERED_WITH_SEQUELAE"
  | "FATAL"
  | "UNKNOWN";

/** Where a local source-specific reaction code stands in the SOURCE
 *  CODEBOOK decoding step — deliberately a step BEFORE and SEPARATE FROM
 *  MedDRA coding (CodedTerm.status). A local code like Ondo's "19" is
 *  never itself a verbatim reaction term, let alone a MedDRA code — see
 *  docs/E2B-R3-SOURCE-PROFILES.md's "three distinct concepts" section.
 *   - DECODED: the active source profile's reactionCodebook has an entry
 *     for this exact local code — sourceTerm is that entry's real,
 *     human-authored term, never guessed.
 *   - UNKNOWN_CODE: the codebook was consulted but has no entry for this
 *     code — the case must quarantine, not fall through to MedDRA coding
 *     on the raw numeric value.
 *   - BLANK: the reaction field was empty for this instance.
 *   - DELIMITER_QUARANTINED: the raw field contained what might be
 *     multiple values, but used a separator the active profile doesn't
 *     explicitly recognise (e.g. a bare "."), so it was never split or
 *     guessed — the whole raw string is quarantined as one unresolved
 *     value for human review. */
export type SourceDecodingStatus = "DECODED" | "UNKNOWN_CODE" | "BLANK" | "DELIMITER_QUARANTINED";

export interface SourceReactionDecoding {
  status: SourceDecodingStatus;
  /** The raw value exactly as it appeared in the source field (a single
   *  local code once split, or the whole raw field when quarantined). */
  localCode: string;
  /** Only present when status is DECODED — the codebook's real term. */
  sourceTerm?: string | undefined;
  /** Which source profile and codebook version produced this decoding —
   *  essential provenance once multiple profiles/codebook versions exist. */
  sourceProfileId: string;
  codebookVersion?: string | undefined;
}

export interface PVReaction {
  /** Stable identity within the case — reactions/products can reference
   *  each other via G.k.9.i (drug-reaction matrix) once that structure is
   *  built. */
  id: string;
  /** Local-codebook decoding outcome for this reaction instance — see
   *  SourceReactionDecoding. reaction.sourceValue below is always the
   *  DECODED term when status is DECODED, or the raw local code
   *  otherwise; never conflate the two. */
  sourceDecoding: SourceReactionDecoding;
  reaction: CodedTerm;
  /** E.i.4 — optional; omit entirely when unknown, never an empty tag. */
  onsetDate?: string | undefined; // ISO 8601 (YYYY-MM-DD) once parsed; never a raw source string
  endDate?: string | undefined;
  /** E.i.7 — required admin info in practice ("optional but expected" per
   *  spec) but a raw, un-decoded source code must never be presented as
   *  if it were this coded value. */
  outcome?: ReactionOutcome | undefined;
  /** True only when the source's outcome value didn't match any of this
   *  app's known outcome words — surfaced so it's never silently treated
   *  as equivalent to an actual coded outcome. */
  outcomeUnmapped?: string | undefined;
  /** E.i.3.2a-f — six independent booleans. Left entirely empty (not
   *  guessed) when the source only provides an aggregate case-level value
   *  like "NON SERIOUS" — see PVCase.aggregateSeriousnessAsReported for
   *  where that raw value is preserved instead. */
  seriousnessCriteria: SeriousnessCriteria;
}

/** G.k.1 — 1=Suspect, 2=Concomitant, 3=Interacting, 4=Drug not administered. */
export type DrugCharacterization = "SUSPECT" | "CONCOMITANT" | "INTERACTING" | "NOT_ADMINISTERED";

export interface PVProduct {
  id: string;
  characterization: DrugCharacterization;
  /** WHODrug Global C3-shaped, not a generic CodedTerm — see
   *  WhoDrugCodedProduct's doc comment for why. */
  product: WhoDrugCodedProduct;
  /** G.k.4.r.7 — high value for AEFI signal detection; recovered verbatim
   *  from source, never invented. */
  batchNumber?: string | undefined;
  dose?: string | undefined;
  route?: string | undefined;
  /** G.k.4.r.4 — vaccination date, where recorded. */
  startDate?: string | undefined;
}

/** C.1.9.1 — boolean-shaped but "false" is explicitly not a valid E2B
 *  value: emit either true+details, or nullFlavor NI. Modelled so "false"
 *  is structurally unrepresentable rather than a validation rule someone
 *  has to remember (spec 5.2: "a common source of validation failures"). */
export type OtherCaseIdentifiers =
  | { present: true; identifiers: { identifier: string; source: string }[] }
  | { present: false; nullFlavor: "NI" };

export interface PVCase {
  /** This app's own internal case identifier — never placed in a
   *  regulatory sender/receiver identifier field. */
  internalCaseId: string;
  /** C.1.1 — country–organisation–report-number, e.g. NG-MEDNOVA-000112
   *  (spec 5.2). Stable across retransmission of the same case; may only
   *  change on organisational change or a primary-source country change.
   *  The organisation segment and exact formatting are configuration
   *  (decision D4), not hardcoded here. */
  sendersCaseId: string;
  /** C.1.8.1 — distinct from sendersCaseId: this must NEVER change across
   *  any retransmission, by anyone, ever, for the life of the case. Equal
   *  to sendersCaseId only at the moment of first creation. VigiFlow's
   *  follow-up matching keys on this alongside sender org + sendersCaseId
   *  (spec section 7) — instability here either creates duplicate cases or
   *  silently overwrites an unrelated one. */
  worldwideUniqueId: string;
  /** C.1.8.2 — 1=Regulator, 2=Other. */
  firstSenderOfCase: "1" | "2";
  reportType: RequiredValue<ReportType>; // C.1.3 — see decision D3
  /** C.1.2 — functions as the version number; strictly increasing per
   *  case, a new value on every retransmission. */
  dateOfCreation: string;
  /** C.1.4 — date the four minimum criteria were first met. */
  dateFirstReceived: string;
  /** C.1.5 — updated on every follow-up. Required admin info. */
  dateMostRecentInfo: string;
  /** C.1.6.1 — required boolean; if true, list documents in C.1.6.1.r.1
   *  (not yet modelled — no source of document listings in this pipeline
   *  yet). */
  additionalDocumentsAvailable: boolean;
  /** C.1.7 — required boolean; nullFlavor NI permitted only when
   *  retransmitting a case first received in R2 format. */
  fulfilsExpeditedCriteria: RequiredValue<boolean>;
  /** C.1.9.1 — see OtherCaseIdentifiers doc comment for why "false" isn't
   *  a valid state here. */
  otherCaseIdentifiersInPreviousTransmissions: OtherCaseIdentifiers;
  followUp: {
    isFollowUp: boolean;
    /** Which prior transmission this follows, when isFollowUp is true.
     *  Required for a true follow-up — a follow-up with no reference is a
     *  validation error, not a silently-accepted new case. */
    previousTransmissionRef?: string | undefined;
  };
  /** C.1.11.1 — nullification/amendment. Not yet populated by any mapping
   *  in this pipeline (no source of nullification requests today) but
   *  modelled now per the spec's explicit instruction to build this
   *  before cases are live rather than retrofit it. */
  nullificationOrAmendment?: { isNullification: boolean; reason?: string | undefined } | undefined;
  patient: PVPatient;
  reporter: PVReporter;
  /** C.3.2 — sender's organisation, required admin info. Replaces the old
   *  generator's per-case custom <preparedby> tag entirely (spec 5.3):
   *  sender identity is a single case-level regulatory field, sourced from
   *  decision-D4 configuration, not free text invented per export. */
  senderOrganisation?: string | undefined;
  reactions: PVReaction[];
  products: PVProduct[];
  /** The source's own case-level aggregate value (e.g. "NON SERIOUS"),
   *  preserved for audit/traceability — but never itself exported as an
   *  E2B seriousness element; see PVReaction.seriousnessCriteria for what
   *  actually gets serialized. */
  aggregateSeriousnessAsReported?: string | undefined;
  /** H.1 — original reporter narrative, verbatim — never replaced by an
   *  AI-generated summary. An AI summary, if produced, is a distinct field
   *  a human explicitly reviews, never silently substituted here. */
  narrative?: string | undefined;
  sourceInformation: {
    sourceFile: string;
    sourceRow: number;
    jobId: string;
    /** Which SourceProfile produced this case — the E2B engine itself
     *  never branches on this value; it exists purely for audit/
     *  traceability (see src/services/e2b-r3/source-profiles/). */
    sourceProfileId: string;
  };
}
