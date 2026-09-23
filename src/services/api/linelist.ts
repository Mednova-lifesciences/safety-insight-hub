import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import { mapColumnsByKeywords, parseTabularFile, type KeywordEntry } from "./tabular-parse";
import { ai } from "./ai";
import { RULE_BASED_DETECTION_ENABLED } from "./feature-flags";
import { discoverAndApplyCodebook, mapJobToCases } from "@/services/e2b-r3/export";
import {
  checkCasesForE2b,
  e2bCheckIncomplete,
  mergeE2bIssues,
  type LineListE2bCheckResult,
} from "./linelist-e2b-checks";
import { discoverReporterDesignations, regulatoryConfig } from "./regulatory-config";
import { termMappings } from "./term-mappings";
import { coding } from "./coding";
import { termKey } from "@/services/e2b-r3/term-mappings";
import { applyParsingOptions } from "@/services/e2b-r3/source-profiles/runtime-profile";
import {
  mergeOrgRegulatoryConfigIntoProfile,
  type OrgRegulatoryConfig,
} from "@/services/e2b-r3/regulatory-config";
import type { PatientRecordNumberSource } from "@/services/e2b-r3/source-profiles/types";
import {
  inferPatientRecordNumberSource,
  resolvePatientRecordNumberSource,
} from "@/services/e2b-r3/source-profiles/patient-record-number";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";
import {
  resolveFieldConcept,
  mapConceptToOutcome,
  splitBySourceProfile,
} from "@/services/e2b-r3/mapping";
import {
  withOutcomeVocabulary,
  type OutcomeVocabulary,
} from "@/services/e2b-r3/source-profiles/outcome-vocabulary";
import type { SourceProfile } from "@/services/e2b-r3/source-profiles/types";
import type {
  LineListFixLocation,
  LineListIssue,
  LineListIssueType,
  LineListJob,
} from "@/types/pv";

/**
 * The line-list quality-check pass (runValidation, below) used to be
 * completely blind to per-source codebooks — it ran immediately after
 * column mapping, long before E2B(R3) export ever discovers/resolves a
 * source's own codebook, and checked raw values against a hardcoded
 * generic vocabulary. That meant a codebook-coded value like Ondo's
 * outcome "1" (which the discovered legend defines as "1 = Recovered")
 * was flagged UNRECOGNISED_OUTCOME_VALUE here even after the SAME value
 * correctly resolved to E2B outcome RECOVERED in the e2b-r3 module —
 * two disagreeing validation results for the same underlying fact.
 * This resolves the job's runtime profile (base profile + whatever
 * codebook its own document's discarded/legend rows yield) so both
 * paths now decode from the same authoritative source. No UI selects a
 * per-job source profile yet, so the base profile defaults exactly the
 * way src/services/e2b-r3/export.ts's own default parameter already
 * does — this is not a new Ondo-specific branch, just reusing that
 * existing convention so the two paths stop disagreeing.
 */
/** The profile every job used before one could be chosen. Jobs stored
 *  without a sourceProfileId were only ever processed against this, so
 *  defaulting to it keeps them decoding exactly as they always have. */
export const DEFAULT_SOURCE_PROFILE_ID = "ondo-aefi";

export { inferPatientRecordNumberSource };

function resolveJobRuntimeProfile(job: {
  discardedRows?: { row: number; text: string }[];
  filename: string;
  sheetName?: string;
  sourceProfileId?: string | undefined;
  outcomeVocabulary?: OutcomeVocabulary | undefined;
  mapping?: Record<string, TargetField> | undefined;
  parsingOptions?: LineListJob["parsingOptions"];
}): SourceProfile {
  // An unregistered id would throw from getSourceProfile and take the whole
  // job down; a job is not worth losing over a stale profile reference, so
  // fall back to the historical default and carry on.
  let baseProfile: SourceProfile;
  try {
    baseProfile = getSourceProfile(job.sourceProfileId || DEFAULT_SOURCE_PROFILE_ID);
  } catch {
    baseProfile = getSourceProfile(DEFAULT_SOURCE_PROFILE_ID);
  }
  const { runtimeProfile } = discoverAndApplyCodebook(baseProfile, job.discardedRows, {
    file: job.filename,
    sheet: job.sheetName,
  });
  // Layered last so it can only fill outcome words nothing else resolved —
  // the profile's own configured outcomeMap still wins inside
  // withOutcomeVocabulary.
  // Whose record the patient-id column holds, in the order of who is best
  // placed to know:
  //
  //   1. the person who looked at THIS file and said so;
  //   2. the source profile, where an administrator configured the form;
  //   3. the file's own header, where it names a record source.
  //
  // There is no fourth step. A header like "Patient ID" names no record
  // source, and D.1.1.1-D.1.1.4 are four different data elements, so an
  // undecided category exports no record number at all rather than
  // claiming the number came from a record nobody named. The number is
  // still read, still kept, and still waiting for that one decision.
  const patientIdHeader = Object.entries(job.mapping ?? {}).find(
    ([, field]) => field === "patient_id",
  )?.[0];
  const recordNumberSource = resolvePatientRecordNumberSource({
    decided: job.parsingOptions?.patientRecordNumberSource,
    declined: job.parsingOptions?.patientRecordNumberDeclined,
    profile: runtimeProfile.patientRecordNumberSource,
    header: patientIdHeader,
  });

  return applyParsingOptions(
    withOutcomeVocabulary(
      recordNumberSource
        ? { ...runtimeProfile, patientRecordNumberSource: recordNumberSource }
        : runtimeProfile,
      job.outcomeVocabulary,
    ),
    job.parsingOptions,
  );
}

export interface ColumnInspection {
  jobId: string;
  detectedColumns: { name: string; sample: string[]; suggestedField: string | null }[];
  targetFields: string[];
}

/**
 * The canonical field vocabulary. This started as the 7 fields a generic
 * ICSR/line-list export needs (case_id..outcome) and has been extended
 * with AEFI-specific fields so the free, zero-token rule engine can check
 * them deterministically wherever the header is recognisable. This list
 * is a mapping *hint* and what drives the deterministic checks — it is
 * NOT the limit of what gets validated: every original column, recognised
 * or not, is still sent to the AI analysis pass in full (see rawRows).
 */
