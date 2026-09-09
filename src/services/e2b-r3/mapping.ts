import type {
  CodedTerm,
  DrugCharacterization,
  NullFlavor,
  OtherCaseIdentifiers,
  PVCase,
  PVProduct,
  PVReaction,
  ReactionOutcome,
  ReportType,
  RequiredValue,
  SexCode,
} from "./types";
import type { MedDraCodingProvider, WhoDrugCodingProvider } from "./coding-provider";

/** The raw, already-column-mapped row shape this app's line-list pipeline
 *  produces (see TARGET_FIELDS in services/api/linelist.ts) — the RAW
 *  IMPORT MODEL this mapping layer starts from. Intentionally a subset/
 *  mirror rather than a shared import, matching this codebase's existing
 *  per-module narrow-type convention. */
export interface RawLineListRow {
  case_id?: string;
  patient_identifier?: string;
  product?: string;
  reaction?: string;
  onset_date?: string;
  seriousness?: string;
  outcome?: string;
  sex?: string;
  age?: string;
  vaccination_date?: string;
  reaction_code?: string;
  serious_code?: string;
  vaccine_batch?: string;
  dose?: string;
  reporter_designation?: string;
  reporter_phone?: string;
}

/** Decisions D1-D4 from Ondo_AEFI_E2B_R3_Developer_Spec.docx section 3 —
 *  every field here is genuinely optional because none has been signed off
 *  yet. mapRowToPVCase degrades honestly (RequiredValue nullFlavors,
 *  undefined senderOrganisation, etc.) when a decision isn't supplied
 *  rather than picking a default on its own. */
export interface MappingConfig {
  /** Decision D3 — report type for routine AEFI surveillance (C.1.3). */
  reportType?: ReportType | undefined;
  /** Decision D4 — this case's sending organisation (C.3.2), agreed with
   *  NAFDAC. Not a sender/receiver *transmission* identifier (N.1.3 etc.)
   *  — those are batch-level, set at serialization time, not per case. */
  senderOrganisation?: string | undefined;
}

/** "ADEBOLA ESTHER" -> "A.E." — pseudonymised initials, never a real name.
 *  A value that's already short/single-token passes through unchanged.
 *  This is option (a) of decision D1 (spec section 3) — implemented
 *  because it's one of the spec's own pre-approved options, not because
 *  D1 has been formally signed off; see mapRowToPVCase. */
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

export function mapSex(raw: string | undefined): SexCode | undefined {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "M" || v === "MALE") return "MALE";
  if (v === "F" || v === "FEMALE") return "FEMALE";
  return undefined;
}

/** Only fires on a value already unambiguously meaning serious/non-serious
 *  (reusing the exact vocabulary linelist.ts's own normalizeSeriousness
 *  recognises). This is the source's case-level AGGREGATE value only —
 *  per the spec, it must never itself become an E2B seriousness element;
 *  see PVCase.aggregateSeriousnessAsReported and PVReaction.seriousnessCriteria. */
