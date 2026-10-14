import { supabase } from "@/integrations/supabase/client";
import { apiRequest, ApiError } from "./client";
import { toJson } from "./db";

/**
 * Saving a line-list job without overwriting someone else's newer save.
 *
 * A job is one stored record, and every change (a decision, a Fix, an
 * Undo, an E2B export) reads it, changes it and writes it back. Without a
 * check, two people — or two tabs — working on the same line list would
 * each write back their own copy, and the later save would silently undo
 * the earlier one (the per-tab queue only orders saves within one tab).
 *
 * So each job carries a `version`. A save says which version it read; the
 * database applies it only if that is still the stored version, and the
 * version goes up by one, in the same single update. If someone saved in
 * between, nothing is written and StaleJobError is raised: the person
 * reloads and repeats their change on the latest data.
 */
export class StaleJobError extends Error {
  constructor(jobId: string) {
    super(
      "This line list was changed elsewhere (by someone else, or in another tab) after you opened it. " +
        "Nothing was saved — reload the page to see the latest version, then repeat your change.",
    );
    this.name = "StaleJobError";
    void jobId;
  }
}

export async function saveJobVersioned<T extends { id: string; version?: number | undefined }>(
  job: T,
): Promise<T> {
  const expected = job.version;
  const next = { ...job, version: (expected ?? 0) + 1 };
  const base = supabase
    .from("pv_linelist_jobs")
    .update({ data: toJson(next) })
    .eq("id", job.id);
  // A job saved before versions existed has none: its first save must
  // still find it without one.
  const conditional =
    expected === undefined
      ? base.is("data->version", null)
      : base.eq("data->>version", String(expected));
  const { data, error } = await conditional.select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new StaleJobError(job.id);
  // The caller's copy now matches what is stored, so a second save in the
  // same operation is not mistaken for a stale one.
  job.version = next.version;
  return next;
}

/**
 * A save that changes cells (Fix, Undo, Re-apply) goes to the server, which
 * reads the stored job for the caller's organisation, checks the version,
 * re-verifies every changed cell against the change log (rules re-run, AI
 * values derived, moves only rearranging values, Undo returning the recorded
 * value, identifiers untouched) and writes all of it or nothing.
 */
export async function saveJobCells<T extends { id: string; version?: number | undefined }>(
  job: T,
): Promise<T> {
  const { version: expected, ...data } = job;
  let res: { version: number };
  try {
    res = await apiRequest<{ version: number }>(
      `/api/linelist/jobs/${encodeURIComponent(job.id)}/save-cells`,
      { method: "POST", body: { job: toJson(data), expected_version: expected ?? null } },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) throw new StaleJobError(job.id);
    if (err instanceof ApiError && err.status === 422) throw new UnverifiedChangeError(err.detail);
    throw err;
  }
  job.version = res.version;
  return { ...job, version: res.version };
}

/** The server refused a save because a change could not be verified.
 *  Nothing was saved. The reasons name rows and columns, never values. */
export class UnverifiedChangeError extends Error {
  constructor(detail: unknown) {
    const d = (
      detail as {
        detail?: { message?: string; problems?: { row: number; column: string; reason: string }[] };
      }
    )?.detail;
    const problems = d?.problems ?? [];
    super(
      `${d?.message ?? "Nothing was saved: the server could not verify these changes."}${
        problems.length
          ? " " +
            problems
              .slice(0, 3)
              .map((p) => `Row ${p.row}, ${p.column}: ${p.reason}`)
              .join(" ")
          : ""
      }`,
    );
    this.name = "UnverifiedChangeError";
  }
}
