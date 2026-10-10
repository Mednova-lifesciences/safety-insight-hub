import { supabase } from "@/integrations/supabase/client";
import type { LineListCodeList, LineListCodeListEntry } from "@/types/pv";
import { isFixedFileAnnotationColumn } from "./linelist-fixed-csv";
import { toJson } from "./db";

/**
 * Code lists a person supplies for a line list, and the ones saved for a
 * form so later files from it are decoded without asking again.
 *
 * "A form" is a column layout: files whose (non-empty, non-annotation)
 * column headers are the same, read with the same source profile. A source
 * profile alone is too coarse — the generic profile covers every state's
 * form, and one state's codes must not decode another's.
 *
 * Saved form lists live in pv_linelist_jobs as rows of their own
 * (`data.kind = "FORM_CODE_LIST"`), so they inherit that table's per-
 * organization isolation with no schema change. Every listing of jobs
 * excludes them (see isFormCodeListRow).
 */

export const FORM_CODE_LIST_KIND = "FORM_CODE_LIST";

export interface FormCodeListRow {
  kind: typeof FORM_CODE_LIST_KIND;
  id: string;
  formKey: string;
  /** The headers that make up the form, for showing what it applies to. */
  columns: string[];
  entries: LineListCodeListEntry[];
  text: string;
  by: string;
  at: string;
  /** Present so a code that sorts job rows by upload time never breaks. */
  uploadedAt: string;
}

export function isFormCodeListRow(data: unknown): boolean {
  return (
    !!data && typeof data === "object" && (data as { kind?: unknown }).kind === FORM_CODE_LIST_KIND
  );
}

/** The headers that identify a form: non-empty, not one of this tool's own
 *  annotation columns, letters only, sorted. */
export function formColumns(headers: string[]): string[] {
  return [
    ...new Set(
      headers
        .filter((h) => h.trim() && !isFixedFileAnnotationColumn(h))
        .map((h) => h.toLowerCase().replace(/[^a-z]/g, ""))
        .filter(Boolean),
    ),
  ].sort();
}

/** FNV-1a — short, stable, dependency-free. Not security-relevant. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function formKeyFor(sourceProfileId: string, headers: string[]): string {
  return `${sourceProfileId}:${hash(formColumns(headers).join("|"))}`;
}

export function formCodeListId(formKey: string): string {
  return `codelist-${formKey.replace(/[^a-z0-9-]/gi, "-")}`;
}

/** What the fixed file prints at the bottom, so a re-upload carries the
 *  code list with it — written in the one-line-per-field layout the
 *  upload parser already reads. */
export function codeListFooterLines(codeList: LineListCodeList | undefined): string[] {
  if (!codeList || codeList.entries.length === 0) return [];
  const byField = new Map<string, LineListCodeListEntry[]>();
  for (const e of codeList.entries) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);
  const label: Record<string, string> = {
    reaction: "REACTION TYPE",
    outcome: "OUTCOME",
    seriousness: "SERIOUS CASE (criterion)",
    seriousness_aggregate: "TYPE OF AEFI (serious or not)",
  };
  const lines = [
    `CODE LIST — ${codeList.origin === "FORM" ? "saved for this form" : "added for this file"} by ${codeList.by} on ${codeList.at.slice(0, 10)}`,
  ];
  let n = 1;
  for (const [field, entries] of byField) {
    const name = label[field] ?? field.replace(/_/g, " ").toUpperCase();
    lines.push(`${n++}) ${name}: ${entries.map((e) => `${e.sourceCode}=${e.meaning}`).join(", ")}`);
  }
  return lines;
}

export async function readFormCodeList(formKey: string): Promise<FormCodeListRow | null> {
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select("data")
    .eq("id", formCodeListId(formKey))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data && isFormCodeListRow(data.data) ? (data.data as unknown as FormCodeListRow) : null;
}

export async function saveFormCodeList(
  row: Omit<FormCodeListRow, "kind" | "id" | "uploadedAt">,
): Promise<FormCodeListRow> {
  const full: FormCodeListRow = {
    kind: FORM_CODE_LIST_KIND,
    id: formCodeListId(row.formKey),
    uploadedAt: row.at,
    ...row,
  };
  const { error } = await supabase
    .from("pv_linelist_jobs")
    .upsert({ id: full.id, data: toJson(full) }, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return full;
}

export async function deleteFormCodeList(formKey: string): Promise<void> {
  const { error } = await supabase
    .from("pv_linelist_jobs")
    .delete()
    .eq("id", formCodeListId(formKey));
  if (error) throw new Error(error.message);
}
