import type { PatientRecordNumberSource, SourceProfile } from "./types";

/**
 * Whose record a patient's number is — D.1.1.1 a GP's, D.1.1.2 a
 * specialist's, D.1.1.3 a hospital's, D.1.1.4 an investigation's.
 *
 * ICH makes the source of the number part of the data element: each has its
 * own namespace OID, so a number cannot be exported without saying which
 * record it came from. This module is the one place that question is
 * answered, because two paths ask it — the line-list checks and the E2B
 * export — and an answer that differed between them would mean the page and
 * the file disagreed about what is being sent.
 */

/**
 * Reads the record source out of the column's own name, and only out of
 * that: never from the values, and never from the rest of the file. A
 * header that names no record source returns nothing, which is the whole
 * point — "Patient ID" says a number is the patient's, not whose record it
 * came from.
 */
export function inferPatientRecordNumberSource(
  header: string,
): PatientRecordNumberSource | undefined {
  const h = header.toLowerCase();
  // Word-bounded: "gp" must be the word, not a fragment of another one.
  if (/\b(gp|general\s*practitioner|family\s*(doctor|physician))\b/.test(h)) return "GP";
  if (/specialist|consultant/.test(h)) return "SPECIALIST";
  if (/hospital|clinic|facility|ward|admission/.test(h)) return "HOSPITAL";
  if (/investigation|study|trial|protocol/.test(h)) return "INVESTIGATION";
  return undefined;
}

export interface PatientRecordNumberDecision {
  /** What a person chose for this line list, if they have. */
  decided?: PatientRecordNumberSource | undefined;
  /** Set when a person has said not to export one at all. */
  declined?: boolean | undefined;
  /** What the source profile says, where an administrator configured it. */
  profile?: PatientRecordNumberSource | undefined;
  /** The file's own header for the patient-id column, if it has one. */
  header?: string | undefined;
}

/**
 * The answer, in the order of who is best placed to give it:
 *
 *   1. a person who said not to export one — which closes the question;
 *   2. a person who chose a record for this line list;
 *   3. the source profile, where an administrator configured the form;
 *   4. the file's own header, where it names a record source.
 *
 * There is no fifth step. Undefined means undecided, and an undecided
 * category exports no record number rather than claiming the number came
 * from a record nobody named.
 */
export function resolvePatientRecordNumberSource(
  decision: PatientRecordNumberDecision,
): PatientRecordNumberSource | undefined {
  if (decision.declined) return undefined;
  return (
    decision.decided ??
    decision.profile ??
    (decision.header ? inferPatientRecordNumberSource(decision.header) : undefined)
  );
}

/** The profile a job's rows are read with, carrying that answer. */
export function withPatientRecordNumberSource(
  profile: SourceProfile,
  job: {
    mapping?: Record<string, string> | undefined;
    parsingOptions?:
      | {
          patientRecordNumberSource?: PatientRecordNumberSource | undefined;
          patientRecordNumberDeclined?: boolean | undefined;
        }
      | undefined;
  },
): SourceProfile {
  const header = Object.entries(job.mapping ?? {}).find(([, f]) => f === "patient_id")?.[0];
  const source = resolvePatientRecordNumberSource({
    decided: job.parsingOptions?.patientRecordNumberSource,
    declined: job.parsingOptions?.patientRecordNumberDeclined,
    profile: profile.patientRecordNumberSource,
    header,
  });
  return source
    ? { ...profile, patientRecordNumberSource: source }
    : // Explicitly cleared: a profile default must not answer over a person
      // who said not to export one.
      { ...profile, patientRecordNumberSource: undefined };
}
