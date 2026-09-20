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
import type { DelimiterConfig, SourceProfile } from "./source-profiles/types";
import type { E2bTransmissionConfig } from "./transmission-config";
import { buildCaseSafetyReportId } from "./case-identifier";
import { resolveReactionCountry, resolveReporterCountry } from "./country";
import { parseCompoundSourceValue } from "./compound-source-parser";
import { normalizeDesignationKey } from "./regulatory-config";

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
  report_date?: string | undefined;
  vaccine_batch?: string | undefined;
  /** A separate NUMERIC seriousness-criterion code, distinct from the
   *  word-shaped `seriousness` field — see ColumnMap.seriousCode's doc
   *  comment. Absent when a source doesn't have one. */
  serious_code?: string | undefined;
  dose?: string | undefined;
  reporter_designation?: string | undefined;
  reporter_phone?: string | undefined;
  /** C.2.r.3 — the reporter's/primary source's country, when the file has
   *  such a column. */
  reporter_country?: string | undefined;
  /** E.i.9 — the country the reaction occurred in, when the file says.
   *  A different fact from reporter_country. */
  reaction_country?: string | undefined;
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
    report_date: get(profile.columnMap.reportDate),
    vaccine_batch: get(profile.columnMap.batchNumber),
    serious_code: get(profile.columnMap.seriousCode),
    dose: get(profile.columnMap.dose),
    outcome: get(profile.columnMap.outcome),
    seriousness: get(profile.columnMap.seriousness),
    reporter_designation: get(profile.columnMap.reporterDesignation),
    reporter_phone: get(profile.columnMap.reporterPhone),
    reporter_country: get(profile.columnMap.reporterCountry),
    reaction_country: get(profile.columnMap.reactionCountry),
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
  // 1 — recovered / resolved
  RECOVERED: "RECOVERED",
  RESOLVED: "RECOVERED",
  FULLYRECOVERED: "RECOVERED",
  FULLYRESOLVED: "RECOVERED",
  RECOVEREDCOMPLETELY: "RECOVERED",
  COMPLETELYRECOVERED: "RECOVERED",
  RECOVERY: "RECOVERED",
  RECOVERYCOMPLETE: "RECOVERED",
  RESOLUTION: "RECOVERED",
  // 2 — recovering / resolving
  RECOVERING: "RECOVERING",
  RESOLVING: "RECOVERING",
  IMPROVING: "RECOVERING",
  IMPROVED: "RECOVERING",
  IMPROVEMENT: "RECOVERING",
  GETTINGBETTER: "RECOVERING",
  SYMPTOMSIMPROVING: "RECOVERING",
  RECOVERYONGOING: "RECOVERING",
  RESOLUTIONONGOING: "RECOVERING",
  // 3 — not recovered / not resolved / ongoing
  NOTRECOVERED: "NOT_RECOVERED",
  NOTRESOLVED: "NOT_RECOVERED",
  NOTYETRECOVERED: "NOT_RECOVERED",
  ONGOING: "NOT_RECOVERED",
  STILLONGOING: "NOT_RECOVERED",
  PERSISTENT: "NOT_RECOVERED",
  PERSISTING: "NOT_RECOVERED",
  PERSISTENTSYMPTOMS: "NOT_RECOVERED",
  SYMPTOMSONGOING: "NOT_RECOVERED",
  CONTINUING: "NOT_RECOVERED",
  CONTINUES: "NOT_RECOVERED",
  NOIMPROVEMENT: "NOT_RECOVERED",
  UNRESOLVED: "NOT_RECOVERED",
  // 4 — recovered / resolved with sequelae
  RECOVEREDWITHSEQUELAE: "RECOVERED_WITH_SEQUELAE",
  RESOLVEDWITHSEQUELAE: "RECOVERED_WITH_SEQUELAE",
  RECOVEREDWITHSEQUELA: "RECOVERED_WITH_SEQUELAE",
  RESOLVEDWITHSEQUELA: "RECOVERED_WITH_SEQUELAE",
  WITHSEQUELAE: "RECOVERED_WITH_SEQUELAE",
  RESIDUALEFFECTS: "RECOVERED_WITH_SEQUELAE",
  RECOVEREDWITHRESIDUALEFFECTS: "RECOVERED_WITH_SEQUELAE",
  RESOLVEDWITHRESIDUALEFFECTS: "RECOVERED_WITH_SEQUELAE",
  RECOVEREDWITHPERMANENTEFFECTS: "RECOVERED_WITH_SEQUELAE",
  // 5 — fatal. These are outcome-column words: the source itself has
  // classified how the reaction ended. Nothing here reads a narrative, and
  // no other field (seriousness, hospitalisation, causality, drug action)
  // can produce this value.
  FATAL: "FATAL",
  DIED: "FATAL",
  DEATH: "FATAL",
  DECEASED: "FATAL",
  // 0 — unknown
  UNKNOWN: "UNKNOWN",
  UNKNOWNOUTCOME: "UNKNOWN",
  OUTCOMEUNKNOWN: "UNKNOWN",
  UNKNOWNSTATUS: "UNKNOWN",
  NOTKNOWN: "UNKNOWN",
  NOTAVAILABLE: "UNKNOWN",
  OUTCOMENOTAVAILABLE: "UNKNOWN",
  OUTCOMENOTREPORTED: "UNKNOWN",
  NOTREPORTED: "UNKNOWN",
  NOTSTATED: "UNKNOWN",
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

