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

/* ------------------------------------------------------------------ *
 * Versions of the same line list
 * ------------------------------------------------------------------ */

/** What identifies a case for telling versions apart: its case ID, or — when
 *  a file has none (or only a serial number) — its product, vaccination
 *  date, sex and age together. */
export interface VersionCase {
  caseId?: string | undefined;
  product?: string | undefined;
  vaccinationDate?: string | undefined;
  sex?: string | undefined;
  age?: string | undefined;
}

const norm = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** A case's identity: its case ID (not a bare serial number), and its
 *  product + vaccination date + sex + age, when it carries them. */
export function caseIdentity(c: VersionCase): { id?: string; details?: string } {
  const out: { id?: string; details?: string } = {};
  const id = norm(c.caseId);
  // A bare serial number (1, 2, 3 …) is not an identity: two different
  // files both number their rows.
  if (id && !/^\d{1,4}$/.test(id)) out.id = id;
  const product = norm(c.product);
  const date = norm(c.vaccinationDate);
  const sex = norm(c.sex);
  const age = norm(c.age);
  if (product && date && (sex || age)) out.details = `${product}|${date}|${sex}|${age}`;
  return out;
}

/** Share of the line lists' cases that must be the same cases, in both, for
 *  one to be a version of the other. */
export const VERSION_OVERLAP = 0.8;
/** Smaller files are never treated as versions of each other. */
const VERSION_MIN_CASES = 3;

/**
 * For each line list that is an older version of another, the newest
 * version, which is the one counted. Two line lists are versions of each
 * other when at least 80% of the cases in each are the same cases (the same
 * case ID; product + vaccination date + sex + age only where a case has no
 * ID) — a corrected or extended
 * re-issue of the same list. A different list that shares a few cases (an
 * LGA return repeating some state cases) stays separate; its shared cases
 * are left to the duplicates check. Pure.
 */
export function olderVersionsOf(
  jobs: { id: string; uploadedAt: string; cases: VersionCase[] }[],
): Map<string, string> {
  const prepared = jobs.map((j) => {
    const perCase = j.cases.map(caseIdentity);
    return {
      ...j,
      perCase,
      ids: new Set(perCase.flatMap((c) => (c.id ? [c.id] : []))),
      details: new Set(perCase.flatMap((c) => (c.details ? [c.details] : []))),
      detailsWithoutId: new Set(perCase.flatMap((c) => (!c.id && c.details ? [c.details] : []))),
      identifiable: perCase.some((c) => c.id || c.details),
    };
  });
  // Is a case of one list also in the other? Two case IDs decide on their
  // own — different IDs are different cases (the duplicates check, and a
  // person, judge look-alikes). The details are used only where one side
  // has no case ID.
  const matched = (a: (typeof prepared)[number], b: (typeof prepared)[number]) =>
    a.perCase.filter((c) =>
      c.id
        ? b.ids.has(c.id) || (!!c.details && b.detailsWithoutId.has(c.details))
        : !!c.details && b.details.has(c.details),
    ).length / a.perCase.length;
  // Group the versions (a chain of corrections is one group).
  const parent = new Map(prepared.map((j) => [j.id, j.id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (let i = 0; i < prepared.length; i++) {
    const a = prepared[i]!;
    if (a.perCase.length < VERSION_MIN_CASES || !a.identifiable) continue;
    for (let j = i + 1; j < prepared.length; j++) {
      const b = prepared[j]!;
      if (b.perCase.length < VERSION_MIN_CASES || !b.identifiable) continue;
      const small = Math.min(a.perCase.length, b.perCase.length);
      const large = Math.max(a.perCase.length, b.perCase.length);
      if (small / large < VERSION_OVERLAP) continue;
      if (matched(a, b) >= VERSION_OVERLAP && matched(b, a) >= VERSION_OVERLAP) {
        parent.set(find(a.id), find(b.id));
      }
    }
  }
  const newest = new Map<string, (typeof prepared)[number]>();
  for (const j of prepared) {
    const g = find(j.id);
    const cur = newest.get(g);
    if (
      !cur ||
      j.uploadedAt.localeCompare(cur.uploadedAt) > 0 ||
      (j.uploadedAt === cur.uploadedAt && j.id > cur.id)
    ) {
      newest.set(g, j);
    }
  }
  const out = new Map<string, string>();
  for (const j of prepared) {
    const n = newest.get(find(j.id))!;
    if (n.id !== j.id) out.set(j.id, n.id);
  }
  return out;
}