export const TARGET_FIELDS = [
  "case_id",
  "patient_identifier",
  "product",
  "reaction",
  "onset_date",
  "seriousness",
  "outcome",
  "sex",
  "age",
  "vaccination_date",
  "reaction_code",
  "serious_code",
  "vaccine_batch",
  "dose",
  "reporter_designation",
  "reporter_phone",
  /** Time from vaccination to symptom onset, as AEFI forms actually record
   *  it ("30 mins", "2 days", "1 week") — NOT a calendar date. Captured so
   *  onset_date can be DERIVED from it rather than demanded separately;
   *  see deriveOnsetDate. */
  "onset_interval",
  /** When the report was received/notified — E2B C.1.4 "date report was
   *  first received" and C.1.5 "date of most recent information". */
  "report_date",
  /** E2B C.2.r.3 — the country the REPORTER/primary source is in. Named
   *  for what it means: a bare "Country" column is not assumed to be this
   *  one (see reaction_country), because the two are different facts and
   *  C.1.1's country component is built from this one. */
  "reporter_country",
  /** E2B E.i.9 — the country the REACTION/EVENT occurred in. Never a
   *  substitute for reporter_country: a reporter in one country can report
   *  an event that happened in another. */
  "reaction_country",
  /** E2B D.1.1.1-D.1.1.4 — the patient's MEDICAL RECORD NUMBER at the
   *  facility that holds the record. A different thing from
   *  `patient_identifier`, which carries the patient's name or initials
   *  (D.1) and is run through deriveInitials: a record number put there
   *  would be exported as if it were the patient's name. */
  "patient_id",
  /** E2B C.2.r.1 — the REPORTER's own name. Distinct from
   *  `reporter_designation` (C.2.r.4), which is their role. */
  "reporter_name",
  /** E2B D.2.2b — the unit the age column is expressed in, when the file
   *  states it in a column of its own. Without this the age number alone
   *  is ambiguous, and an AEFI line list's "2" is as likely to be months
   *  as years. */
  "age_unit",
  /** E2B D.2.1 — the patient's date of birth. Never derived from `age`
   *  and never used to derive it. */
  "date_of_birth",
  /** E2B D.2.3 — an age GROUP the source states in its own words
   *  (infant, child, adult). Kept separate from `age`: a group is not a
   *  number and must not be matched by the age keywords. */
  "age_group",
  /** E2B G.k.4.r.10 — how the product was administered (IM, oral, SC).
   *  The model and serializer have always supported this; until now no
   *  source column could reach them. */
  "route",
  /** E2B C.2.r.2.1 — the reporting facility/organisation. Distinct from
   *  the SENDER organisation (C.3.2), which is configuration, not data. */
  "reporter_organization",
  /** E2B C.2.r.2.4 / C.2.r.2.5 — the reporter's city and state. Only
   *  matched from headers that say whose they are: a bare "City" or
   *  "State" column is as likely to be the patient's residence, and that
   *  is a different fact. */
  "reporter_city",
  "reporter_state",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/** Collapses whatever separator (or none at all) a form uses between "non"
 *  and "serious" — "NON_SERIOUS", "NON-SERIOUS", "NON SERIOUS",
 *  "NONSERIOUS" — to one canonical form, so a real file isn't flagged
 *  UNRECOGNISED_SERIOUSNESS_VALUE merely for spelling "non-serious" with a
 *  space instead of an underscore. Found on a real AEFI form that used
 *  "NON SERIOUS". */
function normalizeSeriousness(value: string): string {
  const upper = value.toUpperCase().trim();
  if (upper.replace(/[\s_-]+/g, "") === "NONSERIOUS") return "NON_SERIOUS";
  return upper.replace(/[\s_-]+/g, "_");
}

const SERIOUSNESS_VALUES = new Set(["SERIOUS", "NON_SERIOUS", "YES", "NO", "Y", "N"]);
const NON_SERIOUS_VALUES = new Set(["NON_SERIOUS", "NO", "N"]);
const SERIOUS_TEXT_VALUES = new Set(["SERIOUS", "YES", "Y"]);
// Outcome recognition no longer uses a hardcoded word list — see
// resolveJobRuntimeProfile/resolveFieldConcept below, which decodes
// through the job's own discovered source codebook plus the same
// canonical E2B outcome vocabulary mapConceptToOutcome (e2b-r3/mapping.ts)
// already uses, so this validator and the E2B module never disagree.
const BATCH_PLACEHOLDER_VALUES = new Set(["-", "0", "NAN", "NIL", "NILL", "N/A", "NA"]);
const MULTI_VALUE_RE = /[,/]|\bAND\b/i;

/** A parsed, column-mapped row from an uploaded file — the canonical-field
 *  input to the deterministic rule engine, and to createFromCases jobs
 *  which have no original file to preserve in the first place. */
export type ParsedRow = Partial<Record<TargetField, string>>;

/** Extends the public LineListJob shape with the raw parse the job was
 *  built from, so validation can run against real content. Legacy/demo
 *  jobs seeded directly in the database won't have this — validate()
 *  falls back to their pre-existing issues rather than erasing them. */
interface LineListJobRow extends LineListJob {
  columns?: string[];
  mapping?: Record<string, TargetField>;
  /** Which decided each column's field — the model or the keyword matcher.
   *  Recorded per column so the Map columns step and the audit trail can
   *  show an AI-chosen mapping as AI-chosen, the same rule/ai distinction
   *  findings already carry. Absent on jobs uploaded before this existed,
   *  which is read as entirely rule-mapped. */
  mappingSource?: Record<string, "ai" | "rule">;
  /** The model's one-line reason for each column it decided, so a reviewer
   *  can judge the mapping rather than only accept it. */
  mappingNotes?: Record<string, string>;
  mappingAiUsed?: boolean;
  /** This file's own outcome words ("Fully better", "Rétabli"), resolved
   *  to the E.i.7 codelist. Persisted on the job so validation and E2B
   *  export decode outcomes identically, and so the resolution is a
   *  reviewable record rather than something recomputed invisibly on each
   *  run. Entries marked requiresConfirmation are NOT applied. */
  outcomeVocabulary?: OutcomeVocabulary;
  parsedRows?: ParsedRow[];
  /** Every original column, keyed by its real header text, for every row
   *  — unlike parsedRows, nothing outside the canonical fields is dropped.
   *  This is what actually gets sent to AI analysis/fix for a real upload,
   *  so a column outside the app's canonical field list is never silently
   *  invisible to validation. Absent on jobs synthesized internally
   *  (createFromCases) — those are already fully canonical with no
   *  original file to preserve. */
  rawRows?: Record<string, string>[];
  /** Parser notes from ingestion (e.g. "skipped 9 title/letterhead rows
   *  above the detected header on row 10", "combined a two-row header") —
   *  kept for traceability back to how the raw file was actually read, not
   *  shown as validation issues. Empty for a file whose first row was
   *  already the real header. */
  parseWarnings?: string[];
  /** Which sheet the parser selected as the actual data table, and the
   *  1-indexed row (in that sheet) it used as the header — source
   *  traceability for every issue's row/column back to the original
   *  workbook, alongside `filename`. Absent on jobs synthesized internally
   *  (createFromCases) or uploaded before this was tracked. */
  sheetName?: string;
  headerRowNumber?: number;
  /** Raw text of rows the parser found within the data region but excluded
   *  from `rows`/`parsedRows` as too sparse to be a real case (see
   *  tabular-parse.ts's discardedRowsText) — most often a trailing
   *  "KEY TO SUMMARY FINDINGS" legend/codebook defining what this file's
   *  own coded field values mean. Preserved so that content is never
   *  silently lost, even though nothing in this pipeline yet parses it
   *  into a structured code->meaning registry — that remains a distinct,
   *  not-yet-built step (see docs/E2B-R3-SOURCE-PROFILES.md). Absent on
   *  jobs synthesized internally (createFromCases). */
  discardedRowsText?: string[];
  /** Same rows as discardedRowsText, with real row numbers — see
   *  tabular-parse.ts's ParsedTable.discardedRows. */
  discardedRows?: { row: number; text: string }[];
  validatedAt?: string;
  /** The AI prompt version last used to analyse this job, surfaced on the
   *  executive summary so it's traceable to exactly what ran. */
  promptVersion?: string;
  /** The outcome of the most recent "Fix Issues" run, kept so the
   *  executive summary always reflects the job's real current state
   *  rather than a stale pre-fix snapshot. Present (possibly empty) once
   *  fixIssues() has run at least once. */
  lastFixCorrections?: { row: number; column: string; new_value: string; reason: string }[];
  lastFixUnresolved?: { row: number; column: string; reason: string }[];
}

async function readJob(jobId: string): Promise<LineListJobRow> {
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select("data")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Line-list job not found");
  return data.data as unknown as LineListJobRow;
}

async function saveJob(job: LineListJobRow): Promise<LineListJobRow> {
  const { error } = await supabase
    .from("pv_linelist_jobs")
    .update({ data: toJson(job) })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
  return job;
}

/**
 * Column-name → target-field matching. Deterministic string matching, not
 * AI — the same header always maps the same way.
 *
 * Real-world PV exports (e.g. WHO-UMC/VigiLyze-style ICSR listings) have
 * many columns whose names share short, generic substrings — "Age at
 * onset of reaction" contains "reaction", "Drug role" contains "drug".
 * A naive first-match-wins scan picks those up ahead of the actual
 * "Reaction / event (MedDRA)" or "Drug name (WHODrug)" columns. Instead,
 * every header is scored against every field by keyword specificity, and
 * headers are assigned to fields in descending score order — the most
 * confident matches win regardless of column order.
 */
export const FIELD_KEYWORDS: Record<TargetField, KeywordEntry[]> = {
  case_id: [
    ["otherreportid", 90],
    ["caseid", 90],
    ["reportid", 80],
    ["reportno", 80],
    ["reportnumber", 80],
    // "Case Ref" is a common spelling that "reference" does not match, so
    // the column went unmapped and every row generated a fallback case id.
    ["caseref", 85],
    // "Case No"/"Case Number" are among the commonest spellings on AEFI
    // forms; without them the file's own case IDs never reach the issue
    // list, the executive summary or the exported case id.
    ["caseno", 90],
    ["casenumber", 90],
    ["casenum", 85],
    ["reference", 40],
    // Deliberately no bare "case" fallback: real AEFI forms routinely use
    // "case" inside unrelated headers ("If serious case select...", "Type
    // of AEFI (Non-serious or Serious) case") — a generic substring match
    // there mapped a seriousness-code column to case_id on a real file.
  ],
  // D.1 — the patient's NAME or INITIALS. Headers that name an identifier
  // ("Patient ID", "Subject ID", "Hospital number") deliberately do NOT
  // match here any more: they used to, and a real record number was then
  // exported as the patient's name. They belong to patient_id below.
  patient_identifier: [
    ["patientinitials", 95],
    ["patientname", 95],
    ["initials", 80],
    ["nameofpatient", 90],
    ["patientidentifier", 60],
    ["patient", 20],
    ["subject", 20],
  ],
  // D.1.1.1-D.1.1.4 — a record number held by a facility.
  patient_id: [
    ["patientid", 95],
    ["patientno", 95],
    ["patientnumber", 95],
    ["subjectid", 90],
    ["subjectnumber", 90],
    ["hospitalnumber", 95],
    ["hospitalrecordnumber", 95],
    ["medicalrecordnumber", 95],
    ["recordnumber", 85],
    ["specialistrecordnumber", 85],
    ["gprecordnumber", 85],
    ["folionumber", 80],
    ["cardnumber", 75],
    // "No"/"Nos" is as common as "Number" on a real form.
    ["hospitalno", 95],
    ["hospitalrecordno", 95],
    ["medicalrecordno", 95],
    ["recordno", 85],
    ["mrn", 95],
    ["registrationnumber", 75],
    ["registrationno", 75],
    // Only ever patient-qualified: a bare "File No" on an AEFI form is
    // usually the case file, which is case_id's business, not the
    // patient's record number.
    ["patientfilenumber", 90],
    ["patientfileno", 90],
  ],
  // C.2.r.1 — who the reporter is, as opposed to what they are.
  reporter_name: [
    ["reportername", 95],
    ["reporterfullname", 95],
    ["primaryreporter", 88],
    ["reporterinitials", 90],
    ["nameofreporter", 95],
    ["reportersname", 95],
    ["reportedby", 85],
    ["notifiedby", 80],
    ["healthworkername", 85],
    ["officername", 75],
  ],
  product: [
    ["drugnamewhodrug", 95],
    ["suspectvaccine", 92],
    ["suspectedvaccine", 92],
    ["primarysuspectvaccine", 95],
    ["medicinalproduct", 90],
    ["drugname", 90],
    ["suspectproduct", 90],
    ["vaccinename", 90],
    ["product", 25],
    ["drug", 20],
    ["vaccine", 20],
    ["medication", 25],
  ],
  reaction: [
    ["reactioneventmeddra", 95],
    ["reactionevent", 85],
    ["adverseevent", 80],
    ["reactionterm", 80],
    // The MedDRA/safety-database vocabulary for the same column. A CRO-style
    // export headed "Reported Term" scored 0 of 3 rows valid on a live test:
    // every row failed MISSING_REACTION while carrying Myalgia, Pyrexia and
    // Urticaria, because none of the keywords above match "reportedterm".
    // "Reported term" (verbatim, as the reporter wrote it) and "preferred
    // term" (the coded MedDRA PT) are both standard names for this field.
    ["reportedterm", 85],
    ["verbatimterm", 85],
    ["preferredterm", 80],
    ["lowestlevelterm", 80],
    ["eventterm", 80],
    ["adversereaction", 80],
    ["aeterm", 70],
    // "Adverse Drug Reaction" previously mapped to PRODUCT, because it
    // contains "drug" — the reaction column read as the medicine, and the
    // reaction field left empty. That is the dangerous class of mistake (a
    // wrong field, not an absent one), so it outranks everything.
    ["adversedrugreaction", 95],
    // Do not use the bare "adr" abbreviation here: after punctuation is
    // removed, "Adress of reporting health facility" starts with "adr" and
    // was therefore incorrectly claimed as the reaction column. Full
    // "Adverse Drug Reaction" is covered above; shorter ADR headers must be
    // handled by an explicit source mapping rather than a substring guess.
    ["sideeffect", 85],
    ["adverseeffect", 85],
    ["untowardeffect", 85],
    ["manifestation", 70],
    ["eventdescription", 60],
    ["signsymptom", 60],
    // Broader than "signsymptom", which missed the bare "Symptoms" and
    // "Signs and Symptoms" spellings. Stays below onset_date's
    // "dateofsymptomonset" (90), so a symptom-onset DATE column is still a
    // date.
    ["symptom", 60],
    ["complaint", 60],
    ["complication", 60],
    ["reaction", 15],
    // Bottom tier, alongside the bare "reaction"/"event" fallbacks. Written
    // first as a bare "effect", which promptly mapped "Effective Date" to
    // the reaction column — the exact class of mistake a substring table
    // keeps making. Anchored to the two real spellings instead.
    ["effects", 15],
    ["sideeffect", 15],
    ["event", 10],
  ],
  onset_date: [
    ["onsetdatetime", 90],
    ["onsetdate", 85],
    // "Date of Onset" / "Date of Symptom Onset" — as common as "Onset Date"
    // and matched by none of the keywords, which put MISSING_ONSET_DATE on
    // every row of files that plainly stated one. Both need their own
    // literal substring, so neither can catch the "Onset Time interval"
    // duration column the note below is about.
    ["dateofonset", 90],
    ["dateofsymptomonset", 90],
    ["reactiononset", 88],
    ["eventonset", 88],
    ["aeonsetdate", 90],
    ["datereactionstarted", 90],
    ["dateofevent", 70],
    ["eventdate", 60],
    ["datestarted", 60],
    ["startdate", 30],
    // Deliberately no bare "onset" fallback: several real AEFI forms have
    // an "Onset Time interval (hours, days, weeks)" column — a *duration*
    // since vaccination, not a date — which the generic keyword mapped
    // straight into onset_date, tripping INVALID_DATE_FORMAT on every row.
    // That column is now mapped to onset_interval below instead, and
    // onset_date is derived from it (see deriveOnsetDate).
  ],
  onset_interval: [
    ["onsettimeinterval", 95],
    ["onsetinterval", 90],
    ["timetoonset", 90],
    ["intervalfromvaccination", 85],
    ["onsettime", 60],
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
  sex: [
    ["sex", 90],
    ["gender", 85],
  ],
  // D.2.2a — the age NUMBER. The header normalizer has already removed
  // case, spaces and punctuation by the time these are matched, so the
  // bare "age" substring covers "AGE", "Patient Age", "Pt. Age",
  // "Patient's Age" and "PATIENT_AGE" without an entry each. The higher
  // weights exist to beat the generic substring when a file has more than
  // one age-ish column. A misspelling that does not contain "age" at all
  // ("AEG") is left to the AI mapper — that is what it is for, and a
  // typo table would never end.
  age: [
    ["ageatonset", 70],
    ["ageatreaction", 70],
    ["ageatevent", 70],
    ["ageyears", 70],
    ["age", 30],
  ],
  // D.2.2b. Every keyword requires a unit word as well as "age", so a
  // plain age column can never be claimed here.
  age_unit: [
    ["ageunit", 95],
    ["ageunits", 95],
    ["unitofage", 95],
    ["agein", 60],
    [["age", "measure"], 70],
  ],
  // D.2.1. "dateofbirth" and "birthdate" are separate literals because
  // neither contains the other.
  date_of_birth: [
    ["dateofbirth", 95],
    ["birthdate", 90],
    ["dateborn", 85],
    ["patientdob", 95],
    ["dob", 90],
  ],
  // D.2.3. Requires the word "group"/"band"/"category" alongside "age",
  // so it cannot take the age number's column.
  age_group: [
    ["agegroup", 95],
    ["agegrp", 90],
    ["ageband", 90],
    ["agecategory", 90],
    ["agerange", 85],
    ["agebracket", 85],
  ],
  // C.2.r.3. Only headers that actually say whose country it is: a bare
  // "Country" is genuinely ambiguous between the reporter's and the
  // event's, so it is left for the AI mapper's review step rather than
  // guessed here (getting it wrong would put the wrong country into every
  // case identifier).
  reporter_country: [
    ["reportercountry", 95],
    ["countryofreporter", 95],
    ["primarysourcecountry", 95],
    ["countryofprimarysource", 95],
    ["reportingcountry", 85],
    ["sourcecountry", 80],
  ],
  // E.i.9.
  reaction_country: [
    ["reactioncountry", 95],
    ["countryofreaction", 95],
    ["eventcountry", 95],
    ["countryofevent", 95],
    ["countrywherereactionoccurred", 95],
    ["countryofoccurrence", 90],
  ],
  report_date: [
    ["datereported", 90],
    ["dateofreport", 90],
    ["reportdate", 90],
    ["datereceived", 85],
    ["receiveddate", 85],
    ["dateofnotification", 85],
    ["datenotified", 85],
    ["notificationdate", 85],
  ],
  vaccination_date: [
    ["dateoflastimmunization", 95],
    ["dateoflastimmunisation", 95],
    ["dateofvaccination", 90],
    ["immunizationdate", 85],
    ["immunisationdate", 85],
    ["vaccinationdate", 85],
  ],
  reaction_code: [
    ["reactioncode", 95],
    ["aefireactioncode", 95],
    // "AEFI Code" / "AE Code" / "Adverse Event Code" are ordinary spellings
    // on real coded forms, and none of them matched anything at all: a live
    // upload headed "AEFI Code" mapped to no field, so the codes were
    // invisible and every row reported MISSING_REACTION while the codes sat
    // right there in the file. Each keyword below still requires its own
    // literal substring, so a single word-shaped column like Ondo's
    // "Reaction type (Codes - see 1 below)" is untouched by them and keeps
    // going to `reaction` (see the note below).
    ["aeficode", 90],
    ["adverseeventcode", 90],
    ["aecode", 70],
    ["eventcode", 70],
    // Deliberately excludes a generic "reactiontype"-style keyword: tried
    // it at weight 60 and verified against the real Ondo file that many
    // real forms have exactly ONE reaction-ish column, phrased as "Reaction
    // type (Codes — see 1 below)" — with that keyword in place, this single
    // column got claimed by reaction_code instead of the required `reaction`
    // field, which then had nothing mapped to it at all and flagged every
    // row MISSING_REACTION. `reaction`'s own generic "reaction" keyword
    // (below) must keep winning a column like this when it's the only
    // reaction-ish column in the file; reaction_code only helps when a
    // file has a genuinely separate, additional coded column.
  ],
  serious_code: [
    ["seriouscode", 90],
    ["aefitype", 85],
    ["severitycode", 70],
    // Compound match (both fragments required, any connective words/typos
    // between them are irrelevant): distinguishes a genuinely separate
    // numeric seriousness-CODE column from a word-shaped "seriousness"
    // column that merely also contains "serious" — without hardcoding any
    // one source's exact phrasing. Verified against the real Ondo AEFI
    // workbook's actual header, "If serious case select appropriste code
    // 2 below." (note the source's own typo "appropriste" — this match
    // doesn't depend on it), which the seriousness-only "serious" keyword
    // below would otherwise tie with and lose to column order.
    [["serious", "code"], 88],
  ],
  vaccine_batch: [
    ["vaccinebatch", 90],
    ["batchno", 90],
    ["batchnumber", 90],
    ["lotno", 85],
    ["lotnumber", 85],
    ["batch", 30],
    ["lot", 25],
  ],
  dose: [
    ["doseno", 85],
    ["dosenumber", 85],
    ["doseadministered", 70],
    // "Dosage" contains BOTH "dose" and "age". At equal weight the tie
    // went to whichever field is declared first, and age is declared
    // first — so a column headed "Dosage" was read as the patient's age.
    // An explicit keyword above the generic tier settles it.
    ["dosage", 70],
    ["dose", 30],
  ],
  reporter_designation: [
    ["reporterdesignation", 90],
    ["reporterqualification", 92],
    ["reporterprofession", 90],
    ["reportertype", 85],
    ["healthcareprofessional", 80],
    ["hcptype", 85],
    ["qualification", 55],
    ["designationofreporter", 90],
    ["reporterrole", 80],
    ["designation", 40],
  ],
  reporter_phone: [
    ["reporterphonenumber", 90],
    ["reporterphone", 90],
    ["telephonenumber", 65],
    ["phonenumber", 70],
    ["contactnumber", 70],
    ["mobilenumber", 70],
    // "Reporter Contact" is genuinely ambiguous — some forms put a name
    // there — so it scores below every explicit phone keyword and only wins
    // when nothing better exists. A name landing here is a MEDIUM advisory
    // (INVALID_REPORTER_PHONE), never a blocked case.
    ["reportercontact", 60],
    ["telephone", 60],
    ["phone", 30],
  ],
  // G.k.4.r.10.
  route: [
    ["routeofadministration", 95],
    ["administrationroute", 95],
    ["routeadministered", 90],
    ["route", 60],
  ],
  // C.2.r.2.1. "facility" alone sits low because a real AEFI form's
  // "Address of reporting health facility" is an ADDRESS, not the
  // facility's name — that exact header already caused a wrong mapping
  // once (see the note on `reaction`'s missing "adr" keyword).
  reporter_organization: [
    ["reporterorganization", 95],
    ["reporterorganisation", 95],
    ["reporterfacility", 95],
    ["reportingfacility", 92],
    ["reportinginstitution", 90],
    ["healthfacility", 80],
    ["facilityname", 85],
    ["institutionname", 85],
    ["nameoffacility", 85],
  ],
  // C.2.r.2.4 / C.2.r.2.5 — reporter-qualified spellings only. A bare
  // "City", "State" or "LGA" column is deliberately left to the AI
  // mapper: on a real AEFI form it is as often the patient's residence
  // as the reporting facility's location, and putting a patient's home
  // town into the reporter's address is a wrong fact in a regulatory
  // file, not a harmless approximation. Same rule the bare "Country"
  // column already follows.
  reporter_city: [
    ["reportercity", 95],
    ["reportertown", 90],
    ["reporterlga", 90],
    ["facilitycity", 88],
    ["facilitylga", 88],
    ["cityofreporter", 95],
  ],
  reporter_state: [
    ["reporterstate", 95],
    ["reporterprovince", 92],
    ["reporterregion", 88],
    ["facilitystate", 88],
    ["stateofreporter", 95],
  ],
};

function mapColumns(headers: string[]): Record<string, TargetField> {
  return mapColumnsByKeywords(headers, FIELD_KEYWORDS);
}

/** Below this, an AI proposal is disregarded and the keyword match stands.
 *  A low-confidence proposal is a guess, and a guess that silently
 *  mislabels a column is worse than a column nobody mapped. */
export const AI_MAPPING_CONFIDENCE_FLOOR = 0.6;

/** Where each column's field came from, so the Map columns step and the
 *  audit trail can show an AI-chosen mapping as AI-chosen — the same
 *  rule/ai distinction findings already carry — instead of presenting it
 *  as if the deterministic matcher had decided it. */
export interface ColumnMappingDecision {
  mapping: Record<string, TargetField>;
  source: Record<string, "ai" | "rule">;
  /** The model's one-line reason, per column it decided. */
  notes: Record<string, string>;
  aiUsed: boolean;
}

const TARGET_FIELD_SET = new Set<string>(TARGET_FIELDS);

/**
 * Combines the deterministic keyword mapping with the model's proposals.
 *
 * The keyword matcher works on header substrings, so it only knows the
 * spellings it has been taught: measured against 33 plausible names for a
 * reaction column it matched 9, and mapped "Adverse Drug Reaction" to
 * PRODUCT because the header contains "drug". Reading a header is a
 * language problem, and that is what the model is for.
 *
 * So a proposal WINS over the keyword match — including on columns the
 * keywords did map — subject to guards that no model output can override:
 *
 *  - the field must be one this app actually has (a hallucinated field
 *    name degrades to unmapped, never to a wrong column);
 *  - it must clear AI_MAPPING_CONFIDENCE_FLOOR;
 *  - a "severity" column may never be read as `seriousness`. Severity is
 *    intensity, seriousness is the regulatory criterion, and a severe
 *    reaction is frequently not a serious one. It is the single most
 *    inviting mistake in this whole mapping and the prompt warns about it
 *    too, but a prompt is guidance and this is a rule;
 *  - two columns may not claim the same field — the higher-confidence one
 *    takes it.
 *
 * Anything the model declines or the guards reject falls back to the
 * keyword mapping, and if the model is unavailable entirely the mapping is
 * exactly what it is today. That is deliberate: this call sits in the
 * upload path, and an OpenAI outage must degrade the mapping's reach, not
 * stop people uploading files.
 */
/** Letters only, so "Reporter / Designation" and "reporter" compare equal. */
function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, "");
}

