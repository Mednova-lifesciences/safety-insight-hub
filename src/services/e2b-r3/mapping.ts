import type {
  CodedTerm,
  DrugCharacterization,
  NullFlavor,
  OtherCaseIdentifiers,
  PVCase,
  PVProduct,
  PVReaction,
  ReactionOutcome,
  RequiredValue,
  SexCode,
  SourceReactionDecoding,
  WhoDrugCodedProduct,
} from "./types";
import type { MedDraCodingProvider, WhoDrugCodingProvider } from "./coding-provider";
import type { SourceProfile } from "./source-profiles/types";
import { isTransmissionConfigConfirmed, type E2bTransmissionConfig } from "./transmission-config";

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

const DEFAULT_SEX_WORDS: Record<string, SexCode> = { M: "MALE", MALE: "MALE", F: "FEMALE", FEMALE: "FEMALE" };

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
export function mapSeriousness(raw: string | undefined, profile?: SourceProfile): boolean | undefined {
  const v = (raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (!v) return undefined;
  return profile?.seriousnessMap?.[v] ?? DEFAULT_SERIOUSNESS_WORDS[v];
}

const DEFAULT_OUTCOME_WORDS: Record<string, ReactionOutcome> = {
  RECOVERED: "RECOVERED",
  RESOLVED: "RECOVERED",
  RECOVERING: "RECOVERING",
  RESOLVING: "RECOVERING",
  NOTRECOVERED: "NOT_RECOVERED",
  NOTRESOLVED: "NOT_RECOVERED",
  RECOVEREDWITHSEQUELAE: "RECOVERED_WITH_SEQUELAE",
  FATAL: "FATAL",
  UNKNOWN: "UNKNOWN",
};

/** Consults the active profile's outcomeMap first, then this engine's
 *  built-in normalised-word recognition. A raw source code that matches
 *  neither (e.g. a bare "1" from an original AEFI form's own numeric
 *  legend) is returned as unmapped instead of reinterpreted under the
 *  wrong vocabulary. */
export function mapOutcome(
  raw: string | undefined,
  profile?: SourceProfile,
): { outcome: ReactionOutcome; unmapped?: undefined } | { outcome?: undefined; unmapped: string } {
  const v = (raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  const resolved = profile?.outcomeMap?.[v] ?? DEFAULT_OUTCOME_WORDS[v];
  return resolved ? { outcome: resolved } : { unmapped: raw ?? "" };
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

  const escaped = profile.reactionDelimiter.separators.map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length > 0) {
    const pattern = new RegExp(`\\s*(?:${escaped.join("|")})\\s*`, "i");
    if (pattern.test(rawValue)) {
      const parts = rawValue.split(pattern).map((p) => p.trim()).filter(Boolean);
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

/** Normalizes a local code the same way codebook keys are normalized
 *  (trim + uppercase) so lookups are consistent regardless of source
 *  formatting quirks. */
function normalizeLocalCode(v: string): string {
  return v.trim().toUpperCase();
}

/**
 * REACTION DECODING PIPELINE (task-mandated sequence):
 *   raw source value -> source-profile codebook decoding -> canonical
 *   verbatim reaction term -> MedDRA coding -> E2B reaction instance.
 * This function performs the FIRST step only — splitting and codebook
 * lookup — returning one SourceReactionDecoding per resulting value.
 * MedDRA coding (a separate, later step) never runs on anything but a
 * DECODED sourceTerm; see mapSourceRecordToPVCase below.
 */
export function decodeReactionField(raw: string | undefined, profile: SourceProfile): SourceReactionDecoding[] {
  const split = splitBySourceProfile(raw, profile);
  if (split.quarantined) {
    return [
      {
        status: "DELIMITER_QUARANTINED",
        localCode: split.rawValue,
        sourceProfileId: profile.id,
        codebookVersion: profile.reactionCodebook.version,
      },
    ];
  }
  return split.values.map((value) => {
    const key = normalizeLocalCode(value);
    const entry = profile.reactionCodebook.entries[key];
    if (entry) {
      return {
        status: "DECODED",
        localCode: value,
        sourceTerm: entry.sourceTerm,
        sourceProfileId: profile.id,
        codebookVersion: profile.reactionCodebook.version,
      } satisfies SourceReactionDecoding;
    }
    return {
      status: "UNKNOWN_CODE",
      localCode: value,
      sourceProfileId: profile.id,
      codebookVersion: profile.reactionCodebook.version,
    } satisfies SourceReactionDecoding;
  });
}

async function codeReactionTerm(provider: MedDraCodingProvider, verbatim: string): Promise<CodedTerm> {
  return provider.resolveReaction(verbatim);
}

async function codeProductTerm(provider: WhoDrugCodingProvider, verbatim: string): Promise<WhoDrugCodedProduct> {
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
  const outcomeResult = mapOutcome(row.outcome, profile);
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
        outcome: outcomeResult.outcome,
        outcomeUnmapped: outcomeResult.unmapped,
        // E.i.3.2a-f — per-event seriousness criteria. This dataset only
        // ever supplies a case-level aggregate, which cannot be safely
        // decomposed into the six specific criteria without guessing
        // which apply — left empty deliberately; see
        // PVCase.aggregateSeriousnessAsReported for where the source
        // value itself is preserved.
        seriousnessCriteria: {},
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
    (productSplit.quarantined ? [productSplit.rawValue] : productSplit.values).map(async (value, i) => {
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
    }),
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

  // Report type (decision D3) is bundled with the same sender/receiver
  // confirmation gate (decision D4) — both come from the same
  // NAFDAC/Ondo/MedNova-leadership sign-off, so an unconfirmed
  // transmission config means report type isn't authoritative either, not
  // just "some other field is missing." See transmission-config.ts.
  const reportType: RequiredValue<typeof transmissionConfig.reportType> = isTransmissionConfigConfirmed(
    transmissionConfig,
  )
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
      transmissionConfig.sender.organization === "__UNCONFIRMED__" ? undefined : transmissionConfig.sender.organization,
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
