import { supabase } from "@/integrations/supabase/client";

/**
 * The same line list uploaded more than once.
 *
 * Each upload is its own job, so an identical second upload put every case
 * in the signal screen, the quality flags and observed vs expected twice —
 * seen live as "8 reports" for a pair that has 4. Uploads are compared by a
 * fingerprint of the table's content (the rows as read, keyed by header):
 * the same table renamed or re-saved is the same content. Only the first
 * upload is counted; the others are repeats of it. Jobs stored before the
 * fingerprint existed get one worked out from their stored rows, so repeats
 * already in an organisation are caught too, without changing them.
 *
 * Different files that share some cases are not repeats — those go through
 * the cross-file duplicate check, where a person decides.
 */

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable.");
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The fingerprint of a table's content: its rows as read, in order, each
 *  row's columns in a fixed (sorted) order — the database stores a row's
 *  keys in its own order, so the key worked out from a stored job must be
 *  the same as the one computed at upload. */
export function contentKeyOf(rawRows: Record<string, string>[]): Promise<string> {
  return sha256Hex(
    JSON.stringify(
      rawRows.map((r) =>
        Object.keys(r)
          .sort()
          .map((k) => [k, r[k] ?? ""]),
      ),
    ),
  );
}

export interface UploadRef {
  id: string;
  filename: string;
  uploadedAt: string;
  stage?: string | undefined;
  contentKey?: string | undefined;
}

/** For each repeat upload, the earlier upload it repeats (the first one with
 *  the same content). Uploads with no content key are never repeats. Pure. */
export function repeatsOf(uploads: UploadRef[]): Map<string, UploadRef> {
  const first = new Map<string, UploadRef>();
  const out = new Map<string, UploadRef>();
  for (const u of [...uploads].sort(
    (a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id),
  )) {
    if (!u.contentKey) continue;
    const original = first.get(u.contentKey);
    if (original) out.set(u.id, original);
    else first.set(u.contentKey, u);
  }
  return out;
}

/** Every line-list upload in the organisation with the fingerprint stored
 *  at upload (absent on jobs uploaded before it existed — those are still
 *  counted once by the case loader, which compares their rows). */
export async function uploadsWithContentKeys(): Promise<UploadRef[]> {
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select(
      "id, filename:data->>filename, uploadedAt:data->>uploadedAt, stage:data->>stage, contentKey:data->>contentKey, kind:data->>kind",
    );
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (UploadRef & { kind?: string | null })[])
    .filter((u) => !u.kind && u.filename && u.uploadedAt)
    .map(({ kind: _k, ...u }) => ({ ...u, contentKey: u.contentKey ?? undefined }));
}

/** The same rows, in the same order: a fingerprint of a job's case rows as
 *  stored (each row's fields sorted). Two jobs with identical rows hold the
 *  same cases, whatever the files were called. */
export function rowsKeyOf(rows: Record<string, unknown>[]): Promise<string> {
  return sha256Hex(
    JSON.stringify(
      rows.map((r) =>
        Object.keys(r)
          .sort()
          .map((k) => [k, r[k] ?? ""]),
      ),
    ),
  );
}

/** For each job, the earlier job it repeats: same upload fingerprint, or —
 *  for jobs stored before the fingerprint — the same case rows. Pure. */
export function repeatsByKeys(
  jobs: { id: string; uploadedAt: string; keys: (string | undefined)[] }[],
): Map<string, string> {
  const first = new Map<string, string>();
  const out = new Map<string, string>();
  for (const j of [...jobs].sort(
    (a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id),
  )) {
    const keys = j.keys.filter((k): k is string => !!k);
    const original = keys.map((k) => first.get(k)).find(Boolean);
    if (original) out.set(j.id, original);
    else for (const k of keys) first.set(k, j.id);
  }
  return out;
}

/** Each repeat upload in the organisation, with the upload it repeats. */
export async function findRepeatUploads(): Promise<Map<string, UploadRef>> {
  return repeatsOf(await uploadsWithContentKeys());
}

/** Before an upload: was this exact file (its bytes) uploaded already? */
export async function findSameLineListFile(file: File): Promise<{
  fileSha256: string;
  match: { id: string; filename: string; uploadedAt: string } | null;
}> {
  const fileSha256 = await sha256Hex(await file.arrayBuffer());
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select("id, filename:data->>filename, uploadedAt:data->>uploadedAt")
    .eq("data->>fileSha256", fileSha256)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as unknown as
    { id: string; filename: string; uploadedAt: string } | undefined;
  return { fileSha256, match: row ?? null };
}