/** Headers that name the reporter and nothing more specific. Anchored on
 *  purpose: "Reporter ID" and "Reporter Country" are different columns and
 *  must not be swept up by this. */
const REPORTER_FALLBACK_HEADERS = /^(reporter|reporters|reportedby|notifiedby)$/;

export function mergeColumnMapping(
  keywordMapping: Record<string, TargetField>,
  proposals: {
    column: string;
    field?: string | null;
    confidence: number;
    reason: string;
  }[],
  aiUsed: boolean,
  /** Every header in the file, so a column nothing mapped can still be
   *  seen. Optional for callers that only have the two mappings. */
  headers: string[] = [],
): ColumnMappingDecision {
  if (!aiUsed || proposals.length === 0) {
    const mapping = { ...keywordMapping };
    const notes: Record<string, string> = {};
    // Only here, and only because the model did not run. A column called
    // exactly "Reporter" is genuinely ambiguous — it holds a role on most
    // AEFI forms and a name on some — which is why the keyword list does
    // not claim it and the model is asked to read the values instead. But
    // when the model is unavailable (a cold start, an outage, no key),
    // leaving it unmapped costs every case its reporter and fails the whole
    // file on VIGIFLOW/E2B-REPORTER-MISSING. A named reporter that turns
    // out to be a person rather than a role surfaces as an unrecognised
    // designation in Settings, which someone can see and correct; an
    // unmapped column shows up as fifty identical errors that name no
    // cause. So it is taken as the designation, and said so.
    const claimed = new Set(Object.values(mapping));
    if (!claimed.has("reporter_designation")) {
      for (const column of headers) {
        if (mapping[column]) continue;
        if (!REPORTER_FALLBACK_HEADERS.test(headerKey(column))) continue;
        mapping[column] = "reporter_designation";
        notes[column] =
          "Matched by name only: AI column mapping was unavailable for this upload. Check it reads the reporter's role, not their name.";
        break;
      }
    }
    return {
      mapping,
      source: Object.fromEntries(Object.keys(mapping).map((c) => [c, "rule" as const])),
      notes,
      aiUsed: false,
    };
  }

  const accepted = proposals
    .filter((p) => {
      if (!p.field || !TARGET_FIELD_SET.has(p.field)) return false;
      if (p.confidence < AI_MAPPING_CONFIDENCE_FLOOR) return false;
      const header = p.column.toLowerCase().replace(/[^a-z]/g, "");
      if (p.field === "seriousness" && header.includes("severity")) return false;
      // The patient's record number (D.1.1) is the identifier most easily
      // confused with three others that also look like ids. The prompt
      // warns about them; these are the rules. A header that names the
      // report, the reporter, or a batch/lot may not be read as the
      // patient's record number however sure the model is — a wrong
      // patient identifier is worse than none, and the column is left to
      // the field it actually belongs to.
      if (
        p.field === "patient_id" &&
        /(^|[^a-z])(case|report|reporter|batch|lot)/.test(header) &&
        !header.includes("patient")
      ) {
        return false;
      }
      return true;
    })
    // Highest confidence first, so the contested field goes to the column
    // the model was surest about.
    .sort((a, b) => b.confidence - a.confidence);

  const mapping: Record<string, TargetField> = {};
  const source: Record<string, "ai" | "rule"> = {};
  const notes: Record<string, string> = {};
  const usedFields = new Set<TargetField>();

  for (const p of accepted) {
    const field = p.field as TargetField;
    if (usedFields.has(field) || mapping[p.column]) continue;
    mapping[p.column] = field;
    source[p.column] = "ai";
    if (p.reason) notes[p.column] = p.reason;
    usedFields.add(field);
  }

  // Keyword results fill every column the model left alone, so its silence
  // on a column can only lose reach, never unmap something already known.
  for (const [column, field] of Object.entries(keywordMapping)) {
    if (mapping[column] || usedFields.has(field)) continue;
    mapping[column] = field;
    source[column] = "rule";
    usedFields.add(field);
  }

  return { mapping, source, notes, aiUsed: true };
}

/**
 * Strips the artefacts a spreadsheet leaves on a value that was stored as
 * text — most commonly Excel's leading/trailing apostrophe, which is its
 * "treat this as text" marker and not part of the data. Observed on a real
 * Ondo AEFI upload as `02/02/2026'`, which failed INVALID_DATE_FORMAT on 13
 * rows for a character the user never typed and cannot see in Excel.
 *
 * Deliberately narrow: only the apostrophes and surrounding whitespace. It
 * never repairs the date itself — a genuinely malformed date must still
 * fail, because silently "correcting" a date in a safety report is far
 * worse than rejecting it.
 */
export function stripSpreadsheetTextMarkers(value: string): string {
  return value.trim().replace(/^'+/, "").replace(/'+$/, "").trim();
}

/** Converts an AEFI onset INTERVAL ("30 mins", "2 days", "1 week", "10HRS")
 *  into milliseconds. Returns null for anything it cannot read confidently —
 *  a guess here would move a reaction's start date, so an unparseable
 *  interval must leave onset_date underived rather than approximated. */
export function parseOnsetIntervalMs(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)\.?$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = m[2]!;
  const MIN = 60_000,
    HOUR = 60 * MIN,
    DAY = 24 * HOUR;
  if (/^(min|mins|minute|minutes|m)$/.test(unit)) return n * MIN;
  if (/^(h|hr|hrs|hour|hours)$/.test(unit)) return n * HOUR;
  if (/^(d|day|days)$/.test(unit)) return n * DAY;
  if (/^(w|wk|wks|week|weeks)$/.test(unit)) return n * 7 * DAY;
  return null;
}

/**
 * Derives the reaction onset DATE from the vaccination date plus the onset
 * interval — the two things AEFI forms actually record.
 *
 * The NAFDAC/Ondo AEFI form has no onset-date column by design: it captures
 * "Date of Last immunisation" and "Onset Time interval (hours, days,
 * weeks)". The validator nonetheless demanded onset_date, so
 * MISSING_ONSET_DATE fired on 231 of 231 rows of a real upload — a warning
 * on every row, which is the same as no warning at all, and it buried the
 * genuine findings underneath it. E2B(R3) does need a reaction start date
 * (E.i.4), so the right answer is to compute the value the form implies
 * rather than to demand a column that was never going to exist or to drop
 * the check.
 *
 * Derives only when both inputs parse. Returns ISO yyyy-mm-dd so the result
 * is indistinguishable in shape from a directly-supplied onset date.
 */
