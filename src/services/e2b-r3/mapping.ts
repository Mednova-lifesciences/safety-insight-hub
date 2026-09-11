import type {
  CodedTerm,
  DrugCharacterization,
  FieldMappingResolution,
  NullFlavor,
  OtherCaseIdentifiers,
  PVCase,
  PVProduct,
  PVReaction,
  ReactionOutcome,
  RequiredValue,
  SeriousnessCriteria,
  SexCode,
  SourceReactionDecoding,
  WhoDrugCodedProduct,
} from "./types";
import type { MedDraCodingProvider, WhoDrugCodingProvider } from "./coding-provider";
import type { SourceProfile } from "./source-profiles/types";
import type { E2bTransmissionConfig } from "./transmission-config";
import { parseCompoundSourceValue } from "./compound-source-parser";

/**
 * The canonical, already-column-mapped row shape the E2B engine operates
 * on — the OUTPUT of applying a SourceProfile.columnMap to a raw source
 * record, and the shape mapSourceRecordToPVCase's engine logic actually
 * understands. The engine never sees a source's own column names directly.
 */
export interface RawLineListRow {
  case_id?: string | undefined;
  patient_identifier?: string | undefined;
  product?: string | undefined;
  reaction?: string | undefined;
  onset_date?: string | undefined;
  seriousness?: string | undefined;
  outcome?: string | undefined;
  sex?: string | undefined;
  age?: string | undefined;
  vaccination_date?: string | undefined;
  vaccine_batch?: string | undefined;
  /** A separate NUMERIC seriousness-criterion code, distinct from the
   *  word-shaped `seriousness` field — see ColumnMap.seriousCode's doc
   *  comment. Absent when a source doesn't have one. */
  serious_code?: string | undefined;
  dose?: string | undefined;
  reporter_designation?: string | undefined;
  reporter_phone?: string | undefined;
  is_followup?: string | undefined;
  previous_case_id?: string | undefined;
}

/**
 * Applies a SourceProfile's columnMap to one raw source record (a source's
 * OWN column names, e.g. Ondo's "reaction" or Facility B's
 * "event_category") to produce the canonical RawLineListRow shape the
 * engine understands. This is the boundary where "which line-list is
 * this" stops mattering — everything downstream of this function is
 * completely source-agnostic.
 */
export function applyColumnMap(
  sourceRecord: Record<string, string | undefined>,
  profile: SourceProfile,
): RawLineListRow {
  const get = (col?: string): string | undefined => (col ? sourceRecord[col] : undefined);
  return {
    case_id: get(profile.columnMap.caseId),
    patient_identifier: get(profile.columnMap.patientIdentifier),
    sex: get(profile.columnMap.sex),
    age: get(profile.columnMap.age),
    reaction: get(profile.columnMap.reaction),
    onset_date: get(profile.columnMap.onsetDate),
    product: get(profile.columnMap.product),
    vaccination_date: get(profile.columnMap.vaccinationDate),
    vaccine_batch: get(profile.columnMap.batchNumber),
    serious_code: get(profile.columnMap.seriousCode),
    dose: get(profile.columnMap.dose),
    outcome: get(profile.columnMap.outcome),
    seriousness: get(profile.columnMap.seriousness),
    reporter_designation: get(profile.columnMap.reporterDesignation),
    reporter_phone: get(profile.columnMap.reporterPhone),
    is_followup: get(profile.columnMap.isFollowUp),
    previous_case_id: get(profile.columnMap.previousCaseId),
  };
}

/** "ADEBOLA ESTHER" -> "A.E." — pseudonymised initials, never a real name.
 *  A value that's already short/single-token passes through unchanged.
 *  This is option (a) of decision D1 — implemented because it's a
 *  pre-approved option, not because D1 has been formally signed off. */
export function deriveInitials(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return trimmed.toUpperCase();
  return parts.map((p) => p[0]!.toUpperCase()).join(".") + ".";
}