export function mapSeriousness(raw: string | undefined): boolean | undefined {
  const v = (raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (v === "SERIOUS" || v === "YES" || v === "Y") return true;
  if (v === "NONSERIOUS" || v === "NO" || v === "N") return false;
  return undefined;
}

/** Only matches this app's own already-normalised outcome words (see
 *  OUTCOME_VALUES in linelist.ts) — a raw source code (e.g. a bare "1"
 *  from the original AEFI form, which belongs to a *different* code list
 *  than E2B's) is returned as unmapped instead of reinterpreted. */
export function mapOutcome(
  raw: string | undefined,
): { outcome: ReactionOutcome; unmapped?: undefined } | { outcome?: undefined; unmapped: string } {
  const v = (raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  switch (v) {
    case "RECOVERED":
    case "RESOLVED":
      return { outcome: "RECOVERED" };
    case "RECOVERING":
    case "RESOLVING":
      return { outcome: "RECOVERING" };
    case "NOTRECOVERED":
    case "NOTRESOLVED":
      return { outcome: "NOT_RECOVERED" };
    case "RECOVEREDWITHSEQUELAE":
      return { outcome: "RECOVERED_WITH_SEQUELAE" };
    case "FATAL":
      return { outcome: "FATAL" };
    case "UNKNOWN":
      return { outcome: "UNKNOWN" };
    default:
      return { unmapped: raw ?? "" };
  }
}

export interface MultiValueSplit {
  values: string[];
  /** True when the separator used was itself ambiguous (currently: a
   *  dot-separated list) rather than an unambiguous delimiter like a comma
   *  or "and" — surfaced so callers can flag these for human review
   *  instead of silently trusting the split. */
  ambiguous: boolean;
}

/** "8,19,21" -> 3 values. "12 AND 20" -> 2 values. "PENTA,IPV,PCV" -> 3
 *  values. A single value passes through as a 1-element, non-ambiguous
 *  result. Dot-separated lists (e.g. "8.19.21") are split but marked
 *  ambiguous — periods are a genuinely fragile separator in this domain
 *  (could be a decimal), so callers must treat that split as needing
 *  human confirmation, not fact. */
export function splitMultiValue(raw: string | undefined): MultiValueSplit {
  if (!raw) return { values: [], ambiguous: false };
  const trimmed = raw.trim();
  if (!trimmed) return { values: [], ambiguous: false };

  const parts = trimmed
    .split(/\s*(?:,|;|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) return { values: parts, ambiguous: false };

  // Only consider dot-splitting when there's no other confident separator
  // and it isn't shaped like a plain decimal number (one dot, e.g. "0.5").
  const dotParts = trimmed.split(".").map((p) => p.trim()).filter(Boolean);
  if (dotParts.length > 1 && !/^\d+\.\d+$/.test(trimmed)) {
    return { values: dotParts, ambiguous: true };
  }

  return { values: [trimmed], ambiguous: false };
}

async function codeReactionTerm(
  provider: MedDraCodingProvider,
  verbatim: string,
): Promise<CodedTerm> {
  return provider.codeReaction(verbatim);
}

async function codeProductTerm(
  provider: WhoDrugCodingProvider,
  verbatim: string,
): Promise<CodedTerm> {
  return provider.codeProduct(verbatim);
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
 * RAW IMPORT MODEL -> CANONICAL PV CASE MODEL.
 *
 * Every reaction and every product gets its own CodedTerm via the supplied
 * coding providers — with no licensed provider configured (see
 * coding-provider.ts), every one of them comes back UNMAPPED. That's
 * correct, not a bug: this function's job is producing an honest normalized
 * case, not deciding whether it's ready to export (see validation.ts for
 * the fail-closed gate that actually blocks export on unmapped terms).
 *
 * Fields gated on Ondo_AEFI_E2B_R3_Developer_Spec.docx decisions D1-D4
 * (patient identity representation, reporter, report type, sender org) are
 * populated with the spec's own documented interim behaviour where one
 * exists (D1 option (a): derived initials) or left explicitly unresolved
 * (RequiredValue nullFlavor / undefined) otherwise — never defaulted on
 * this function's own authority.
 */
export async function mapRowToPVCase(
  row: RawLineListRow,
  context: { jobId: string; sourceFile: string; sourceRow: number; processedAt: string },
  providers: { meddra: MedDraCodingProvider; whodrug: WhoDrugCodingProvider },
  config: MappingConfig = {},
): Promise<MapRowResult> {
  const warnings: MappingWarning[] = [];
  const sendersCaseId = row.case_id?.trim() || `${context.jobId}-${context.sourceRow}`;

  // Reactions — split first, code each independently. Never one CodedTerm
  // per row when the source actually listed several reactions.
  const reactionSplit = splitMultiValue(row.reaction);
  if (reactionSplit.ambiguous) {
    warnings.push({
      field: "reaction",
      sourceValue: row.reaction ?? "",
      message:
        "Reaction value split on a dot-separated pattern, which is ambiguous in this domain (could be a single decimal-shaped code, not a list). Confirm this was actually meant as multiple reactions.",
    });
  }
  const onsetDate = parseSourceDate(row.onset_date) ?? undefined;
  const outcomeResult = mapOutcome(row.outcome);
  const reactions: PVReaction[] = await Promise.all(
    reactionSplit.values.map(async (value, i) => {
      const coded = await codeReactionTerm(providers.meddra, value);
      return {
        id: `${sendersCaseId}-r${i + 1}`,
        reaction: coded,
        onsetDate,
        outcome: outcomeResult.outcome,
        outcomeUnmapped: outcomeResult.unmapped,
        // E.i.3.2a-f — per-event seriousness criteria. This dataset only
        // ever supplies a case-level aggregate ("NON SERIOUS"), which
        // cannot be safely decomposed into the six specific criteria
        // without guessing which one(s) apply — left empty deliberately;
        // see PVCase.aggregateSeriousnessAsReported for where the source
        // value itself is preserved.
        seriousnessCriteria: {},
      } satisfies PVReaction;
    }),
  );

  // Products — same split-then-code treatment. This dataset is AEFI/
  // vaccine-specific, so every product here is structurally the suspect
  // vaccine (characterization SUSPECT) — the line-list source has no
  // concept of a concomitant/interacting medication.
  const productSplit = splitMultiValue(row.product);
  if (productSplit.ambiguous) {
    warnings.push({
      field: "product",
      sourceValue: row.product ?? "",
      message:
        "Product value split on a dot-separated pattern, which is ambiguous in this domain. Confirm this was actually meant as multiple products.",
    });
  }
  const drugStartDate = parseSourceDate(row.vaccination_date) ?? undefined;
  const products: PVProduct[] = await Promise.all(
    productSplit.values.map(async (value, i) => {
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

  const reporterName = row.reporter_designation?.trim();
  // D2 (who the reporter is) isn't decided — this dataset's
  // reporter_designation column is a *qualification* ("CHEW"), not a
  // name, so C.2.r.1 (name) genuinely has no source here regardless of D2.
  const reporterNameValue: RequiredValue<string> = { present: false, nullFlavor: "NASK" };

  const reportType: RequiredValue<ReportType> = config.reportType
    ? { present: true, value: config.reportType }
    : { present: false, nullFlavor: "NASK" }; // D3 not yet decided

  const otherCaseIdentifiers: OtherCaseIdentifiers = { present: false, nullFlavor: "NI" };

  const pvCase: PVCase = {
    internalCaseId: `${context.jobId}-${context.sourceRow}`,
    sendersCaseId,
    // Per spec 5.2: "When MedNova creates the first electronic ICSR for a
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
    // fabricated historical date. Flagged in docs as a known limitation;
    // replace with a real source column if/when Ondo State supplies one.
    dateFirstReceived: context.processedAt,
    dateMostRecentInfo: context.processedAt,
    additionalDocumentsAvailable: false,
    // C.1.7 requires a genuine clinical/regulatory determination this
    // pipeline has no basis to make on its own — left unresolved rather
    // than inferred from seriousness.
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: otherCaseIdentifiers,
    followUp: { isFollowUp: false },
    patient: {
      identity,
      sex: mapSex(row.sex),
      age: row.age?.trim() || undefined,
      // Deliberately no ageUnit — see PVPatient.ageUnit doc comment. This
      // dataset's "age" column doesn't state a unit, and years-vs-months
      // is exactly the kind of thing that's dangerously wrong to guess for
      // pediatric AEFI data.
    },
    reporter: {
      name: reporterNameValue,
      qualificationVerbatim: reporterName || undefined,
      // qualificationCode intentionally left unset — binding "CHEW" (or
      // any other free-text designation) to one of the five Appendix I(F)
      // codes is decision D2, not a guess this function makes.
    },
    senderOrganisation: config.senderOrganisation,
    reactions,
    products,
    aggregateSeriousnessAsReported: row.seriousness?.trim() || undefined,
    sourceInformation: {
      sourceFile: context.sourceFile,
      sourceRow: context.sourceRow,
      jobId: context.jobId,
    },
  };

  return { pvCase, warnings };
}