export function deriveOnsetDate(
  vaccinationDate: string | undefined,
  onsetInterval: string | undefined,
): string | null {
  if (!vaccinationDate || !onsetInterval) return null;
  const base = parseDateLoose(stripSpreadsheetTextMarkers(vaccinationDate));
  if (!base) return null;
  const offsetMs = parseOnsetIntervalMs(onsetInterval);
  if (offsetMs === null) return null;
  const d = new Date(base.getTime() + offsetMs);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Exported for tests: proves the onset-date derivation and the
 *  text-marker stripping behave the same for any source's headers, not
 *  just the form that exposed the bug. */
export function toParsedRows(
  headers: string[],
  rows: string[][],
  mapping: Record<string, TargetField>,
): ParsedRow[] {
  return rows.map((row) => {
    const parsed: ParsedRow = {};
    headers.forEach((header, i) => {
      const field = mapping[header];
      // Spreadsheet text markers are stripped at the boundary, once, so
      // every downstream rule sees the value the user actually entered.
      if (field && row[i]) parsed[field] = stripSpreadsheetTextMarkers(row[i]!);
    });
    // An onset date the form implies but never states — computed here so
    // every consumer (validation, E2B mapping, the fix pass) sees one
    // consistent value rather than each re-deriving its own.
    if (!parsed.onset_date) {
      const derived = deriveOnsetDate(parsed.vaccination_date, parsed.onset_interval);
      if (derived) parsed.onset_date = derived;
    }
    return parsed;
  });
}

/** Every original column, keyed by its real header text — nothing dropped,
 *  unlike toParsedRows(). This is what a real upload sends to AI analysis
 *  and fix, so a column outside the canonical field list is never
 *  invisible to validation. */
function toRawRows(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;

/** Best-effort parse of the same shapes DATE_RE accepts, for chronology/
 *  future-date comparisons only — day/month order in a D/M vs M/D form is
 *  inherently ambiguous without knowing the source locale, so this uses a
 *  day-first assumption (common on African AEFI forms) and only swaps to
 *  month-first when day-first is out of range. A wrong guess here only
 *  affects this supplementary chronology check, not the core
 *  INVALID_DATE_FORMAT check, which just tests the shape. */
function parseDateLoose(value: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const slashOrDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (slashOrDash) {
    const [, a, b, y] = slashOrDash;
    const year = y!.length === 2 ? Number(y) + 2000 : Number(y);
    let day = Number(a);
    let month = Number(b);
    if (day <= 12 && month > 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Reduces a case/report ID to a shape signature (letters -> "A", digits ->
 *  "9", separators kept as-is) so IDs following the same structural
 *  pattern collapse to the same signature regardless of their specific
 *  characters. Used to flag an ID that breaks from the file's own
 *  majority pattern — never against an assumed external format. */
function idSignature(id: string): string {
  return id
    .trim()
    .toUpperCase()
    .replace(/[A-Z]+/g, "A")
    .replace(/\d+/g, "9");
}

/** Flags rows whose case_id doesn't match the structural pattern most
 *  other rows in the same file use. Only fires when there's a genuine
 *  majority-vs-minority split (not "all different", not "all the same")
 *  — an inherently varied ID scheme isn't itself a finding. */
function checkCaseIdConsistency(rows: ParsedRow[], caseIdColumn: string): LineListIssue[] {
  const withId = rows
    .map((r, i) => ({ idx: i, id: r.case_id }))
    .filter((r): r is { idx: number; id: string } => !!r.id);
  if (withId.length < 3) return [];

  const sigCounts = new Map<string, number>();
  for (const r of withId) {
    const sig = idSignature(r.id);
    sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
  }
  const sorted = [...sigCounts.entries()].sort((a, b) => b[1] - a[1]);
  const majority = sorted[0];
  if (!majority || majority[1] < 2 || majority[1] === withId.length) return [];

  return withId
    .filter((r) => idSignature(r.id) !== majority[0])
    .map((r) => ({
      row: r.idx + 1,
      column: caseIdColumn,
      severity: "HIGH" as const,
      confidence: "HIGH" as const,
      code: "CASE_ID_FORMAT_INCONSISTENT",
      message: `"${r.id}" doesn't match the case/report ID format most other rows in this file use.`,
      value: r.id,
      source: "rule" as const,
      sources: ["rule"] as const,
      issueType: "FIELD_FORMAT_INVALID" as const,
      affectedFields: ["case_id"],
      fixable: false,
    }));
}

/** Expected value *shape* for a canonical field, used only to flag a
 *  column whose actual content doesn't look like what that field should
 *  hold at all — a strong hint of a column-level shift (e.g. a phone
 *  column full of role/title text), not a formatting nitpick. Deliberately
 *  limited to fields where (a) a shape is genuinely well-defined and (b) a
 *  real-world AEFI form plausibly transposes it with an adjacent column —
 *  not attempted for free-text fields (reaction, product, narrative-ish
 *  content) where "doesn't match a shape" is meaningless. */
const FIELD_SHAPE_CHECKS: Partial<
  Record<TargetField, { check: (v: string) => boolean; describe: string }>
> = {
  reporter_phone: {
    check: (v) => {
      const digits = v.replace(/\D/g, "");
      const compact = v.replace(/\s/g, "");
      return digits.length >= 7 && compact.length > 0 && digits.length / compact.length >= 0.6;
    },
    describe: "a phone number (mostly digits)",
  },
  reporter_designation: {
    check: (v) => {
      const digitCount = (v.match(/\d/g) ?? []).length;
      return digitCount / v.length < 0.3 && !DATE_RE.test(v);
    },
    describe: "a reporter role/designation (mostly letters, not a date or phone number)",
  },
  sex: {
    check: (v) => /^(m|f|male|female|unknown|u)$/i.test(v.trim()),
    describe: "a sex value (M/F/Male/Female/Unknown)",
  },
  age: {
    check: (v) => /^\d{1,3}(\.\d+)?\s*(y|yr|yrs|years?|m|mo|months?|d|days?)?$/i.test(v.trim()),
    describe: "a numeric age",
  },
};

/** Fields commonly transposed with each other on real AEFI forms (adjacent
 *  columns, easy to mis-key or mis-map). Used only to corroborate a
 *  possible column shift — if a field's values don't look like its own
 *  shape AND its swap partner is suspiciously empty in those same rows,
 *  that's stronger evidence than the shape mismatch alone. */
const SHIFT_SWAP_PARTNERS: Partial<Record<TargetField, TargetField>> = {
  reporter_phone: "reporter_designation",
  reporter_designation: "reporter_phone",
  sex: "age",
  age: "sex",
};

const COLUMN_SHIFT_MIN_SAMPLE = 5;
const COLUMN_SHIFT_WHOLE_COLUMN_THRESHOLD = 0.5;
const COLUMN_SHIFT_HIGH_EVIDENCE_THRESHOLD = 0.8;

/** Operates only on canonical parsed rows (never the raw worksheet, never
 *  document-level title/letterhead/metadata rows — those never make it
 *  into `rows` at all, since the parser strips them before building
 *  canonical records) — so this can never mistake "FEDERAL REPUBLIC OF
 *  NIGERIA" for a shifted patient column; it has no visibility into rows
 *  like that in the first place.
 *
 *  Distinguishes a genuine column-wide shift from a single bad value:
 *  a column only gets a single POSSIBLE_COLUMN_SHIFT finding (not one per
 *  row) when most of its actual content doesn't match the field's expected
 *  shape at all; an isolated mismatch in an otherwise-normal column is
 *  reported per-row as FIELD_CONTENT_MISMATCH instead, never escalated
 *  into a column-level claim. Confidence is always "LOW" (this is
 *  statistical/inferred evidence, never a certain fact, so it's never
 *  auto-fixable) — severity carries the HIGH/MEDIUM distinction the
 *  evidence strength actually supports. */
function detectColumnShifts(
  mapping: Record<string, TargetField>,
  rows: ParsedRow[],
): LineListIssue[] {
  const issues: LineListIssue[] = [];
  const headerForField = new Map<TargetField, string>();
  for (const [header, field] of Object.entries(mapping)) headerForField.set(field, header);

  for (const [field, shape] of Object.entries(FIELD_SHAPE_CHECKS) as [
    TargetField,
    (typeof FIELD_SHAPE_CHECKS)[TargetField],
  ][]) {
    if (!shape) continue;
    const header = headerForField.get(field);
    if (!header) continue; // not mapped in this file — nothing to check

    const partnerField = SHIFT_SWAP_PARTNERS[field];
    const partnerHeader = partnerField ? headerForField.get(partnerField) : undefined;

    const mismatched: { rowNum: number; value: string; partnerBlank: boolean }[] = [];
    let nonBlankCount = 0;
    rows.forEach((row, idx) => {
      const value = (row[field] ?? "").trim();
      if (!value) return;
      nonBlankCount++;
      if (!shape.check(value)) {
        const partnerValue = partnerField ? (row[partnerField] ?? "").trim() : "";
        mismatched.push({
          rowNum: idx + 1,
          value,
          partnerBlank: partnerField ? !partnerValue : false,
        });
      }
    });

    if (nonBlankCount < COLUMN_SHIFT_MIN_SAMPLE || mismatched.length === 0) continue;
    const mismatchRate = mismatched.length / nonBlankCount;

    if (mismatchRate >= COLUMN_SHIFT_WHOLE_COLUMN_THRESHOLD) {
      const partnerBlankRate = mismatched.filter((m) => m.partnerBlank).length / mismatched.length;
      const corroborated = !!partnerHeader && partnerBlankRate >= 0.5;
      const strongEvidence = mismatchRate >= COLUMN_SHIFT_HIGH_EVIDENCE_THRESHOLD || corroborated;
      const example = mismatched[0]!.value;
      issues.push({
        row: 0,
        column: header,
        severity: strongEvidence ? "HIGH" : "MEDIUM",
        confidence: "LOW",
        code: "POSSIBLE_COLUMN_SHIFT",
        message:
          `${Math.round(mismatchRate * 100)}% of the values in "${header}" don't look like ${shape.describe} ` +
          `(e.g. "${example}") — possible column shift, review before relying on this column.` +
          (corroborated
            ? ` "${partnerHeader}" is blank in ${Math.round(partnerBlankRate * 100)}% of those same rows, which is consistent with a shift between the two.`
            : ""),
        value: example,
        source: "rule",
        sources: ["rule"],
        issueType: "STRUCTURAL_COLUMN_SHIFT",
        affectedFields: [field],
        fixable: false,
      });
      continue;
    }

    // Below the whole-column threshold: isolated bad values, not a
    // structural claim about the column itself.
    for (const m of mismatched) {
      issues.push({
        row: m.rowNum,
        column: header,
        severity: "LOW",
        confidence: "LOW",
        code: "FIELD_CONTENT_MISMATCH",
        message: `"${m.value}" doesn't look like ${shape.describe} — worth a second look, but most other values in this column do match.`,
        value: m.value,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_CONTENT_MISMATCH",
        affectedFields: [field],
        fixable: false,
      });
    }
  }

  return issues;
}

/** Deterministic, rule-based validation — no AI involved. Every uploaded
 *  file gets the same checks run against its actual mapped content.
 *  Issues reference the *original column header* wherever one is known
 *  (via the reverse of `mapping`), not the internal canonical field name
 *  — so a fixable rule issue and an AI-fixable issue always identify a
 *  column the same way, which matters once fixIssues() has to look that
 *  column up in rawRows (keyed by original header, not canonical field). */
export function runValidation(
  headers: string[],
  mapping: Record<string, TargetField>,
  rows: ParsedRow[],
  runtimeProfile: SourceProfile = getSourceProfile("ondo-aefi"),
): LineListIssue[] {
  const issues: LineListIssue[] = [];
  const mappedFields = new Set(Object.values(mapping));
  const headerForField = new Map<TargetField, string>();
  for (const [header, field] of Object.entries(mapping)) headerForField.set(field, header);
  const col = (field: TargetField): string => headerForField.get(field) ?? field;

  if (mappedFields.size === 0 && rows.length > 0) {
    issues.push({
      row: 0,
      column: "(all columns)",
      severity: "CRITICAL",
      confidence: "HIGH",
      code: "NO_COLUMNS_MAPPED",
      message: `None of the columns (${headers.join(", ")}) could be automatically matched to an expected field (${TARGET_FIELDS.join(", ")}). Manual column mapping is required before this file can be validated.`,
      value: null,
      source: "rule",
      sources: ["rule"],
      // Deliberately no issueType/affectedFields: this is a whole-file
      // finding, not about any specific field, and must never be treated
      // as mergeable with anything.
      fixable: false,
    });
    return issues;
  }

  const seenCaseIds = new Map<string, number>();
  const today = new Date();

  // E2B needs the date each report was first received (C.1.4). Without a
  // column for it, the export can only use the date it was processed —
  // worth knowing, not worth a finding on every row.
  if (!mappedFields.has("report_date") && rows.length > 0) {
    issues.push({
      row: 0,
      column: "(file)",
      severity: "LOW",
      confidence: "HIGH",
      code: "NO_REPORT_DATE_COLUMN",
      message:
        'No report date column was found, so each case\'s "date first received" (E2B C.1.4) will be the date the file is processed. Add a "Date reported" column if the source has one.',
      value: null,
      source: "rule",
      sources: ["rule"],
      fixable: false,
    });
  }

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;

    (["patient_identifier", "product", "reaction"] as const).forEach((field) => {
      // A row that supplies its reaction as a CODE has supplied it. Saying
      // "reaction is required" there is simply wrong, and it masks the real
      // problem — that the code cannot be decoded without a codebook, which
      // the dedicated check below reports properly.
      if (field === "reaction" && !row.reaction && row.reaction_code) return;
      if (!row[field]) {
        issues.push({
          row: rowNum,
          column: col(field),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: `MISSING_${field.toUpperCase()}`,
          message: `${field.replaceAll("_", " ")} is required.`,
          value: null,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_MISSING",
          affectedFields: [field],
          fixable: false,
        });
      }
    });

    // Split exactly the way E2B export splits products (this line list's
    // own separators and saved parsing options), so "MR/MV" — one vaccine —
    // is never flagged, and a real list is described as it will be sent:
    // several suspect products in ONE case. Separate rows would wrongly
    // create separate cases.
    const productSplit = row.product
      ? splitBySourceProfile(
          row.product,
          runtimeProfile,
          runtimeProfile.productDelimiter ?? runtimeProfile.reactionDelimiter,
        )
      : null;
    if (row.product && productSplit && productSplit.values.length > 1) {
      issues.push({
        row: rowNum,
        column: col("product"),
        severity: "LOW",
        confidence: "HIGH",
        code: "MULTIPLE_PRODUCTS_IN_CELL",
        message: `Lists ${productSplit.values.length} products (${productSplit.values.join("; ")}). Each is reported as a separate suspect product in this one case — no action needed if that is right.`,
        value: row.product,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_FORMAT_INVALID",
        affectedFields: ["product"],
        fixable: false,
      });
    }

    let onset: Date | null = null;
    if (!row.onset_date) {
      // Reached only when the onset date could not be DERIVED either (see
      // deriveOnsetDate) — so say which input was actually missing rather
      // than naming a column the form may not have. Previously this fired
      // on every row of a form that records onset as an interval, making
      // it noise instead of a finding.
      const hasVaccinationDate = !!row.vaccination_date;
      const hasInterval = !!row.onset_interval;
      const why =
        !hasVaccinationDate && !hasInterval
          ? "Neither an onset date nor a vaccination date and onset interval to derive it from were provided."
          : !hasVaccinationDate
            ? "An onset interval was provided but no vaccination date to measure it from, so the onset date cannot be derived."
            : !hasInterval
              ? "A vaccination date was provided but no onset interval, so the onset date cannot be derived."
              : `The onset interval "${row.onset_interval}" could not be read as a duration, so the onset date cannot be derived.`;
      issues.push({
        row: rowNum,
        column: col("onset_date") || col("onset_interval"),
        severity: "MEDIUM",
        confidence: "HIGH",
        code: "MISSING_ONSET_DATE",
        message: why,
        value: null,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_MISSING",
        affectedFields: ["onset_date"],
        fixable: false,
      });
    } else if (!DATE_RE.test(row.onset_date)) {
      issues.push({
        row: rowNum,
        column: col("onset_date"),
        severity: "HIGH",
        confidence: "HIGH",
        code: "INVALID_DATE_FORMAT",
        message: `"${row.onset_date}" does not look like a valid date (expected YYYY-MM-DD or similar).`,
        value: row.onset_date,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_FORMAT_INVALID",
        affectedFields: ["onset_date"],
        fixable: true,
      });
    } else {
      onset = parseDateLoose(row.onset_date);
      if (onset && onset > today) {
        issues.push({
          row: rowNum,
          column: col("onset_date"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "DATE_IN_FUTURE",
          message: "Onset date is in the future.",
          value: row.onset_date,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_VALUE_INVALID",
          affectedFields: ["onset_date"],
          fixable: false,
        });
      }
    }

    if (mappedFields.has("vaccination_date")) {
      let vaxDate: Date | null = null;
      if (row.vaccination_date && !DATE_RE.test(row.vaccination_date)) {
        issues.push({
          row: rowNum,
          column: col("vaccination_date"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "INVALID_DATE_FORMAT",
          message: `"${row.vaccination_date}" does not look like a valid date.`,
          value: row.vaccination_date,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_FORMAT_INVALID",
          affectedFields: ["vaccination_date"],
          fixable: true,
        });
      } else if (row.vaccination_date) {
        vaxDate = parseDateLoose(row.vaccination_date);
        if (vaxDate && vaxDate > today) {
          issues.push({
            row: rowNum,
            column: col("vaccination_date"),
            severity: "CRITICAL",
            confidence: "HIGH",
            code: "DATE_IN_FUTURE",
            message: "Vaccination date is in the future.",
            value: row.vaccination_date,
            source: "rule",
            sources: ["rule"],
            issueType: "FIELD_VALUE_INVALID",
            affectedFields: ["vaccination_date"],
            fixable: false,
          });
        }
      }
      if (vaxDate && onset && vaxDate > onset) {
        issues.push({
          row: rowNum,
          column: col("vaccination_date"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "DATE_CHRONOLOGY_VIOLATION",
          message: "Vaccination date is after the reaction's onset date.",
          value: row.vaccination_date ?? null,
          source: "rule",
          sources: ["rule"],
          issueType: "DATE_CHRONOLOGY",
          affectedFields: ["vaccination_date", "onset_date"],
          fixable: false,
        });
      }
    }

    if (row.seriousness && !SERIOUSNESS_VALUES.has(normalizeSeriousness(row.seriousness))) {
      issues.push({
        row: rowNum,
        column: col("seriousness"),
        severity: "MEDIUM",
        confidence: "HIGH",
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        message: `"${row.seriousness}" is not a recognised seriousness value (expected SERIOUS or NON_SERIOUS).`,
        value: row.seriousness,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["seriousness"],
        fixable: true,
      });
    }

    if (mappedFields.has("outcome")) {
      if (!row.outcome) {
        issues.push({
          row: rowNum,
          column: col("outcome"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "MISSING_OUTCOME",
          message: "Outcome was not provided.",
          value: null,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_MISSING",
          affectedFields: ["outcome"],
          fixable: false,
        });
      } else {
        // Decode through the SAME source-codebook/canonical-mapping
        // mechanism e2b-r3's mapping.ts uses (resolveFieldConcept +
        // mapConceptToOutcome) — never a second, disagreeing vocabulary
        // check. A source value can be genuinely unrecognised (no
        // codebook entry, no letters to treat as the concept itself:
        // UNKNOWN_SOURCE_CODE), understood but not yet given an approved
        // E2B mapping (HUMAN_REVIEW_REQUIRED), or fully resolved (MAPPED,
        // no issue at all).
        const outcomeResolution = resolveFieldConcept(
          row.outcome,
          runtimeProfile,
          "outcome",
          mapConceptToOutcome,
        );
        if (outcomeResolution?.status === "UNKNOWN_SOURCE_CODE") {
          issues.push({
            row: rowNum,
            column: col("outcome"),
            severity: "MEDIUM",
            confidence: "HIGH",
            code: "UNRECOGNISED_OUTCOME_VALUE",
            message: `"${row.outcome}" is not a recognised outcome value.`,
            value: row.outcome,
            source: "rule",
            sources: ["rule"],
            issueType: "FIELD_VALUE_INVALID",
            affectedFields: ["outcome"],
            fixable: false,
          });
        } else if (outcomeResolution?.status === "HUMAN_REVIEW_REQUIRED") {
          issues.push({
            row: rowNum,
            column: col("outcome"),
            // HIGH (not MEDIUM): this must always count toward invalidCases
            // on its own, so the "Generate E2B(R3)" button stays gated
            // shut for a row whose ONLY problem is an unresolved outcome
            // mapping — never relying on some other, unrelated HIGH/
            // CRITICAL finding happening to also be present on the row.
            severity: "HIGH",
            confidence: "HIGH",
            code: "OUTCOME_REQUIRES_HUMAN_REVIEW",
            message: `"${row.outcome}" decodes to "${outcomeResolution.decodedSourceValue}" — a real, understood concept, but no approved E2B(R3) outcome mapping is configured for it yet. Requires human review before export, never an automatic guess.`,
            value: row.outcome,
            source: "rule",
            sources: ["rule"],
            issueType: "FIELD_VALUE_INVALID",
            affectedFields: ["outcome"],
            fixable: false,
          });
        } else if (
          outcomeResolution?.canonicalValue === "FATAL" &&
          row.seriousness &&
          NON_SERIOUS_VALUES.has(normalizeSeriousness(row.seriousness))
        ) {
          issues.push({
            row: rowNum,
            column: col("seriousness"),
            severity: "HIGH",
            confidence: "HIGH",
            code: "FATAL_OUTCOME_NOT_MARKED_SERIOUS",
            message: "Outcome is fatal but seriousness is not marked serious.",
            value: row.seriousness,
            source: "rule",
            sources: ["rule"],
            issueType: "CROSS_FIELD_CONTRADICTION",
            affectedFields: ["outcome", "seriousness"],
            fixable: true,
          });
        }
      }
    }

    if (mappedFields.has("serious_code") && row.seriousness) {
      const hasSeriousCode =
        !!row.serious_code &&
        !["0", "none", "n/a", "-", "nil"].includes(row.serious_code.trim().toLowerCase());
      const isNonSerious = NON_SERIOUS_VALUES.has(normalizeSeriousness(row.seriousness));
      const isSerious = SERIOUS_TEXT_VALUES.has(normalizeSeriousness(row.seriousness));
      if (isNonSerious && hasSeriousCode) {
        issues.push({
          row: rowNum,
          column: col("serious_code"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "SERIOUSNESS_CONTRADICTION",
          message: `Row is marked non-serious but carries a serious-criteria code ("${row.serious_code}").`,
          value: row.serious_code ?? null,
          source: "rule",
          sources: ["rule"],
          issueType: "CROSS_FIELD_CONTRADICTION",
          affectedFields: ["seriousness", "serious_code"],
          fixable: false,
        });
      } else if (isSerious && !hasSeriousCode) {
        issues.push({
          row: rowNum,
          column: col("serious_code"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "SERIOUSNESS_CONTRADICTION",
          message: "Row is marked serious but no serious-criteria code is recorded.",
          value: null,
          source: "rule",
          sources: ["rule"],
          issueType: "CROSS_FIELD_CONTRADICTION",
          affectedFields: ["seriousness", "serious_code"],
          fixable: false,
        });
      }
    }

    // A VERBATIM source writes its reactions as words, so it has no codes to
    // decode and no codebook to be missing. Demanding one would block every
    // row of exactly the files the verbatim path exists to support.
    const sourceIsCoded = runtimeProfile.reactionEncoding !== "VERBATIM";
    const codebookIsEmpty = Object.keys(runtimeProfile.reactionCodebook.entries).length === 0;

    // Single-reaction-column forms (Ondo's "Reaction type (Codes - see 1
    // below)") put the code in `reaction`, not in a separate reaction_code
    // column, and only the latter was ever checked — so an undecoded number
    // passed validation standing in as the reaction term.
    //
    // Scope is deliberately narrow: the value must contain no letter at all.
    // A purely numeric "19" is not a reaction in any language, so calling it
    // undecodable states a fact rather than guessing at shape. Word
    // reactions are left alone even under a coded form — they are common
    // when someone leaves the source form at its default, they are still
    // quarantined at E2B export if they cannot be coded, and flagging every
    // such row CRITICAL here would bury the real finding. The known limit is
    // an alphanumeric local code ("R19", "AE-03"), which is indistinguishable
    // from a term by inspection and is caught by mapping such a file's code
    // column to reaction_code instead.
    if (
      sourceIsCoded &&
      codebookIsEmpty &&
      !row.reaction_code &&
      row.reaction &&
      !/[A-Za-z]/.test(row.reaction)
    ) {
      issues.push({
        row: rowNum,
        column: col("reaction"),
        severity: "CRITICAL",
        confidence: "HIGH",
        code: "REACTION_CODEBOOK_MISSING",
        message:
          `The reaction is recorded as "${row.reaction}", which the selected source form ` +
          `("${runtimeProfile.name}") reads as a local code — but no reaction codebook is ` +
          `available for that form, so it cannot be decoded. Supply this form's official code ` +
          `legend, or — if this file belongs to a different form — re-upload it choosing that ` +
          `form. The code is never guessed at.`,
        value: row.reaction,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_VALUE_INVALID",
        affectedFields: ["reaction"],
        fixable: false,
      });
      // No early return: the rest of the row's fields are still worth
      // checking, and the assessor should see every problem at once.
    }

    if (sourceIsCoded && mappedFields.has("reaction_code") && row.reaction_code) {
      const codes = row.reaction_code
        .split(/[,&]|\bAND\b/i)
        .map((c) => c.trim())
        .filter(Boolean);
      // Validate against the runtime profile's OWN discovered reaction
      // codebook — never a hardcoded numeric range. A fixed "1-28" range
      // baked in here would itself be a stale, source-specific assumption
      // (it happened to match Ondo's real 28-item legend, but a
      // differently-sized codebook, or none at all, would make it wrong
      // in both directions). When no codebook has been discovered at all,
      // the code cannot be judged at all — see the block immediately below.
      const codebookEntries = runtimeProfile.reactionCodebook.entries;
      const hasCodebook = !codebookIsEmpty;

      // No codebook at all is a different, worse problem than an
      // unrecognised code, and it used to pass silently: the fallback only
      // checked that the value LOOKED like a number, so "19" sailed through
      // line-list validation and the file was not blocked until E2B
      // preflight, long after the assessor had moved on. A code with nothing
      // to decode it against carries no meaning this system can act on, so
      // it is reported here, in the place the work is being done, and says
      // what would actually resolve it.
      if (!hasCodebook) {
        issues.push({
          row: rowNum,
          column: col("reaction_code"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "REACTION_CODEBOOK_MISSING",
          message:
            `Reaction is recorded as the code "${row.reaction_code}", but no reaction codebook ` +
            `is available for the selected source form ("${runtimeProfile.name}"), so the code ` +
            `cannot be decoded. Supply this form's official code legend, or — if this file ` +
            `actually writes its reactions as words — re-upload it choosing a source form that ` +
            `reads reactions as text. The code is never guessed at.`,
          value: row.reaction_code,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_VALUE_INVALID",
          affectedFields: ["reaction_code"],
          fixable: false,
        });
        return;
      }

      const invalid = codes.length === 0 || codes.some((c) => !codebookEntries[c.toUpperCase()]);
      if (invalid) {
        issues.push({
          row: rowNum,
          column: col("reaction_code"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "INVALID_REACTION_CODE",
          message: `"${row.reaction_code}" is not recognised by the active source profile's reaction codebook.`,
          value: row.reaction_code,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_VALUE_INVALID",
          affectedFields: ["reaction_code"],
          fixable: false,
        });
      }
    }

    if (mappedFields.has("dose") && !row.dose) {
      issues.push({
        row: rowNum,
        column: col("dose"),
        severity: "CRITICAL",
        confidence: "HIGH",
        code: "MISSING_DOSE",
        message: "Dose was not provided.",
        value: null,
        source: "rule",
        sources: ["rule"],
        issueType: "FIELD_MISSING",
        affectedFields: ["dose"],
        fixable: false,
      });
    }

    if (mappedFields.has("vaccine_batch")) {
      const batch = (row.vaccine_batch ?? "").trim();
      if (!batch || BATCH_PLACEHOLDER_VALUES.has(batch.toUpperCase())) {
        issues.push({
          row: rowNum,
          column: col("vaccine_batch"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "MISSING_VACCINE_BATCH",
          message: "Vaccine batch/lot number was not provided.",
          value: row.vaccine_batch ?? null,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_MISSING",
          affectedFields: ["vaccine_batch"],
          fixable: false,
        });
      } else if (MULTI_VALUE_RE.test(batch)) {
        issues.push({
          row: rowNum,
          column: col("vaccine_batch"),
          severity: "MEDIUM",
          confidence: "HIGH",
          code: "MULTIPLE_BATCH_NUMBERS_IN_CELL",
          message: `"${batch}" appears to list multiple batch numbers in one cell — these should be separate rows.`,
          value: batch,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_FORMAT_INVALID",
          affectedFields: ["vaccine_batch"],
          fixable: false,
        });
      }
    }

    if (mappedFields.has("reporter_phone")) {
      const digits = (row.reporter_phone ?? "").replace(/\D/g, "");
      if (!row.reporter_phone) {
        issues.push({
          row: rowNum,
          column: col("reporter_phone"),
          severity: "MEDIUM",
          confidence: "HIGH",
          code: "MISSING_REPORTER_PHONE",
          message: "Reporter phone number was not provided.",
          value: null,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_MISSING",
          affectedFields: ["reporter_phone"],
          fixable: false,
        });
      } else if (digits.length < 10 || digits.length > 14) {
        issues.push({
          row: rowNum,
          column: col("reporter_phone"),
          // MEDIUM, matching MISSING_REPORTER_PHONE directly above.
          // CRITICAL here produced a rule where a blank phone passed and a
          // phone recorded as "1" blocked the case — a malformed optional
          // field treated as more serious than an absent one. Reporter
          // phone is not an E2B(R3) mandatory element and no downstream
          // export depends on it, so a bad value is a data-quality note for
          // the assessor, not grounds to stop the case being processed. On
          // one real upload this alone blocked 18 of 231 rows.
          severity: "MEDIUM",
          confidence: "HIGH",
          code: "INVALID_REPORTER_PHONE",
          message: `"${row.reporter_phone}" does not look like a valid phone number (expected 10-14 digits).`,
          value: row.reporter_phone,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_FORMAT_INVALID",
          affectedFields: ["reporter_phone"],
          fixable: false,
        });
      }
    }

    if (row.case_id) {
      const firstRow = seenCaseIds.get(row.case_id);
      if (firstRow !== undefined) {
        issues.push({
          row: rowNum,
          column: col("case_id"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "DUPLICATE_CASE_ID",
          message: `case_id "${row.case_id}" also appears on row ${firstRow}.`,
          value: row.case_id,
          source: "rule",
          sources: ["rule"],
          issueType: "DUPLICATE_RECORD",
          affectedFields: ["case_id"],
          fixable: false,
        });
      } else {
        seenCaseIds.set(row.case_id, rowNum);
      }
    }
  });

  issues.push(...checkCaseIdConsistency(rows, col("case_id")));
  issues.push(...detectColumnShifts(mapping, rows));

  return issues;
}

/** Trims/case-folds a finding's evidence value for comparison across
 *  engines. Only ever used to check evidence *compatibility* between two
 *  otherwise-matching findings — never as the primary identity signal on
 *  its own, since freeform AI wording can't be trusted as an exact key. */
function normalizeEvidence(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

/** A stable, engine-agnostic identity for a finding, used to decide
 *  whether a rule finding and an AI finding describe the *same underlying
 *  issue* — deliberately NOT based on `code` (a rule's fixed code and an
 *  AI-invented one will essentially never match) or on freeform message
 *  text (too fragile to key off). Requires the same row, the same
 *  normalized issue classification, AND the same set of affected
 *  canonical fields: a field-level finding on ["seriousness"] is never
 *  equivalent to a cross-field finding on ["seriousness","outcome"], even
 *  on the same row — see LineListIssueType's own doc comment. Returns
 *  null for a finding with no issueType/affectedFields (e.g.
 *  NO_COLUMNS_MAPPED, or an older/demo-seeded issue) — those are never
 *  merge-eligible, which is the safe default when classification is
 *  unavailable rather than guessing from row+column alone. */
function findingIdentity(issue: LineListIssue): string | null {
  if (!issue.issueType || !issue.affectedFields || issue.affectedFields.length === 0) return null;
  const fields = [...issue.affectedFields]
    .map((f) => f.trim().toLowerCase())
    .sort()
    .join("+");
  return `${issue.row}::${issue.issueType}::${fields}`;
}

/** Two findings sharing an identity are only the same *occurrence* of
 *  that issue if their evidence doesn't outright contradict — a rule
 *  finding flagging value "ABC" and an AI finding flagging a different
 *  value "XYZ" on the same row/field/type are not the same event and
 *  must not be silently merged. When either side has no concrete value
 *  (e.g. a FIELD_MISSING finding, which is never about a specific wrong
 *  value), there's nothing to contradict, so they're compatible. */
function evidenceCompatible(a: LineListIssue, b: LineListIssue): boolean {
  const av = normalizeEvidence(a.value);
  const bv = normalizeEvidence(b.value);
  if (av === null || bv === null) return true;
  return av === bv;
}

/** Rule findings are always included — never suppressed by AI running
 *  successfully, never erased by it. An AI finding is only folded into an
 *  existing rule finding (as combined provenance, sources: ["rule","ai"])
 *  when they share a stable semantic identity (findingIdentity) and don't
 *  contradict on evidence (evidenceCompatible) — same cell alone is never
 *  enough, since two genuinely different problems can land on the same
 *  cell (e.g. a rule's UNRECOGNISED_SERIOUSNESS_VALUE and an AI's
 *  cross-field seriousness/hospitalization contradiction both anchored at
 *  "seriousness" on the same row must both survive, not collapse into
 *  one). Anything AI reports that doesn't match an existing rule finding
 *  this way is additive, exactly as before. Each rule finding can be
 *  matched by at most one AI finding. */
export function mergeFindings(
  ruleIssues: LineListIssue[],
  aiIssues: LineListIssue[],
): LineListIssue[] {
  const matchedRuleIndexes = new Set<number>();
  const additiveAi: LineListIssue[] = [];

  for (const ai of aiIssues) {
    const aiKey = findingIdentity(ai);
    const matchIdx =
      aiKey === null
        ? -1
        : ruleIssues.findIndex(
            (rule, idx) =>
              !matchedRuleIndexes.has(idx) &&
              findingIdentity(rule) === aiKey &&
              evidenceCompatible(rule, ai),
          );
    if (matchIdx >= 0) {
      matchedRuleIndexes.add(matchIdx);
    } else {
      additiveAi.push({ ...ai, sources: ai.sources ?? ["ai"] });
    }
  }

  const finalRules = ruleIssues.map((rule, idx) => ({
    ...rule,
    sources: matchedRuleIndexes.has(idx) ? (["rule", "ai"] as const) : (rule.sources ?? ["rule"]),
    source: matchedRuleIndexes.has(idx) ? ("rule" as const) : rule.source,
  }));

  return [...finalRules, ...additiveAi] as LineListIssue[];
}

/** Where each row of a job came from: its row in the original file (when recorded)
 *  and the file's own case ID (when the file has one). */
export function describeRow(
  job: Pick<LineListJob, "sourceRowNumbers"> & { parsedRows?: ParsedRow[] | undefined },
  row: number,
): { fileRow?: number; caseId?: string } {
  if (row < 1) return {};
  const fileRow = job.sourceRowNumbers?.[row - 1];
  const caseId = job.parsedRows?.[row - 1]?.case_id?.trim();
  return {
    ...(fileRow ? { fileRow } : {}),
    ...(caseId ? { caseId } : {}),
  };
}

/** "File row 29 (case ABC-12)" — or the data-row number for jobs that
 *  predate row tracking. */
export function rowLabel(
  job: Pick<LineListJob, "sourceRowNumbers"> & { parsedRows?: ParsedRow[] | undefined },
  row: number,
): string {
  if (row < 1) return "Whole file";
  const { fileRow, caseId } = describeRow(job, row);
  const where = fileRow ? `File row ${fileRow}` : `Row ${row}`;
  return caseId ? `${where} (case ${caseId})` : where;
}

/** Only ever runs while a person is waiting on validation, so it is capped:
 *  the rest keep their "Suggest with AI" button on the line-list page. */
const MAX_REACTION_SUGGESTIONS_PER_RUN = 25;

/**
 * Adds words this line list used that nothing could resolve to the
 * organization's memory (outcome words, reaction terms, reporter
 * designations), with an AI proposal where one is cheap to get. A proposal
 * is only ever shown pre-selected; a person saves it. Best-effort: a
 * failure here never fails validation.
 */
async function recordDiscoveries(
  discovered: LineListE2bCheckResult["discovered"],
  file: string,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (discovered.designations.length > 0) {
    tasks.push(discoverReporterDesignations(discovered.designations));
  }
  if (discovered.outcomeTerms.length > 0) {
    tasks.push(
      (async () => {
        const fresh = await termMappings.discover("OUTCOME", discovered.outcomeTerms, file);
        if (fresh.length === 0) return;
        const response = await ai.linelist.mapOutcomes({ terms: fresh.map((t) => t.term) });
        if (!response.ai_used) return;
        for (const proposal of response.proposals) {
          const row = fresh.find((t) => t.termKey === termKey("OUTCOME", proposal.term));
          if (!row || !proposal.outcome) continue;
          await termMappings.saveAiSuggestion(row.id, {
            value: proposal.outcome,
            confidence: proposal.confidence,
            reason: proposal.reason,
          });
        }
      })(),
    );
  }
  if (discovered.reactionTerms.length > 0) {
    tasks.push(
      (async () => {
        const fresh = await termMappings.discover("REACTION", discovered.reactionTerms, file);
        for (const row of fresh.slice(0, MAX_REACTION_SUGGESTIONS_PER_RUN)) {
          const match = await suggestMedDraTerm(row.term);
          if (match) await termMappings.saveAiSuggestion(row.id, match);
        }
      })(),
    );
  }
  await Promise.allSettled(tasks);
}

/**
 * The file has a patient record number and nobody has said which record it
 * is. Reported once, against the file, because it is one decision for the
 * whole line list — and not as a blocker: D.1.1 is optional under ICH, so
 * the export is valid without it. What it is NOT is silent: the number is
 * sitting in the file, and one choice releases it.
 */
function undecidedRecordNumberIssue(
  job: { mapping?: Record<string, TargetField> | undefined },
  profile: SourceProfile,
): LineListIssue[] {
  const header = Object.entries(job.mapping ?? {}).find(([, f]) => f === "patient_id")?.[0];
  if (!header || profile.patientRecordNumberSource) return [];
  return [
    {
      row: 0,
      column: header,
      severity: "MEDIUM",
      confidence: "HIGH",
      code: "PATIENT_RECORD_NUMBER_SOURCE_UNDECIDED",
      message: `"${header}" holds a patient record number, but nothing says which record it is. E2B(R3) has a separate element for a GP's, a specialist's, a hospital's and an investigation's record, so the number is kept and not exported until someone chooses — it is never guessed.`,
      value: header,
      source: "rule",
      sources: ["rule"],
      issueType: "FIELD_VALUE_INVALID",
      affectedFields: ["patient_id"],
      fixable: false,
      fixIn: "PATIENT_RECORD_NUMBER",
      e2bField: "D.1.1",
    },
  ];
}

/** A model's reading of a verbatim reaction, kept only if it lands on a
 *  real MedDRA 29.1 LLT — never a free-text guess. */
export async function suggestMedDraTerm(
  text: string,
): Promise<{ value: string; label: string; confidence: number; reason: string } | null> {
  try {
    const proposal = await ai.coding.suggest({ dictionary: "MedDRA", text });
    if (!proposal.ai_used) return null;
    for (const candidate of proposal.candidates) {
      const matches = (await coding.searchDictionary("MedDRA", candidate.term)).filter(
        (m) => m.source === "dictionary",
      );
      // A dictionary search for "Vomiting" also returns "Bilious vomiting";
      // the term the model actually proposed is the one to offer, so prefer
      // an exact match and otherwise the closest (shortest) one, never just
      // whatever the search happened to rank first.
      const wanted = candidate.term.trim().toLowerCase();
      const hit =
        matches.find((m) => m.term.trim().toLowerCase() === wanted) ??
        [...matches].sort((x, y) => x.term.length - y.term.length)[0];
      if (hit) {
        return {
          value: hit.code,
          label: hit.term,
          confidence: 0.8,
          reason: candidate.rationale || `AI read "${text}" as "${candidate.term}".`,
        };
      }
    }
  } catch {
    // No suggestion is an ordinary outcome, not an error.
  }
  return null;
}

/**
 * Every deterministic finding for a job: the line list's own data-quality
 * rules plus every E2B(R3)/VigiFlow blocker in its data, from the same
 * engine E2B export runs. Used by validate, fix and recheck, so all three
 * always agree.
 */
async function computeDeterministicIssues(job: LineListJobRow): Promise<LineListIssue[]> {
  // The organization's own decisions (outcome words, reporter designations)
  // belong to the line list's rules too — without them the older checks keep
  // reporting a word that Settings has already resolved.
  let orgConfig: OrgRegulatoryConfig | null = null;
  try {
    orgConfig = await regulatoryConfig.get();
  } catch {
    orgConfig = null;
  }
  const jobProfile = resolveJobRuntimeProfile(job);
  const profile = orgConfig
    ? mergeOrgRegulatoryConfigIntoProfile(jobProfile, orgConfig)
    : jobProfile;
  const ruleIssues = RULE_BASED_DETECTION_ENABLED
    ? runValidation(job.columns ?? [], job.mapping ?? {}, job.parsedRows ?? [], profile)
    : [];
  if (!job.parsedRows || job.parsedRows.length === 0) return ruleIssues;
  try {
    if (!orgConfig) throw new Error("organization configuration unavailable");
    const { cases } = await mapJobToCases(job, orgConfig);
    const check = checkCasesForE2b(cases, job.mapping ?? {});
    await recordDiscoveries(check.discovered, job.filename);
    return [
      ...mergeE2bIssues(ruleIssues, check.issues),
      ...undecidedRecordNumberIssue(job, profile),
    ];
  } catch (err) {
    return [
      ...ruleIssues,
      {
        row: 0,
        column: "(all rows)",
        severity: "MEDIUM",
        confidence: "HIGH",
        code: "E2B_CHECK_UNAVAILABLE",
        message: `E2B(R3) readiness could not be checked: ${err instanceof Error ? err.message : "unknown error"}. Re-run validation to try again.`,
        value: null,
        source: "rule",
        sources: ["rule"],
        fixable: false,
      },
    ];
  }
}

/** Replaces a job's stored findings and recomputes its summary counts. */
async function storeIssues(
  job: LineListJobRow,
  issues: LineListIssue[],
  extra: Partial<LineListJobRow> = {},
): Promise<LineListJobRow> {
  await supabase.from("pv_linelist_issues").delete().eq("job_id", job.id);
  if (issues.length > 0) {
    const { error } = await supabase
      .from("pv_linelist_issues")
      .insert(issues.map((i) => ({ id: newId("lli"), job_id: job.id, data: toJson(i) })));
    if (error) throw new Error(error.message);
  }
  const blocking = issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const advisory = issues.filter((i) => i.severity === "MEDIUM" || i.severity === "LOW");
  const invalidCases = new Set(blocking.filter((i) => i.row > 0).map((i) => i.row)).size;
  // A blocker recorded against the file rather than a row (the wrong
  // source form, say) stops every case in it, so it is never counted as
  // zero blocked cases.
  const e2bBlocked = issues.filter((i) => i.blocksE2b);
  const wholeFileBlocked = e2bBlocked.some((i) => i.row === 0);
  const next: LineListJobRow = {
    ...job,
    ...extra,
    stage: job.stage === "E2B_GENERATED" ? "E2B_GENERATED" : "VALIDATED",
    invalidCases,
    warnings: advisory.length,
    criticalCount: issues.filter((i) => i.severity === "CRITICAL").length,
    highCount: issues.filter((i) => i.severity === "HIGH").length,
    mediumCount: issues.filter((i) => i.severity === "MEDIUM").length,
    lowCount: issues.filter((i) => i.severity === "LOW").length,
    validCases: Math.max(job.rows - invalidCases, 0),
    e2bBlockedCases: wholeFileBlocked ? job.rows : new Set(e2bBlocked.map((i) => i.row)).size,
    openFixIn: [...new Set(e2bBlocked.map((i) => i.fixIn ?? "FILE"))],
    checkedAt: new Date().toISOString(),
  };
  await saveJob(next);
  return next;
}

/** Corrections the fix model returned, limited to what it was asked to fix
 *  and never touching the case-ID column: a line list's own IDs are how a
 *  person traces a case back to the source, so no automated fix may
 *  rewrite them. */
export function safeCorrections<C extends { row: number; column: string }>(
  corrections: C[],
  requested: { row: number; column: string }[],
  mapping: Record<string, string>,
): C[] {
  const allowed = new Set(requested.map((i) => `${i.row}:${i.column}`));
  return corrections.filter(
    (c) => allowed.has(`${c.row}:${c.column}`) && mapping[c.column] !== "case_id",
  );
}

export const linelist = {
  jobs: async (): Promise<LineListJob[]> => {
    const { data, error } = await supabase.from("pv_linelist_jobs").select("data");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as LineListJob)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  /** `sourceProfileId` names which SourceProfile decodes this file — most
   *  importantly whether its reaction column holds local codes or plain
   *  words. Defaults to the historical profile so an existing caller that
   *  passes nothing behaves exactly as before. */
  upload: async (file: File, sourceProfileId?: string): Promise<LineListJob> => {
    const actor = currentActor();
    let job: LineListJobRow;

    try {
      const {
        headers,
        rows,
        warnings: parseWarnings,
        sheetName,
        headerRowNumber,
        discardedRowsText,
        discardedRows,
        sourceRowNumbers,
      } = await parseTabularFile(file);
      const rawRows = toRawRows(headers, rows);
      // Keyword mapping first, always — it is the floor the AI pass is
      // merged onto and the whole mapping if that pass is unavailable.
      const keywordMapping = mapColumns(headers);
      let proposals: {
        column: string;
        field?: string | null;
        confidence: number;
        reason: string;
      }[] = [];
      let aiMappingUsed = false;
      // One retry, because the observed failure is transient: a live upload
      // hit a single 401 when the request went out against a session token
      // that was mid-refresh, and silently fell back to keyword mapping.
      // Two attempts is the whole budget — this sits in the upload path.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const proposed = await ai.linelist.mapColumns({ headers, rows: rawRows });
          proposals = proposed.proposals;
          aiMappingUsed = proposed.ai_used;
          break;
        } catch {
          // Never fails an upload. The endpoint already answers 200 with
          // ai_used:false for its own failures; this catches the layer
          // below it (backend unreachable, token refresh, request aborted)
          // with the same outcome.
          aiMappingUsed = false;
        }
      }
      const decision = mergeColumnMapping(keywordMapping, proposals, aiMappingUsed, headers);
      const mapping = decision.mapping;
      const parsedRows = toParsedRows(headers, rows, mapping);
      job = {
        id: newId("ll"),
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: actor.name,
        rows: parsedRows.length,
        stage: "UPLOADED",
        sourceProfileId: sourceProfileId || DEFAULT_SOURCE_PROFILE_ID,
        validCases: 0,
        invalidCases: 0,
        warnings: 0,
        columns: headers,
        mapping,
        mappingSource: decision.source,
        mappingNotes: decision.notes,
        mappingAiUsed: decision.aiUsed,
        parsedRows,
        rawRows,
        parseWarnings,
        discardedRowsText,
        discardedRows,
        sheetName,
        headerRowNumber,
        sourceRowNumbers,
      };
    } catch (err) {
      job = {
        id: newId("ll"),
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: actor.name,
        rows: 0,
        stage: "FAILED",
        validCases: 0,
        invalidCases: 0,
        warnings: 0,
      };
      const { error } = await supabase
        .from("pv_linelist_jobs")
        .insert({ id: job.id, data: toJson(job) });
      if (error) throw new Error(error.message);
      await supabase.from("pv_linelist_issues").insert({
        id: newId("lli"),
        job_id: job.id,
        data: toJson({
          row: 0,
          column: "(file)",
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "UNREADABLE_FILE",
          message:
            err instanceof Error
              ? err.message
              : "The uploaded file could not be parsed as CSV or XLSX.",
          value: null,
          source: "rule",
          fixable: false,
        } satisfies LineListIssue),
      });
      await recordAudit({
        action: "LINELIST_UPLOADED",
        entity: "LineListJob",
        entityId: job.id,
        newValue: `${file.name} — could not be parsed`,
      });
      return job;
    }

    const { error } = await supabase
      .from("pv_linelist_jobs")
      .insert({ id: job.id, data: toJson(job) });
    if (error) throw new Error(error.message);
    const parseNote = job.parseWarnings?.length ? ` — ${job.parseWarnings.join(" ")}` : "";
    await recordAudit({
      action: "LINELIST_UPLOADED",
      entity: "LineListJob",
      entityId: job.id,
      newValue: `${file.name} (${job.rows} rows, ${Object.keys(job.mapping ?? {}).length}/${TARGET_FIELDS.length} canonical columns matched, ${job.columns?.length ?? 0} total columns retained)${parseNote}`,
    });
    return job;
  },

  inspect: async (jobId: string): Promise<ColumnInspection> => {
    const job = await readJob(jobId);
    const columns = job.columns ?? [];
    return {
      jobId,
      detectedColumns: columns.map((name) => ({
        name,
        sample: (job.parsedRows ?? [])
          .slice(0, 3)
          .map((r) => (job.mapping?.[name] ? (r[job.mapping[name]] ?? "") : "")),
        suggestedField: job.mapping?.[name] ?? null,
      })),
      targetFields: [...TARGET_FIELDS],
    };
  },

  map: async (jobId: string, mapping: Record<string, string>): Promise<LineListJob> => {
    const job = await readJob(jobId);
    await recordAudit({
      action: "LINELIST_MAPPED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: Object.keys(mapping).join(", "),
    });
    return saveJob({ ...job, stage: "MAPPED", mapping: mapping as Record<string, TargetField> });
  },

  normalize: async (jobId: string): Promise<LineListJob> => {
    const job = await readJob(jobId);
    await recordAudit({ action: "LINELIST_NORMALISED", entity: "LineListJob", entityId: jobId });
    return saveJob({ ...job, stage: "NORMALISED" });
  },

  /**
   * OpenAI is the primary validation engine here: for a real upload, its
   * findings are requested and merged in alongside the deterministic rule
   * checks (which always run regardless, and are what's shown alone if AI
   * is unavailable, times out, or returns something unusable — see
   * src/server/routes/ai_linelist.py, which never lets that surface as an
   * error, only as ai_used: false). Each issue is tagged with its source
   * so the UI never presents the two as indistinguishable. The AI call
   * always gets every original column (rawRows) when the job has one, not
   * just the ones the deterministic matcher recognised — a column outside
   * the app's canonical field list is never invisible to the AI pass.
   */
  validate: async (
    jobId: string,
  ): Promise<{
    job: LineListJob;
    issues: LineListIssue[];
    aiUsed: boolean;
    aiError?: string | undefined;
  }> => {
    const job = await readJob(jobId);
    let issues: LineListIssue[];
    let aiUsed = false;
    let aiError: string | undefined;
    let promptVersion: string | undefined = job.promptVersion;

    if (job.parsedRows) {
      // Real upload — re-run validation against the actual parsed content
      // every time, so the result always reflects the current data.
      // Line-list rules plus every E2B(R3)/VigiFlow blocker in this file's
      // data, from the same engine export runs — so nothing new appears on
      // the E2B page once this list is clean. Words nothing could resolve
      // (outcomes, reactions, designations) are recorded for the
      // organization to decide once.
      const ruleIssues = await computeDeterministicIssues(job);
      const parsedRows = job.parsedRows;

      const analysisRows = (job.rawRows ?? parsedRows) as Record<string, string>[];
      let aiIssues: LineListIssue[] = [];
      try {
        const analysis = await ai.linelist.analyze({
          headers: job.columns ?? [],
          mapping: job.mapping ?? {},
          rows: analysisRows,
        });
        aiUsed = analysis.ai_used;
        aiError = analysis.error ?? undefined;
        promptVersion = analysis.prompt_version;
        aiIssues = analysis.findings.map((f) => ({
          row: f.row,
          column: f.column,
          severity: f.severity,
          confidence: f.confidence,
          code: f.code,
          message: f.message,
          value: f.value,
          fixable: f.fixable,
          source: "ai" as const,
          sources: ["ai"] as const,
          ...(f.issueType ? { issueType: f.issueType as LineListIssueType } : {}),
          ...(f.affectedFields && f.affectedFields.length > 0
            ? { affectedFields: f.affectedFields }
            : {}),
        }));
      } catch (err) {
        // The AI endpoint itself is unreachable (network/deploy issue,
        // not just "no key") — rule-based findings still stand alone.
        aiUsed = false;
        aiError = err instanceof Error ? err.message : "AI analysis unavailable.";
      }

      // Rule-based findings are authoritative for the deterministic facts
      // they check (missing fields, malformed dates, chronology, invalid
      // codes, possible column shifts) and are never suppressed just
      // because AI also ran — AI can only add findings on top, never erase
      // one. Where both land on the exact same cell, that's the same
      // underlying issue seen twice, so the AI-worded duplicate is dropped
      // in favour of the rule's version (see mergeFindings).
      issues = mergeFindings(ruleIssues, aiIssues);
    } else {
      // Legacy/seeded demo job with no stored raw parse — preserve its
      // existing issues rather than silently erasing them.
      issues = await linelist.issues(jobId);
    }

    const next = await storeIssues(job, issues, {
      validatedAt: new Date().toISOString(),
      ...(promptVersion ? { promptVersion } : {}),
    });
    const invalidCases = next.invalidCases;
    const advisory = { length: next.warnings };
    await recordAudit({
      action: "LINELIST_VALIDATED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: `${next.validCases} valid / ${invalidCases} invalid / ${advisory.length} warning(s)${aiUsed ? (RULE_BASED_DETECTION_ENABLED ? " (AI + rule-based)" : " (AI only — rule-based detection disabled)") : RULE_BASED_DETECTION_ENABLED ? " (rule-based only — AI unavailable)" : " (no detection engine available)"}`,
    });
    return { job: next, issues, aiUsed, aiError };
  },

  /**
   * Re-runs the fast, deterministic checks (line-list rules + E2B
   * blockers) against the job's current data and settings, keeping every
   * earlier AI finding. What makes a Settings decision, a parsing-option
   * change or a data fix show up immediately on both pages, without a slow
   * full AI re-analysis.
   */
  recheck: async (jobId: string): Promise<LineListJob> => {
    const job = await readJob(jobId);
    if (!job.parsedRows) return job;
    const previous = await linelist.issues(jobId);
    const priorAi = previous.filter(
      (i) => i.source === "ai" && !(i.sources ?? []).includes("rule"),
    );
    const issues = mergeFindings(await computeDeterministicIssues(job), priorAi);
    return storeIssues(job, issues);
  },

  /** Rechecks every line list with an open blocker a decision at `fixIn`
   *  can clear — e.g. after an outcome word is mapped in Settings. */
  recheckAffected: async (fixIn: LineListFixLocation): Promise<number> => {
    const all = await linelist.jobs();
    const affected = all.filter((j) => (j.openFixIn ?? []).includes(fixIn));
    for (const j of affected) await linelist.recheck(j.id);
    return affected.length;
  },

  /** Saves how this line list's ambiguous separators are read. Applies to
   *  line-list checks, E2B preflight and export alike, and survives reloads
   *  — so cases (and any C.1.7 decision bound to them) stay stable. */
  setParsingOptions: async (
    jobId: string,
    options: {
      slashSeparatesReactions: boolean;
      productCellIsOneName: boolean;
      /** D.1.1.1-D.1.1.4 — whose record the patient-id column holds.
       *  `null` clears a previous decision back to undecided. */
      patientRecordNumberSource?: PatientRecordNumberSource | null | undefined;
    },
  ): Promise<LineListJob> => {
    const actor = currentActor();
    const job = await readJob(jobId);
    const previous = job.parsingOptions;
    const { patientRecordNumberSource, ...reading } = options;
    // undefined means "leave whatever was decided before"; null is a person
    // saying not to export one, which is itself a decision and is recorded
    // as one so the column's name stops answering for them.
    const untouched = patientRecordNumberSource === undefined;
    const decided = untouched
      ? previous?.patientRecordNumberSource
      : (patientRecordNumberSource ?? undefined);
    const declined = untouched
      ? previous?.patientRecordNumberDeclined
      : patientRecordNumberSource === null;
    const parsingOptions = {
      ...reading,
      ...(decided ? { patientRecordNumberSource: decided } : {}),
      ...(declined ? { patientRecordNumberDeclined: true } : {}),
      setBy: actor.name,
      setAt: new Date().toISOString(),
    };
    await saveJob({ ...job, parsingOptions });
    await recordAudit({
      action: "LINELIST_PARSING_OPTIONS_CHANGED",
      entity: "LineListJob",
      entityId: jobId,
      previousValue: previous
        ? `slash separates reactions: ${!!previous.slashSeparatesReactions}; product cell is one name: ${!!previous.productCellIsOneName}`
        : "defaults",
      newValue: `slash separates reactions: ${options.slashSeparatesReactions}; product cell is one name: ${options.productCellIsOneName}; patient record number source: ${declined ? "declined — not exported" : (decided ?? "undecided")}`,
    });
    return linelist.recheck(jobId);
  },

  /** Reads an already-uploaded file as a different source form. The form
   *  decides whether the reaction column holds local codes or reactions
   *  written out, so choosing wrongly at upload blocked every row with no
   *  way back but a re-upload. Re-reads the rows from the file already
   *  stored: nothing is uploaded again, and the change is audited.
   *
   *  Cases are rebuilt, so a C.1.7 decision taken against the old reading
   *  is superseded exactly as it is for any other change to the data. */
  setSourceProfile: async (jobId: string, sourceProfileId: string): Promise<LineListJob> => {
    const job = await readJob(jobId);
    const previous = job.sourceProfileId || DEFAULT_SOURCE_PROFILE_ID;
    if (previous === sourceProfileId) return job;
    await saveJob({ ...job, sourceProfileId });
    await recordAudit({
      action: "LINELIST_SOURCE_PROFILE_CHANGED",
      entity: "LineListJob",
      entityId: jobId,
      previousValue: previous,
      newValue: sourceProfileId,
    });
    return linelist.recheck(jobId);
  },

  /** A person confirms the MedDRA term for a reaction word from this line
   *  list. Remembered for the organization; every affected line list is
   *  rechecked. */
  codeReactionTerm: async (
    jobId: string,
    term: string,
    llt: { code: string; term: string },
  ): Promise<void> => {
    const job = await readJob(jobId);
    await termMappings.decideByTerm("REACTION", term, llt.code, llt.term, job.filename);
    await linelist.recheckAffected("REACTION_TERMS");
  },

  issues: async (jobId: string): Promise<LineListIssue[]> => {
    const { data, error } = await supabase
      .from("pv_linelist_issues")
      .select("data")
      .eq("job_id", jobId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.data as unknown as LineListIssue);
  },

  /**
   * Sends every currently-fixable issue OpenAI can safely auto-apply to
   * the fix endpoint, applies the corrections it can confidently make to
   * both the job's raw (original-column) and canonical parsed data,
   * persists that as the new active dataset (E2B, the CSV download, and
   * any later validation pass then see only the corrected data — there is
   * no separate "fixed copy"), and re-validates so the UI immediately
   * reflects what's actually resolved versus still outstanding.
   *
   * A LOW-confidence AI finding (an inferred column role, a typo/judgment
   * call — see the analysis prompt) is never auto-applied even if marked
   * fixable: it's held out and reported as unresolved, requiring a human
   * to decide either way, rather than either silently applying an
   * uncertain guess or silently dropping it. Never fabricates a value:
   * anything OpenAI can't safely determine is left unchanged and reported
   * as unresolved too.
   */
  fixIssues: async (
    jobId: string,
  ): Promise<{
    job: LineListJob;
    issues: LineListIssue[];
    correctionsApplied: number;
    unresolved: { row: number; column: string; reason: string }[];
    aiUsed: boolean;
    aiError?: string | undefined;
  }> => {
    const job = await readJob(jobId);
    if (!job.parsedRows || !job.columns || !job.mapping) {
      throw new Error(
        "This job has no stored row data to fix (it predates AI-assisted line-list processing).",
      );
    }
    const currentIssues = await linelist.issues(jobId);
    const allFixable = currentIssues.filter((i) => i.fixable);
    const autoFixable = allFixable.filter((i) => i.source !== "ai" || i.confidence !== "LOW");
    const needsReview = allFixable.filter((i) => i.source === "ai" && i.confidence === "LOW");
    const needsReviewUnresolved = needsReview.map((i) => ({
      row: i.row,
      column: i.column,
      reason:
        "Low-confidence AI finding — requires human review before an automatic fix is applied.",
    }));

    if (autoFixable.length === 0) {
      // Nothing to actually fix — the data hasn't changed, so there's
      // nothing for a re-validation to usefully re-discover. Re-running it
      // anyway used to just burn a full AI pass for no reason.
      await saveJob({
        ...job,
        lastFixCorrections: [],
        lastFixUnresolved: needsReviewUnresolved,
      });
      return {
        job,
        issues: currentIssues,
        correctionsApplied: 0,
        unresolved: needsReviewUnresolved,
        aiUsed: false,
      };
    }

    const fixRows = (job.rawRows ?? job.parsedRows) as Record<string, string>[];
    const fixResult = await ai.linelist.fix({
      headers: job.columns,
      mapping: job.mapping,
      rows: fixRows,
      issues: autoFixable,
    });
    const combinedUnresolved = [...fixResult.unresolved, ...needsReviewUnresolved];

    let updatedJob: LineListJobRow;
    const corrections = fixResult.ai_used
      ? safeCorrections(fixResult.corrections, autoFixable, job.mapping)
      : [];
    if (corrections.length > 0) {
      const parsedRows = [...job.parsedRows];
      const rawRows = job.rawRows ? [...job.rawRows] : undefined;
      for (const correction of corrections) {
        const idx = correction.row - 1;
        if (idx < 0) continue;
        if (rawRows && idx < rawRows.length && correction.column in rawRows[idx]!) {
          rawRows[idx] = { ...rawRows[idx]!, [correction.column]: correction.new_value };
        }
        const canonicalField = job.mapping[correction.column];
        if (canonicalField && idx < parsedRows.length) {
          parsedRows[idx] = { ...parsedRows[idx], [canonicalField]: correction.new_value };
        }
      }
      updatedJob = {
        ...job,
        parsedRows,
        ...(rawRows ? { rawRows } : {}),
        fixedAt: new Date().toISOString(),
        lastFixCorrections: corrections,
        lastFixUnresolved: combinedUnresolved,
      };
      await saveJob(updatedJob);
      await recordAudit({
        action: "LINELIST_AI_FIX_APPLIED",
        entity: "LineListJob",
        entityId: jobId,
        newValue: `${corrections.length} field(s) corrected, ${combinedUnresolved.length} left unresolved`,
        reason: `Prompt ${fixResult.prompt_version}`,
      });
    } else {
      updatedJob = { ...job, lastFixCorrections: [], lastFixUnresolved: combinedUnresolved };
      await saveJob(updatedJob);
    }

    // Reconcile instead of re-running full AI analysis: drop exactly the
    // issues this pass actually corrected (matched by row+column against
    // the fix response) and keep every other previously-detected issue —
    // AI or rule — untouched. A full fresh AI scan here used to be what
    // made "Fix Issues" both slow (a second complete multi-chunk AI pass
    // stacked on top of the fix call itself) and unpredictable (the count
    // could go up as well as down between runs, since a fresh LLM scan of
    // the whole file is never guaranteed to reproduce its own prior
    // findings — pure model non-determinism, not an actual change in the
    // data). Only the fast, fully deterministic rule engine re-runs here;
    // a complete AI re-scan only ever happens from an explicit "Re-run
    // validation" click.
    const correctedKeys = new Set(corrections.map((c) => `${c.row}:${c.column}`));
    const remainingPriorAiIssues = currentIssues.filter(
      (i) => i.source === "ai" && !correctedKeys.has(`${i.row}:${i.column}`),
    );
    const finalIssues = mergeFindings(
      await computeDeterministicIssues(updatedJob),
      remainingPriorAiIssues,
    );
    const next = await storeIssues(updatedJob, finalIssues, {
      validatedAt: new Date().toISOString(),
    });

    return {
      job: next,
      issues: finalIssues,
      correctionsApplied: corrections.length,
      unresolved: combinedUnresolved,
      aiUsed: fixResult.ai_used,
      aiError: fixResult.error ?? undefined,
    };
  },

  /**
   * Creates a new line-list processing job directly from case data already
   * known to the app (used by the Case workbench's line-list export)
   * rather than from an uploaded file. Starts at UPLOADED stage exactly
   * like a real upload, so it shows up in Processing jobs ready to be
   * validated the same way — column mapping is fixed and known up front
   * since these headers are generated, not parsed from an arbitrary file,
   * so there's no original file to preserve as rawRows.
   */
  createFromCases: async (rows: ParsedRow[], sourceLabel: string): Promise<LineListJob> => {
    const actor = currentActor();
    const columns = [
      "Case ID",
      "Patient Identifier",
      "Product",
      "Reaction",
      "Onset Date",
      "Seriousness",
      "Outcome",
    ];
    const mapping: Record<string, TargetField> = {
      "Case ID": "case_id",
      "Patient Identifier": "patient_identifier",
      Product: "product",
      Reaction: "reaction",
      "Onset Date": "onset_date",
      Seriousness: "seriousness",
      Outcome: "outcome",
    };
    const job: LineListJobRow = {
      id: newId("ll"),
      filename: sourceLabel,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.name,
      rows: rows.length,
      stage: "UPLOADED",
      validCases: 0,
      invalidCases: 0,
      warnings: 0,
      columns,
      mapping,
      parsedRows: rows,
    };
    const { error } = await supabase
      .from("pv_linelist_jobs")
      .insert({ id: job.id, data: toJson(job) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "LINELIST_CREATED_FROM_CASES",
      entity: "LineListJob",
      entityId: job.id,
      newValue: `${sourceLabel} (${rows.length} case(s) exported from the case workbench)`,
    });
    return job;
  },

  /** Rebuilds a CSV from the job's current (possibly AI-corrected) data,
   *  preserving the original column headers and order, and triggers a
   *  browser download. Reads from rawRows when the job has one (a real
   *  upload) so every original column comes back with its real, current
   *  value — including any that were corrected but aren't one of the
   *  canonical fields — rather than the old behaviour of writing blanks
   *  for anything outside the canonical field list. Falls back to the
   *  canonical-field reconstruction only for jobs with no raw parse at
   *  all (createFromCases jobs), which is still correct for those since
   *  they were never built from an arbitrary uploaded file. */
  downloadCsv: async (jobId: string): Promise<void> => {
    const job = await readJob(jobId);
    if (!job.columns || (!job.rawRows && !(job.mapping && job.parsedRows))) {
      throw new Error("This job has no stored row data to export.");
    }
    const { columns } = job;
    // CSV has no cell colour/formatting of its own — there is no such thing
    // as a "highlighted cell" in plain CSV. Two extra columns give the same
    // practical result: filter or sort by "Needs review" in Excel/Sheets to
    // jump straight to every row still carrying an unresolved issue, and
    // "Unresolved column(s)" says exactly which field(s) on that row.
    const issues = await linelist.issues(jobId);
    const issuesByRow = new Map<number, LineListIssue[]>();
    for (const issue of issues) {
      const existing = issuesByRow.get(issue.row);
      if (existing) existing.push(issue);
      else issuesByRow.set(issue.row, [issue]);
    }
    const unresolvedColumnsFor = (rowNumber: number): string => {
      const rowIssues = issuesByRow.get(rowNumber);
      if (!rowIssues || rowIssues.length === 0) return "";
      return [...new Set(rowIssues.map((i) => i.column))].join("; ");
    };
    const needsReviewFor = (rowNumber: number): string => (issuesByRow.has(rowNumber) ? "YES" : "");
    const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const headerRow = [...columns, "Needs review", "Unresolved column(s)"];
    const dataLines = job.rawRows
      ? [
          headerRow.map(escapeCell).join(","),
          ...job.rawRows.map((row, idx) =>
            [
              ...columns.map((header) => escapeCell(row[header] ?? "")),
              escapeCell(needsReviewFor(idx + 1)),
              escapeCell(unresolvedColumnsFor(idx + 1)),
            ].join(","),
          ),
        ]
      : [
          headerRow.map(escapeCell).join(","),
          ...job.parsedRows!.map((row, idx) =>
            [
              ...columns.map((header) => {
                const field = job.mapping![header];
                return escapeCell(field ? (row[field] ?? "") : "");
              }),
              escapeCell(needsReviewFor(idx + 1)),
              escapeCell(unresolvedColumnsFor(idx + 1)),
            ].join(","),
          ),
        ];
    // Preserve sparse rows from the original upload (usually the source
    // form's codebook/legend, but also title or instruction text). They were
    // intentionally excluded from case rows by the parser, yet they are
    // needed when this fixed file is uploaded again so the same codebook can
    // be rediscovered. Keep each line in one escaped CSV cell: on re-upload
    // it remains a sparse, non-case row and is recovered as discardedRows.
    const preservedSourceText = (job.discardedRows ?? [])
      .map((entry) => entry.text.trim())
      .filter(Boolean);
    const lines = preservedSourceText.length
      ? [
          ...dataLines,
          "",
          escapeCell("# ORIGINAL SOURCE TEXT — preserved from uploaded file"),
          ...preservedSourceText.map(escapeCell),
        ]
      : dataLines;
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = job.filename.replace(/\.[^.]+$/, "") + "-fixed.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /**
   * A deterministic, printable summary assembled entirely from data the
   * app already has (the job record and its persisted issues) — not a new
   * AI call, and not free-text AI prose. Every number in it is computed
   * fresh from the same `job`/`issues` the on-screen table shows, so it
   * can never drift from what's displayed, and it always reflects the
   * job's current post-fix state if "Run Full Fix" has been used.
   */
  downloadExecutiveSummary: async (jobId: string): Promise<void> => {
    const job = await readJob(jobId);
    const issues = await linelist.issues(jobId);

    const bySeverity = {
      CRITICAL: issues.filter((i) => i.severity === "CRITICAL").length,
      HIGH: issues.filter((i) => i.severity === "HIGH").length,
      MEDIUM: issues.filter((i) => i.severity === "MEDIUM").length,
      LOW: issues.filter((i) => i.severity === "LOW").length,
    };

    const byCode = new Map<string, LineListIssue[]>();
    for (const issue of issues) {
      const list = byCode.get(issue.code) ?? [];
      list.push(issue);
      byCode.set(issue.code, list);
    }
    const codeGroups = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length);
    const duplicateGroups = issues.filter(
      (i) => i.code === "DUPLICATE_CASE_ID" || i.code === "CASE_ID_FORMAT_INCONSISTENT",
    );

    const lines: string[] = [];
    const rule = "-".repeat(60);
    lines.push("LINE-LIST EXECUTIVE SUMMARY");
    lines.push("=".repeat(60));
    lines.push(`File: ${job.filename}`);
    if (job.sheetName) lines.push(`Sheet: ${job.sheetName}`);
    if (job.headerRowNumber) lines.push(`Header row: ${job.headerRowNumber}`);
    lines.push(
      `Uploaded by: ${job.uploadedBy} on ${job.uploadedAt.slice(0, 16).replace("T", " ")} UTC`,
    );
    if (job.validatedAt) {
      lines.push(`Last validated: ${job.validatedAt.slice(0, 16).replace("T", " ")} UTC`);
    }
    if (job.promptVersion) lines.push(`AI prompt version: ${job.promptVersion}`);
    lines.push("");

    lines.push("TOTALS");
    lines.push(rule);
    lines.push(`Rows scanned: ${job.rows}`);
    lines.push(`Valid rows: ${job.validCases}`);
    lines.push(`Invalid rows: ${job.invalidCases}`);
    lines.push(`  Critical findings: ${bySeverity.CRITICAL}`);
    lines.push(`  High findings: ${bySeverity.HIGH}`);
    lines.push(`  Medium findings: ${bySeverity.MEDIUM}`);
    lines.push(`  Low findings: ${bySeverity.LOW}`);
    lines.push("");

    lines.push("ISSUES BY TYPE");
    lines.push(rule);
    if (codeGroups.length === 0) {
      lines.push("No issues found.");
    }
    for (const [code, group] of codeGroups) {
      lines.push(`${code} — ${group.length} occurrence(s), severity ${group[0]?.severity ?? "?"}`);
      for (const example of group.slice(0, 3)) {
        lines.push(`  ${rowLabel(job, example.row)}, ${example.column}: ${example.message}`);
      }
    }
    lines.push("");

    if (duplicateGroups.length > 0) {
      lines.push("DUPLICATE / ID-FORMAT FLAGS (review — never removed automatically)");
      lines.push(rule);
      for (const d of duplicateGroups) {
        lines.push(`${rowLabel(job, d.row)}, ${d.column}: ${d.message}`);
      }
      lines.push("");
    }

    if (job.lastFixCorrections || job.lastFixUnresolved) {
      lines.push(
        `RUN FULL FIX${job.fixedAt ? ` — last applied ${job.fixedAt.slice(0, 16).replace("T", " ")} UTC` : ""}`,
      );
      lines.push(rule);
      const corrections = job.lastFixCorrections ?? [];
      const unresolved = job.lastFixUnresolved ?? [];
      if (corrections.length === 0 && unresolved.length === 0) {
        lines.push("Fix Issues was run and found nothing it could safely auto-correct.");
      }
      for (const c of corrections) {
        lines.push(
          `CORRECTED — ${rowLabel(job, c.row)}, ${c.column}: "${c.new_value}" (${c.reason})`,
        );
      }
      for (const u of unresolved) {
        lines.push(`UNRESOLVED — ${rowLabel(job, u.row)}, ${u.column}: ${u.reason}`);
      }
      lines.push("");
    }

    const e2bBlockers = issues.filter((i) => i.blocksE2b && i.row > 0);
    const fileBlockers = issues.filter((i) => i.blocksE2b && i.row === 0);
    lines.push("E2B(R3) / VIGIFLOW READINESS");
    lines.push(rule);
    if (e2bCheckIncomplete(issues)) {
      lines.push(
        "Not fully checked: a service needed for the E2B check could not be reached. Re-run validation before relying on this section.",
      );
    }
    for (const f of fileBlockers) {
      lines.push(`WHOLE FILE — ${f.message}`);
    }
    if (e2bBlockers.length === 0 && fileBlockers.length === 0) {
      lines.push("No case in this file has data that would block a validated E2B(R3) export.");
    } else if (e2bBlockers.length > 0) {
      const blockedRows = new Set(e2bBlockers.map((i) => i.row));
      lines.push(
        `${blockedRows.size} case(s) have data that would block a validated E2B(R3) export:`,
      );
      const where: Record<string, string> = {
        FILE: "Correct in the line list",
        OUTCOME_TERMS: "Map the outcome word in Settings → Outcome terms",
        REPORTER_DESIGNATIONS: "Map the reporter in Settings → Reporter qualifications",
        REACTION_TERMS: "Choose the MedDRA term on the line-list page",
        SOURCE_CODEBOOK: "Correct the code or include the form's code legend",
      };
      for (const [fixIn, label] of Object.entries(where)) {
        const group = e2bBlockers.filter((i) => (i.fixIn ?? "FILE") === fixIn);
        if (group.length === 0) continue;
        lines.push("");
        lines.push(`${label}:`);
        for (const i of group) {
          lines.push(`  ${rowLabel(job, i.row)}, ${i.column}: ${i.message}`);
        }
      }
    }
    lines.push("");

    lines.push("RECOMMENDATIONS");
    lines.push(rule);
    // Informational notes (LOW) need no action, so they never drive a
    // recommendation.
    const top3 = codeGroups
      .filter(([, group]) => group[0]?.severity !== "LOW" && group.some((i) => i.row > 0))
      .slice(0, 3);
    if (top3.length === 0) {
      lines.push("No recurring issues detected — no specific recommendation.");
    } else {
      top3.forEach(([code, group], i) => {
        lines.push(
          `${i + 1}. ${group.length} row(s) flagged for ${code.replaceAll("_", " ").toLowerCase()} — review and reinforce reporting guidance for this field.`,
        );
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = job.filename.replace(/\.[^.]+$/, "") + "-executive-summary.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