/** Common source date shapes (dd/mm/yy, dd/mm/yyyy, yyyy-mm-dd and "-"
 *  variants) parsed into ISO 8601 (YYYY-MM-DD). Returns null — never a
 *  guess — when the format can't be confidently determined. */
export function parseSourceDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(v);
  if (m) {
    let year = m[3]!;
    if (year.length === 2) year = (Number(year) < 50 ? "20" : "19") + year;
    return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

const DEFAULT_SEX_WORDS: Record<string, SexCode> = {
  M: "MALE",
  MALE: "MALE",
  F: "FEMALE",
  FEMALE: "FEMALE",
};

/** Consults the active profile's sexMap first (a source can use its own
 *  vocabulary), falling back to this engine's built-in M/F/MALE/FEMALE
 *  recognition when the profile doesn't override that exact value. Never
 *  guesses beyond either of those two sources. */
export function mapSex(raw: string | undefined, profile?: SourceProfile): SexCode | undefined {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return undefined;
  return profile?.sexMap?.[v] ?? DEFAULT_SEX_WORDS[v];
}

// Keys here are matched AFTER whitespace/underscore/hyphen stripping (see
// mapSeriousness below), so "NON SERIOUS"/"NON_SERIOUS"/"non-serious" all
// normalize to the single "NONSERIOUS" key.
const DEFAULT_SERIOUSNESS_WORDS: Record<string, boolean> = {
  SERIOUS: true,
  YES: true,
  Y: true,
  NONSERIOUS: false,
  NO: false,
  N: false,
};

/** Only fires on a value already unambiguously meaning serious/non-serious
 *  — this is the source's case-level AGGREGATE value only; per the spec it
 *  must never itself become an E2B seriousness element (see
 *  PVCase.aggregateSeriousnessAsReported and PVReaction.seriousnessCriteria). */
export function mapSeriousness(
  raw: string | undefined,
  profile?: SourceProfile,
): boolean | undefined {
  const v = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
  if (!v) return undefined;
  return profile?.seriousnessMap?.[v] ?? DEFAULT_SERIOUSNESS_WORDS[v];
}

/**
 * THE GENERIC "decode -> explicit map" pipeline (task requirement): a
 * source value can be fully UNDERSTOOD (its codebook decodes it to a
 * real concept) while still having NO approved representation in this
 * engine's small, fixed canonical vocabulary for that field — those are
 * two different failure modes, and this function is the one place that
 * distinguishes them, for every field that has such a vocabulary
 * (currently: outcome, seriousness-criterion code — see
 * PVReaction.outcomeResolution / seriousnessCodeResolution). Reaction
 * terms and product names do NOT go through this — they target an
 * open-ended licensed dictionary (MedDRA/WHODrug), not a small fixed
 * enum, and already have their own correctly fail-closed model.
 *
 * `canonicalMap` is the ONLY place a "decoded concept has no target"
 * verdict can flip to "mapped" — it is always a plain, explicit lookup
 * (a built-in synonym dictionary for the field's fixed ICH vocabulary,
 * merged with any profile-supplied override) — never inference, never
 * an AI call, never a default.
 */
export function resolveFieldConcept<T>(
  raw: string | undefined,
  profile: SourceProfile,
  field: string,
  canonicalMap: (concept: string, profile: SourceProfile) => T | undefined,
): FieldMappingResolution<T> | undefined {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  const codebook = profile.fieldCodebooks?.[field];

  let concept: string;
  if (codebook) {
    // A codebook exists for this field — it is now the sole authority on
    // whether this raw code means anything at all. No entry means the
    // source concept itself is unknown; never fall through to guessing
    // via the raw text (that would be exactly "treat local code 2 as if
    // it were E2B code 2" — the numeric-collision mistake this exists to
    // prevent).
    const entry = codebook.entries[trimmed.toUpperCase()];
    if (!entry) return { rawSourceValue: raw, status: "UNKNOWN_SOURCE_CODE" };
    concept = entry.meaning;
  } else if (!/[A-Za-z]/.test(trimmed)) {
    // No codebook configured for this field, AND the raw value is
    // shaped like a bare code (no letters at all) — e.g. "1". A number
    // with nothing to decode it is not an "understood concept" the way
    // real words are; treating it as one would silently reintroduce the
    // numeric-collision mistake (source code "2" happening to look like
    // it means E2B outcome "2"). Genuinely unknown, not merely unmapped.
    return { rawSourceValue: raw, status: "UNKNOWN_SOURCE_CODE" };
  } else {
    // No codebook configured for this field, but the raw text itself
    // contains real words (a word-based source, e.g. a cell that already
    // reads "Recovered") — understood exactly as well as any
    // plain-language value; whether it has a canonical target is the
    // separate question canonicalMap answers below.
    concept = trimmed;
  }

  const mapped = canonicalMap(concept, profile);
  return mapped !== undefined
    ? { rawSourceValue: raw, decodedSourceValue: concept, canonicalValue: mapped, status: "MAPPED" }
    : { rawSourceValue: raw, decodedSourceValue: concept, status: "HUMAN_REVIEW_REQUIRED" };
}

/** The fixed ICH E2B(R3) outcome vocabulary's own common English
 *  synonyms — not any one source's wording, the standard's. A decoded
 *  concept that doesn't match one of these (e.g. "Hospitalized",
 *  "Observed overnight") is never guessed into the nearest-looking entry
 *  — see resolveFieldConcept. */
const CANONICAL_OUTCOME_CONCEPTS: Record<string, ReactionOutcome> = {
  RECOVERED: "RECOVERED",
  RESOLVED: "RECOVERED",
  RECOVERING: "RECOVERING",
  RESOLVING: "RECOVERING",
  NOTRECOVERED: "NOT_RECOVERED",
  NOTRESOLVED: "NOT_RECOVERED",
  ONGOING: "NOT_RECOVERED",
  RECOVEREDWITHSEQUELAE: "RECOVERED_WITH_SEQUELAE",
  RESOLVEDWITHSEQUELAE: "RECOVERED_WITH_SEQUELAE",
  FATAL: "FATAL",
  DIED: "FATAL",
  DEATH: "FATAL",
  DECEASED: "FATAL",
  UNKNOWN: "UNKNOWN",
};

/** The canonical-mapping step for outcome — consults the active
 *  profile's explicit override (SourceProfile.outcomeMap) first, then
 *  the fixed ICH synonym dictionary above. Never anything else. */
export function mapConceptToOutcome(
  concept: string,
  profile?: SourceProfile,
): ReactionOutcome | undefined {
  const key = concept
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
  if (!key) return undefined;
  return profile?.outcomeMap?.[key] ?? CANONICAL_OUTCOME_CONCEPTS[key];
}

/** True only for a value shaped like a plain decimal number (one dot,
 *  digits either side) — the one case where a bare "." must never be
 *  treated as a delimiter candidate at all, confirmed or not. */
function looksLikePlainDecimal(v: string): boolean {
  return /^\d+\.\d+$/.test(v);
}

/**
 * Splits a raw multi-value field using ONLY the active profile's
 * explicitly configured separators (SourceProfile.reactionDelimiter) —
 * never a hardcoded global regex. If the value doesn't cleanly split on a
 * configured separator but still looks like it might contain more than
 * one value (contains a "." that isn't a plain decimal, or any character
 * that isn't part of a clean single token), the WHOLE raw value is
 * quarantined as a single unresolved entry rather than guessed at — see
 * types.ts's SourceDecodingStatus.DELIMITER_QUARANTINED.
 */
/** The fixed ICH E2B(R3) seriousness criteria's own common English
 *  synonyms/spellings (life-threatening, death, hospitalization,
 *  disability, congenital anomaly, other-medically-important) — the six
 *  criteria every E2B(R3) filer uses by definition, not any one source's
 *  vocabulary. A decoded concept that matches none of these (e.g. a
 *  future source's "Significant harm") is never guessed at — see
 *  resolveFieldConcept. */
function canonicalSeriousnessCriterionConcept(
  meaning: string,
): Partial<SeriousnessCriteria> | undefined {
  const v = meaning.toUpperCase();
  if (v.includes("DEATH") || v.includes("DIED") || v.includes("DECEASED") || v.includes("FATAL"))
    return { resultsInDeath: true };
  if (v.includes("LIFE") && (v.includes("THREAT") || v.includes("TREATH")))
    return { lifeThreatening: true };
  if (v.includes("HOSPITAL")) return { hospitalization: true };
  if (v.includes("CONGENITAL")) return { congenitalAnomaly: true };
  if (v.includes("DISAB")) return { disabling: true };
  if (v.includes("OTHER") && v.includes("MEDICAL")) return { otherMedicallyImportant: true };
  return undefined;
}

/** The canonical-mapping step for a seriousness-criterion code —
 *  consults the active profile's explicit override
 *  (SourceProfile.seriousnessCriterionMap) first, then the fixed ICH
 *  criterion dictionary above. Never anything else. */
export function mapConceptToSeriousnessCriteria(
  concept: string,
  profile?: SourceProfile,
): Partial<SeriousnessCriteria> | undefined {
  const key = concept.trim().toUpperCase();
  if (!key) return undefined;
  return profile?.seriousnessCriterionMap?.[key] ?? canonicalSeriousnessCriterionConcept(concept);
}

export interface SplitResult {
  /** Individual values when a configured separator matched (length may be
   *  1 for a clean single value). Empty when the field was blank. */
  values: string[];
  /** True when the raw field could not be confidently split (or confirmed
   *  as a single value) using only the profile's configured separators —
   *  callers must quarantine the whole raw value, never guess. */
  quarantined: boolean;
  rawValue: string;
}

export function splitBySourceProfile(raw: string | undefined, profile: SourceProfile): SplitResult {
  const rawValue = (raw ?? "").trim();
  if (!rawValue) return { values: [], quarantined: false, rawValue };

  const escaped = profile.reactionDelimiter.separators.map((s) =>
    s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  if (escaped.length > 0) {
    const pattern = new RegExp(`\\s*(?:${escaped.join("|")})\\s*`, "i");
    if (pattern.test(rawValue)) {
      const parts = rawValue
        .split(pattern)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 1) return { values: parts, quarantined: false, rawValue };
    }
  }

  // No configured separator matched. If the value still contains a "."
  // that isn't a plain decimal (the classic ambiguous case — "8.19.21"
  // could be a list or a single oddly-formatted code), it cannot be
  // confidently treated as one clean value either — quarantine it.
  if (rawValue.includes(".") && !looksLikePlainDecimal(rawValue)) {
    return { values: [], quarantined: true, rawValue };
  }

  return { values: [rawValue], quarantined: false, rawValue };
}

/**
 * REACTION DECODING PIPELINE (task-mandated sequence):
 *   raw source value -> understand the field's codebook -> tokenize the
 *   raw cell using ONLY the codes that codebook actually defines -> decode
 *   each recognized code (preserving any attached verbatim text) -> flag
 *   only genuinely unresolved components -> MedDRA coding (a separate,
 *   later step, run only on a DECODED sourceTerm) -> E2B reaction instance.
 *
 * Delegates the actual tokenization to compound-source-parser.ts, which
 * knows nothing about reactions, Ondo, or any specific source — it only
 * ever sees "a raw string" and "a map of valid codes for this field."
 * This function's only job is translating that generic result into this
 * module's SourceReactionDecoding shape.
 */
export function decodeReactionField(
  raw: string | undefined,
  profile: SourceProfile,
): SourceReactionDecoding[] {
  if (!raw || !raw.trim()) return [];

  const parsed = parseCompoundSourceValue(
    raw,
    profile.reactionCodebook.entries,
    profile.reactionDelimiter.separators,
  );

  return parsed.tokens.map((token): SourceReactionDecoding => {
    if (token.status === "VALID_SOURCE_CODE") {
      return {
        status: "DECODED",
        localCode: token.sourceCode!,
        sourceTerm: token.decodedTerm!,
        attachedVerbatimText: token.attachedVerbatimText,
        sourceProfileId: profile.id,
        codebookVersion: profile.reactionCodebook.version,
      };
    }
    if (token.status === "MALFORMED") {
      return {
        status: "DELIMITER_QUARANTINED",
        localCode: token.rawToken,
        sourceProfileId: profile.id,
        codebookVersion: profile.reactionCodebook.version,
      };
    }
    return {
      status: "UNKNOWN_CODE",
      localCode: token.rawToken,
      sourceProfileId: profile.id,
      codebookVersion: profile.reactionCodebook.version,
    };
  });
}

async function codeReactionTerm(
  provider: MedDraCodingProvider,
  verbatim: string,
): Promise<CodedTerm> {
  return provider.resolveReaction(verbatim);
}

async function codeProductTerm(
  provider: WhoDrugCodingProvider,
  verbatim: string,
): Promise<WhoDrugCodedProduct> {
  return provider.resolveProduct(verbatim);
}

export interface MappingWarning {
  field: "reaction" | "product";
  sourceValue: string;
  message: string;
}

export interface MapRowResult {
  pvCase: PVCase;
  warnings: MappingWarning[];
}

/**
 * SOURCE PROFILE + RAW RECORD -> CANONICAL PV CASE MODEL. This is the one
 * engine entry point every source profile goes through — it never
 * branches on `profile.id`, never references "Ondo" or any other source
 * by name, and never reads a source's own column names directly (that
 * happened already, in applyColumnMap). Adding a new source means writing
 * a new SourceProfile; this function does not change.
 *
 * Every reaction gets its LOCAL CODE decoded via the active profile's
 * reactionCodebook BEFORE any MedDRA coding is attempted — a local code
 * with no codebook entry never reaches the MedDRA provider at all; it's
 * recorded as UNKNOWN_CODE and left for validation.ts to quarantine.
 *
 * WHODrug Option A: every product's verbatim name is always populated
 * regardless of coding outcome — WHODrug coding is attempted (so a future
 * licensed provider can populate it) but never required for this
 * function to produce a usable case.
 */
export async function mapSourceRecordToPVCase(
  sourceRecord: Record<string, string | undefined>,
  profile: SourceProfile,
  transmissionConfig: E2bTransmissionConfig,
  context: { jobId: string; sourceFile: string; sourceRow: number; processedAt: string },
  providers: { meddra: MedDraCodingProvider; whodrug: WhoDrugCodingProvider },
): Promise<MapRowResult> {
  const row = applyColumnMap(sourceRecord, profile);
  const warnings: MappingWarning[] = [];
  const caseIdPrefix = profile.caseIdPrefix ?? transmissionConfig.caseIdPrefix ?? context.jobId;
  const sendersCaseId = row.case_id?.trim() || `${caseIdPrefix}-${context.sourceRow}`;

  // --- Reactions: decode (source codebook) -> code (MedDRA), never the
  // other way around, never skipping the decode step.
  const reactionDecodings = decodeReactionField(row.reaction, profile);
  if (reactionDecodings.some((d) => d.status === "DELIMITER_QUARANTINED")) {
    warnings.push({
      field: "reaction",
      sourceValue: row.reaction ?? "",
      message:
        "Reaction value could not be confidently split using this source profile's configured delimiters, and was quarantined rather than guessed. Confirm the intended separator and either update the source profile or correct the source data.",
    });
  }
  const onsetDate = parseSourceDate(row.onset_date) ?? undefined;
  // Outcome: decode (source codebook, or the raw text itself for a
  // word-based source) -> explicit canonical mapping. A DECODED-but-
  // unmappable concept (e.g. "Hospitalized") never becomes `outcome` —
  // it surfaces only via outcomeResolution.status === "HUMAN_REVIEW_REQUIRED",
  // for validation.ts to block on, never inferred past.
  const outcomeResolution = resolveFieldConcept(
    row.outcome,
    profile,
    "outcome",
    mapConceptToOutcome,
  );
  const outcome =
    outcomeResolution?.status === "MAPPED" ? outcomeResolution.canonicalValue : undefined;

  // A separate NUMERIC seriousness-criterion code (e.g. Ondo's "If serious
  // case select appropriate code below", distinct from the word-shaped
  // `seriousness` field) goes through the exact same decode -> explicit-map
  // pipeline — applied to every reaction in the case, since this source
  // captures seriousness at case level with no basis to attribute it to
  // one specific reaction over another.
  const seriousnessCodeResolution = resolveFieldConcept(
    row.serious_code,
    profile,
    "seriousness",
    mapConceptToSeriousnessCriteria,
  );
  const seriousnessCriteria: SeriousnessCriteria =
    seriousnessCodeResolution?.status === "MAPPED" ? seriousnessCodeResolution.canonicalValue! : {};

  const reactions: PVReaction[] = await Promise.all(
    reactionDecodings.map(async (decoding, i) => {
      // MedDRA coding only ever runs on a DECODED source term — an
      // undecoded local code is never passed to a coding provider as if
      // it were a legitimate verbatim reaction term.
      const coded: CodedTerm =
        decoding.status === "DECODED"
          ? await codeReactionTerm(providers.meddra, decoding.sourceTerm!)
          : { sourceValue: decoding.localCode, status: "INVALID", mappingMethod: "NONE" };
      return {
        id: `${sendersCaseId}-r${i + 1}`,
        sourceDecoding: decoding,
        reaction: coded,
        onsetDate,
        outcome,
        outcomeResolution,
        // E.i.3.2a-f — see seriousnessCriteria computation above. Genuinely
        // {} (nothing guessed, and never blocking on its own) when the
        // source has no separate numeric seriousness-criterion code at
        // all — the word-shaped case-level aggregate
        // (aggregateSeriousnessAsReported) still cannot be safely
        // decomposed into these six criteria on its own, and is never
        // used to populate this.
        seriousnessCriteria,
        seriousnessCodeResolution,
      } satisfies PVReaction;
    }),
  );

  // --- Products: WHODrug Option A — verbatim name always populated,
  // coding attempted but never required. No codebook/decode step for
  // products (task explicitly scopes the codebook-quarantine requirement
  // to reactions only); a provider may still return UNMAPPED/etc, which
  // is fine and non-blocking under Option A (see validation.ts).
  const productSplit = splitBySourceProfile(row.product, profile);
  if (productSplit.quarantined) {
    warnings.push({
      field: "product",
      sourceValue: row.product ?? "",
      message:
        "Product value could not be confidently split using this source profile's configured delimiters, and was quarantined rather than guessed.",
    });
  }
  const drugStartDate = parseSourceDate(row.vaccination_date) ?? undefined;
  const products: PVProduct[] = await Promise.all(
    (productSplit.quarantined ? [productSplit.rawValue] : productSplit.values).map(
      async (value, i) => {
        const coded = await codeProductTerm(providers.whodrug, value);
        const characterization: DrugCharacterization = "SUSPECT";
        return {
          id: `${sendersCaseId}-p${i + 1}`,
          characterization,
          product: coded,
          batchNumber: row.vaccine_batch?.trim() || undefined,
          dose: row.dose?.trim() || undefined,
          startDate: drugStartDate,
        } satisfies PVProduct;
      },
    ),
  );

  const patientIdentifierRaw = row.patient_identifier?.trim();
  const identity: RequiredValue<{ kind: "INITIALS"; initials: string }> = patientIdentifierRaw
    ? { present: true, value: { kind: "INITIALS", initials: deriveInitials(patientIdentifierRaw) } }
    : { present: false, nullFlavor: "UNK" as NullFlavor };

  const reporterDesignationRaw = row.reporter_designation?.trim();
  // D2 (who the reporter is) isn't decided — this dataset's designation
  // column is a qualification, not a name, so C.2.r.1 genuinely has no
  // source here regardless of D2.
  const reporterNameValue: RequiredValue<string> = { present: false, nullFlavor: "NASK" };
  // C.2.r.4 — only set when this exact designation string has an entry in
  // the active profile's reporterQualificationMap. No entry means
  // genuinely unresolved, never guessed.
  const qualificationCode = reporterDesignationRaw
    ? profile.reporterQualificationMap[reporterDesignationRaw.toUpperCase()]
    : undefined;

  const isFollowUpRaw = (row.is_followup ?? "").trim().toUpperCase();
  const isFollowUp = isFollowUpRaw === "YES" || isFollowUpRaw === "TRUE" || isFollowUpRaw === "1";
  const previousTransmissionRef = row.previous_case_id?.trim() || undefined;

  // Report type (decision D3) is gated on its OWN explicit confirmation
  // flag — never on isTransmissionConfigConfirmed() (that checks the
  // whole D3+D4 bundle) and never on reportType's mere presence, since
  // transmissionConfig.reportType always holds a syntactically valid
  // ReportType (the "4" placeholder in the unconfirmed default) whether or
  // not NAFDAC has actually confirmed it — see transmission-config.ts's
  // reportTypeConfirmed doc comment for the bug this independent check
  // fixes. Kept independent of sender/receiver confirmation on purpose: a
  // deployment could legitimately have NAFDAC confirm C.1.3 before D4's
  // sender/receiver identifiers land, and this field should reflect that.
  const reportType: RequiredValue<typeof transmissionConfig.reportType> =
    transmissionConfig.reportTypeConfirmed === true
      ? { present: true, value: transmissionConfig.reportType }
      : { present: false, nullFlavor: "NASK" };

  const otherCaseIdentifiers: OtherCaseIdentifiers = { present: false, nullFlavor: "NI" };

  const pvCase: PVCase = {
    internalCaseId: `${context.jobId}-${context.sourceRow}`,
    sendersCaseId,
    // Per spec: "When MedNova creates the first electronic ICSR for a
    // case, C.1.1 and C.1.8.1 are identical." This pipeline only ever
    // creates first-time transmissions today (no follow-up source yet).
    worldwideUniqueId: sendersCaseId,
    // MedNova/SafetyCore is the reporting organisation submitting on
    // behalf of the facility, not the regulator itself.
    firstSenderOfCase: "2",
    reportType,
    dateOfCreation: context.processedAt,
    // No "date received from source" column exists in this dataset — the
    // processing timestamp is used as a conservative stand-in, not a
    // fabricated historical date.
    dateFirstReceived: context.processedAt,
    dateMostRecentInfo: context.processedAt,
    additionalDocumentsAvailable: false,
    // C.1.7 requires a genuine clinical/regulatory determination this
    // pipeline has no basis to make on its own — left unresolved rather
    // than inferred from seriousness.
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: otherCaseIdentifiers,
    followUp: isFollowUp
      ? previousTransmissionRef
        ? { isFollowUp: true, previousTransmissionRef }
        : { isFollowUp: true }
      : { isFollowUp: false },
    patient: {
      identity,
      sex: mapSex(row.sex, profile),
      age: row.age?.trim() || undefined,
      // Deliberately no ageUnit — see PVPatient.ageUnit doc comment.
    },
    reporter: {
      name: reporterNameValue,
      qualificationVerbatim: reporterDesignationRaw || undefined,
      qualificationCode,
      country: profile.country || undefined,
    },
    senderOrganisation:
      transmissionConfig.sender.organization === "__UNCONFIRMED__"
        ? undefined
        : transmissionConfig.sender.organization,
    reactions,
    products,
    aggregateSeriousnessAsReported: row.seriousness?.trim() || undefined,
    sourceInformation: {
      sourceFile: context.sourceFile,
      sourceRow: context.sourceRow,
      jobId: context.jobId,
      sourceProfileId: profile.id,
    },
  };

  return { pvCase, warnings };
}