export function splitBySourceProfile(
  raw: string | undefined,
  profile: SourceProfile,
  delimiter: DelimiterConfig = profile.reactionDelimiter,
): SplitResult {
  const rawValue = (raw ?? "").trim();
  if (!rawValue) return { values: [], quarantined: false, rawValue };

  const escaped = delimiter.separators.map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
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
/** Recorded as the codebook version for a VERBATIM source, so provenance
 *  stays honest: no codebook was consulted, because none applies. Never an
 *  empty string, which would read as "version unknown". */
export const VERBATIM_NO_CODEBOOK = "N/A-VERBATIM-SOURCE";

/** Splits a verbatim reaction cell on the profile's own declared
 *  separators. Uses the same separator list as the coded path so a source
 *  gets one consistent answer about what a delimiter is — and, as there,
 *  a separator the profile has not declared is never guessed at: the cell
 *  stays whole rather than being split on a character that might belong to
 *  the term itself. */
function splitVerbatimReactions(raw: string, profile: SourceProfile): string[] {
  const seps = profile.reactionDelimiter.separators;
  let parts = [raw];
  for (const sep of seps) {
    parts = parts.flatMap((p) => p.split(sep));
  }
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return cleaned.length > 0 ? cleaned : [raw.trim()];
}

export function decodeReactionField(
  raw: string | undefined,
  profile: SourceProfile,
): SourceReactionDecoding[] {
  if (!raw || !raw.trim()) return [];

  // A source that writes reactions as words has nothing to decode. Running
  // it through the codebook rejects every row of a valid file: a plain-text
  // "Abscess" is not in any numeric codebook, so it quarantines as
  // UNKNOWN_CODE and the case never exports. Measured on a real upload —
  // 0 of 3 cases exportable, purely because the source spells its reactions
  // out.
  //
  // The value still goes on to MedDRA coding exactly as a decoded term
  // would, and if no MedDRA provider is configured the serializer already
  // emits nullFlavor="UNK" with the text preserved in <originalText>. So
  // this never presents an uncoded term as if it were a dictionary code —
  // it just stops pretending a word is a code that needs looking up.
  if (profile.reactionEncoding === "VERBATIM") {
    return splitVerbatimReactions(raw, profile).map((term): SourceReactionDecoding => ({
      status: "DECODED",
      localCode: term,
      sourceTerm: term,
      sourceProfileId: profile.id,
      codebookVersion: VERBATIM_NO_CODEBOOK,
    }));
  }

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
/** Short, stable code identifying one uploaded line list (job) — the last
 *  8 alphanumerics of its id, upper-cased. Used so row-numbered case ids
 *  from different line lists never collide under a shared prefix. */
export function jobCaseCode(jobId: string): string {
  const alnum = jobId.replace(/[^A-Za-z0-9]/g, "");
  return (alnum.slice(-8) || jobId).toUpperCase();
}

export async function mapSourceRecordToPVCase(
  sourceRecord: Record<string, string | undefined>,
  profile: SourceProfile,
  transmissionConfig: E2bTransmissionConfig,
  context: { jobId: string; sourceFile: string; sourceRow: number; processedAt: string },
  providers: { meddra: MedDraCodingProvider; whodrug: WhoDrugCodingProvider },
): Promise<MapRowResult> {
  const row = applyColumnMap(sourceRecord, profile);
  const warnings: MappingWarning[] = [];
  // Without a source case id, the row number alone only identifies a case
  // within one line list. A configured prefix is shared by every upload, so
  // the job's own code is added to keep C.1.1/C.1.8.1 unique across line
  // lists (each line list holds new cases). The job-id fallback is already
  // unique per upload.
  const configuredPrefix = profile.caseIdPrefix ?? transmissionConfig.caseIdPrefix;
  const caseIdPrefix = configuredPrefix
    ? `${configuredPrefix}-${jobCaseCode(context.jobId)}`
    : context.jobId;
  const sendersCaseId = row.case_id?.trim() || `${caseIdPrefix}-${context.sourceRow}`;
  // C.2.r.3 — the reporter's/primary source's country: what the row says,
  // else what this source form stands for, else the application's own
  // fallback (country.ts documents that NG is MedNova's policy, not an ICH
  // rule). Resolved per row, so one line list may carry cases from
  // several countries.
  const reporterCountry = resolveReporterCountry({
    row: row.reporter_country,
    profile: profile.country,
  });
  // E.i.9 — where the reaction happened. Only ever what the source says:
  // never the reporter's country, and never a fallback. Per the ICH E2B(R3)
  // Q&A this value must not influence C.1.1, and it does not: the
  // identifier below is built from the reporter country alone.
  const reactionCountry = resolveReactionCountry(row.reaction_country);

  // C.1.1 / C.1.8.1. The country is the primary source's (C.2.r.3), the
  // organisation the configured sender (C.3.2) — so a different
  // organization, country or source form produces a correctly qualified
  // identifier without any change here. See case-identifier.ts.
  const caseSafetyReportId = buildCaseSafetyReportId({
    country: reporterCountry.code,
    organisation: transmissionConfig.sender.organization,
    caseNumber: sendersCaseId,
  });
  const reportDate = parseSourceDate(row.report_date) ?? undefined;

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
  // E.i.7 is a required element, so there is no "no outcome" state to
  // serialize: a source that says nothing about how the reaction ended is
  // reported as Unknown (ICH E.i.7 = 0), which is what it means.
  //
  // A source value that IS present but unrecognised is deliberately not
  // swept into Unknown here: it becomes HUMAN_REVIEW_REQUIRED, blocks
  // export, and surfaces in Settings -> Outcome terms for the organization
  // to decide once. Calling an unread word "Unknown" would quietly discard
  // information the file actually carries.
  const outcome: ReactionOutcome | undefined =
    outcomeResolution?.status === "MAPPED"
      ? outcomeResolution.canonicalValue
      : outcomeResolution === undefined
        ? "UNKNOWN"
        : undefined;

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
        ...(reactionCountry ? { countryOfOccurrence: reactionCountry } : {}),
      } satisfies PVReaction;
    }),
  );

  // --- Products: WHODrug Option A — verbatim name always populated,
  // coding attempted but never required. No codebook/decode step for
  // products (task explicitly scopes the codebook-quarantine requirement
  // to reactions only); a provider may still return UNMAPPED/etc, which
  // is fine and non-blocking under Option A (see validation.ts).
  const productSplit = splitBySourceProfile(
    row.product,
    profile,
    profile.productDelimiter ?? profile.reactionDelimiter,
  );
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
    ? profile.reporterQualificationMap[normalizeDesignationKey(reporterDesignationRaw)]
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
    caseSafetyReportId,
    // Per spec: "When MedNova creates the first electronic ICSR for a
    // case, C.1.1 and C.1.8.1 are identical." This pipeline only ever
    // creates first-time transmissions today (no follow-up source yet).
    worldwideUniqueId: caseSafetyReportId,
    // MedNova/SafetyCore is the reporting organisation submitting on
    // behalf of the facility, not the regulator itself.
    firstSenderOfCase: "2",
    reportType,
    dateOfCreation: context.processedAt,
    // No "date received from source" column exists in this dataset — the
    // processing timestamp is used as a conservative stand-in, not a
    // fabricated historical date.
    // C.1.4 / C.1.5: when the report was received, taken from the source
    // when it says; otherwise the processing date is the best available.
    dateFirstReceived: reportDate ?? context.processedAt,
    dateMostRecentInfo: reportDate ?? context.processedAt,
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
      country: reporterCountry.code,
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
