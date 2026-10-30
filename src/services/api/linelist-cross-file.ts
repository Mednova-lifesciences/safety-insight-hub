import { supabase } from "@/integrations/supabase/client";
import { fromDataFields, selectDataFields } from "./db";
import { isExcluded } from "./linelist-decisions";
import { readRowsWithSeriousness, ROW_READING_FIELDS, type ParsedRow } from "./linelist";
import { regulatoryConfig } from "./regulatory-config";
import type { CrossFileCase } from "./linelist-cross-duplicates";
import type { ClusterCase } from "./linelist-clusters";
import type { LineListDecision, LineListJob } from "@/types/pv";

/**
 * The cases of every VALIDATED or E2B-generated line list in the user's
 * organisation, for the cross-file checks (possible duplicates, batch and
 * facility flags, the signal screen).
 *
 * Its own query, run only when one of those panels is open: the job list
 * stays light (no rows), and this reads only the fields the checks use.
 * Row-level security limits it to the caller's organisation — the same
 * policy every other line-list read goes through.
 *
 * Dropped and held cases are left out: they are already out of the counts
 * and the XML, and a confirmed duplicate is a dropped case.
 */

export interface LoadedCase extends CrossFileCase, ClusterCase {
  /** The reaction cell split by the file's own separators (signal screen). */
  reactions: string[];
}

export interface LoadedJob {
  id: string;
  filename: string;
  stage: LineListJob["stage"];
  cases: LoadedCase[];
  notDuplicatePairs: string[];
}

const FIELDS = [
  "id",
  "stage",
  "parsedRows",
  "decisions",
  "notDuplicatePairs",
  ...ROW_READING_FIELDS,
] as const;

function toCase(
  jobId: string,
  filename: string,
  index: number,
  row: ParsedRow,
  serious: boolean,
  reactions: string[],
): LoadedCase {
  return {
    jobId,
    filename,
    row: index + 1,
    caseId: row.case_id,
    product: row.product,
    vaccinationDate: row.vaccination_date,
    sex: row.sex,
    age: row.age,
    ageUnit: row.age_unit,
    patientIdentifier: row.patient_identifier,
    batch: row.vaccine_batch,
    reaction: row.reaction,
    onsetDate: row.onset_date,
    facility: row.reporter_organization,
    serious,
    reactions,
  };
}

const LOAD_TIMEOUT_MS = 20_000;

/**
 * The whole read, bounded. The request's own abort signal covers the
 * network, but not what supabase-js does before it (reading the session
 * under a browser lock); a hang there left the panels loading for good in
 * about one production run in six. This limit covers every step, so a
 * stuck read fails and is retried (useValidatedCases) instead.
 */
export function loadValidatedCases(): Promise<LoadedJob[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    readValidatedCases(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Reading the validated line lists took too long.")),
        LOAD_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function readValidatedCases(): Promise<LoadedJob[]> {
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select(selectDataFields(FIELDS))
    .in("data->>stage", ["VALIDATED", "E2B_GENERATED"])
    // A request lost on a poor connection would otherwise never settle and
    // leave the panel loading for good; it fails after 30 s and is retried.
    .abortSignal(AbortSignal.timeout(LOAD_TIMEOUT_MS));
  if (error) throw new Error(error.message);
  let orgConfig = null;
  try {
    // Same rule: a config read that never comes back is treated as none.
    orgConfig = await Promise.race([
      regulatoryConfig.get(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOAD_TIMEOUT_MS / 2)),
    ]);
  } catch {
    orgConfig = null;
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const job = fromDataFields<
      Parameters<typeof readRowsWithSeriousness>[0] & {
        id: string;
        stage: LineListJob["stage"];
        decisions?: LineListDecision[];
        notDuplicatePairs?: { key: string }[];
      }
    >(r);
    const rows = readRowsWithSeriousness(job, orgConfig);
    return {
      id: job.id,
      filename: job.filename,
      stage: job.stage,
      cases: rows
        .map(({ row, serious, reactions }, i) =>
          toCase(job.id, job.filename, i, row, serious, reactions),
        )
        .filter((c) => !isExcluded(job.decisions, c.row)),
      notDuplicatePairs: (job.notDuplicatePairs ?? []).map((p) => p.key),
    };
  });
}
