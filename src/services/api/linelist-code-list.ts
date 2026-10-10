import { supabase } from "@/integrations/supabase/client";
import type { LineListCodeList, LineListCodeListEntry } from "@/types/pv";
import { isFixedFileAnnotationColumn } from "./linelist-fixed-csv";
import { toJson } from "./db";
import { ai } from "./ai";
import {
  codebookKeyForField,
  fieldForCodebookKey,
  findCodeListConflicts,
  readCodeListText,
} from "@/services/e2b-r3/source-profiles/code-list-text";
import { parseDiscoveredLegend } from "@/services/e2b-r3/source-profiles/legend-parser";

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

/** The fields a code list can cover, in plain words — shown on the page and
 *  given to the AI as the only field names it may use. Any other mapped
 *  column is added per file (codeListFieldsFor). */
export const CODE_LIST_FIELDS: { name: string; label: string; description: string }[] = [
  { name: "reaction", label: "Reaction", description: "the reaction / adverse event type code" },
  { name: "outcome", label: "Outcome", description: "how the reaction ended" },
  {
    name: "seriousness",
    label: "Serious criterion",
    description:
      "which serious criterion applies (life-threatening, hospitalisation, death, disability, congenital anomaly)",
  },
  {
    name: "seriousness_aggregate",
    label: "Serious or not",
    description: "whether the case is serious or non-serious",
  },
  { name: "sex", label: "Sex", description: "patient sex" },
  { name: "age_unit", label: "Age unit", description: "the unit an age is given in" },
  { name: "age_group", label: "Age group", description: "the patient's age group" },
  { name: "route", label: "Route", description: "route of administration" },
  { name: "dose_unit", label: "Dose unit", description: "the unit of the dose" },
  {
    name: "reporter_designation",
    label: "Reporter designation",
    description: "the reporter's role or cadre",
  },
  { name: "product", label: "Vaccine / product", description: "the suspect vaccine or product" },
];

export function codeListFieldsFor(mapping: Record<string, string> | undefined) {
  const known = new Set(CODE_LIST_FIELDS.map((f) => f.name));
  const extra = [...new Set(Object.values(mapping ?? {}).map(codebookKeyForField))]
    .filter((k) => !known.has(k))
    .map((k) => ({ name: k, label: k.replace(/_/g, " "), description: `the "${k}" column` }));
  return [...CODE_LIST_FIELDS, ...extra];
}

export interface CodeListPreviewRow extends LineListCodeListEntry {
  readBy: "rule" | "ai";
}

export interface CodeListPreview {
  entries: CodeListPreviewRow[];
  /** One code given more than one meaning under a field. */
  conflicts: { field: string; sourceCode: string; meanings: string[] }[];
  /** Codes that occur in this file under a covered field but that the list
   *  does not define — those cells stay unread. */
  uncovered: { field: string; codes: string[] }[];
  /** Where the list and the file's own legend disagree; the list wins for
   *  this file once confirmed. */
  differsFromFile: { field: string; sourceCode: string; inFile: string; inList: string }[];
  unplaced: string[];
  aiUsed: boolean;
  aiError?: string | undefined;
}

/**
 * What the page shows before a person confirms: rules first, the AI only
 * for what the rules could not place, then every problem worth a look.
 * Nothing is saved here.
 */
export async function previewCodeList(
  job: {
    mapping?: Record<string, string> | undefined;
    parsedRows?: Record<string, string | undefined>[] | undefined;
    discardedRows?: { row: number; text: string }[] | undefined;
  },
  text: string,
): Promise<CodeListPreview> {
  const columns = Object.entries(job.mapping ?? {}).map(([header, field]) => ({ header, field }));
  const rules = readCodeListText(text, columns);
  let aiRows: CodeListPreviewRow[] = [];
  let unplaced = rules.unplaced;
  let aiUsed = false;
  let aiError: string | undefined;
  if (rules.unplaced.length > 0) {
    try {
      const res = await ai.linelist.readCodeList({
        text: rules.unplaced.join("\n"),
        columns,
        fields: codeListFieldsFor(job.mapping).map(({ name, description }) => ({
          name,
          description,
        })),
      });
      aiUsed = res.ai_used;
      aiError = res.error ?? undefined;
      if (res.ai_used) {
        aiRows = res.entries.map((e) => ({
          field: e.field,
          sourceCode: e.code,
          meaning: e.meaning,
          readBy: "ai",
        }));
        unplaced = res.unplaced;
      }
    } catch (err) {
      aiError = err instanceof Error ? err.message : "AI reading was unavailable.";
    }
  }
  const all: CodeListPreviewRow[] = [
    ...rules.entries.map((e) => ({ ...e, readBy: "rule" as const })),
    ...aiRows,
  ];
  const { conflicts } = findCodeListConflicts(all);
  // Keep one row per (field, code, meaning); conflicting rows all stay so
  // the person sees both meanings.
  const seen = new Set<string>();
  const entries = all.filter((e) => {
    const k = `${e.field}\u0000${e.sourceCode.toUpperCase()}\u0000${e.meaning}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const uncovered: CodeListPreview["uncovered"] = [];
  for (const key of new Set(entries.map((e) => e.field))) {
    const field = fieldForCodebookKey(key === "reaction" ? "reaction" : key);
    const defined = new Set(
      entries.filter((e) => e.field === key).map((e) => e.sourceCode.toUpperCase()),
    );
    const used = new Set<string>();
    for (const row of job.parsedRows ?? []) {
      const cell = (
        key === "reaction" ? (row["reaction_code"] ?? row["reaction"]) : row[field]
      )?.trim();
      if (!cell) continue;
      for (const part of cell.split(/[,;]/).map((p) => p.trim().toUpperCase())) {
        if (/^\d{1,3}$/.test(part) && !defined.has(part)) used.add(part);
      }
    }
    if (used.size)
      uncovered.push({ field: key, codes: [...used].sort((a, b) => Number(a) - Number(b)) });
  }

  const legend = parseDiscoveredLegend({
    sourceId: "preview",
    lines: (job.discardedRows ?? []).map((d) => ({ text: d.text, row: d.row })),
  });
  const differsFromFile: CodeListPreview["differsFromFile"] = [];
  for (const l of legend.entries) {
    const mine = entries.find(
      (e) => e.field === l.field && e.sourceCode.toUpperCase() === l.sourceCode.toUpperCase(),
    );
    if (mine && mine.meaning.trim().toLowerCase() !== l.meaning.trim().toLowerCase()) {
      differsFromFile.push({
        field: l.field,
        sourceCode: l.sourceCode,
        inFile: l.meaning,
        inList: mine.meaning,
      });
    }
  }

  return { entries, conflicts, uncovered, differsFromFile, unplaced, aiUsed, aiError };
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
