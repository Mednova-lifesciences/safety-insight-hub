import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Section, StatusPill } from "@/components/pv/primitives";
import { linelist as linelistApi } from "@/services/api/linelist";
import {
  codeListFieldsFor,
  codeListFileToText,
  fileOwnCodes,
  type CodeListPreview,
} from "@/services/api/linelist-code-list";
import type { LineListCodeListEntry, LineListJob } from "@/types/pv";

/**
 * The code list (codebook) for a coded line list. Shows the one the file
 * carries, if any; lets a person type, paste or upload one in their own
 * wording; reads it (rules first, the AI for what they cannot place);
 * shows every problem; and applies nothing until the person confirms.
 * Optionally saved for every later file with the same columns.
 */
/** The stored job as the page receives it: the job list returns the whole
 *  record, including the text the parser kept outside the case table. */
type JobWithLegend = LineListJob & { discardedRows?: { row: number; text: string }[] };

export function CodeListPanel({ job, onSaved }: { job: JobWithLegend; onSaved: () => void }) {
  const fields = useMemo(() => codeListFieldsFor(job.mapping), [job.mapping]);
  const label = (key: string) => fields.find((f) => f.name === key)?.label ?? key;
  const inFile = useMemo(() => fileOwnCodes(job.discardedRows), [job.discardedRows]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(job.codeList?.origin === "PERSON" ? job.codeList.text : "");
  const [preview, setPreview] = useState<CodeListPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveForForm, setSaveForForm] = useState(true);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      setText(await codeListFileToText(file));
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function read() {
    setReading(true);
    try {
      setPreview(await linelistApi.previewCodeList(job.id, text));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the code list.");
    } finally {
      setReading(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setSaving(true);
    try {
      const entries: LineListCodeListEntry[] = preview.entries.map(
        ({ field, sourceCode, meaning }) => ({
          field,
          sourceCode,
          meaning,
        }),
      );
      await linelistApi.setCodeList(job.id, { entries, text, saveForForm });
      toast.success(
        `Code list applied${saveForForm ? " and saved for files from this form" : ""}. This line list has been rechecked.`,
      );
      setEditing(false);
      setPreview(null);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the code list.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(alsoForForm: boolean) {
    setSaving(true);
    try {
      await linelistApi.clearCodeList(job.id, alsoForForm);
      toast.success(
        alsoForForm
          ? "Code list removed from this file and no longer saved for this form."
          : "Code list removed from this file.",
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the code list.");
    } finally {
      setSaving(false);
    }
  }

  const summary = (entries: LineListCodeListEntry[]) =>
    [...new Set(entries.map((e) => e.field))]
      .map((f) => `${label(f)} (${entries.filter((e) => e.field === f).length})`)
      .join(", ");
  const blocking = !!preview && (preview.conflicts.length > 0 || preview.entries.length === 0);

  return (
    <Section
      id="code-list"
      title="Code list"
      description="What the codes in this file mean (1 = Male, 2 = Female, …). Used by the line-list checks, E2B preflight and export."
    >
      <div className="space-y-3 text-sm">
        {job.codeList ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="flex flex-wrap items-center gap-2">
              <BookOpen className="size-4" />
              <span className="font-medium">
                {job.codeList.origin === "FORM"
                  ? "Using the code list saved for this form"
                  : "Using a code list added for this file"}
              </span>
              <StatusPill tone="success">{job.codeList.entries.length} codes</StatusPill>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary(job.codeList.entries)} · by {job.codeList.by} on{" "}
              {new Date(job.codeList.at).toLocaleDateString()}
              {job.codeList.origin === "FORM" && inFile.length > 0
                ? " · this file brings its own codes for some fields, and those are used instead"
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setEditing(true)}
              >
                Change
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => remove(false)}>
                Remove from this file
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => remove(true)}>
                Remove and stop using it for this form
              </Button>
            </div>
          </div>
        ) : inFile.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            This file carries its own code list: {summary(inFile)}. Add one only if a coded column
            is missing from it or you need to correct it.
          </p>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              No code list was found in this file. If its columns hold codes (1, 2, 3…), add the
              code list so they can be read — they are never guessed.
            </span>
          </div>
        )}

        {!editing ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            {job.codeList || inFile.length > 0
              ? "Add or replace the code list"
              : "Add the code list"}
          </Button>
        ) : (
          <div className="space-y-2">
            <Textarea
              rows={8}
              aria-label="Code list"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
              placeholder={
                "Write it the way the form does, for example:\n\nReaction type: 1=Fever, 2=Rash, 3=Swelling\nOutcome\n1. Recovered\n2. Hospitalised\nSex: 1 = Male, 2 = Female"
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                <Upload className="size-3.5" /> Upload .txt, .csv or .xlsx
                <input
                  type="file"
                  className="sr-only"
                  accept=".txt,.csv,.xlsx"
                  onChange={(e) => {
                    void loadFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <Button size="sm" disabled={!text.trim() || reading} onClick={read}>
                {reading ? "Reading…" : "Read the code list"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (setEditing(false), setPreview(null))}
              >
                Cancel
              </Button>
            </div>

            {preview ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="font-medium">
                  Check what was read before using it ({preview.entries.length} codes)
                </p>
                {preview.aiError ? <p className="text-xs text-warning">{preview.aiError}</p> : null}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1">Field</th>
                      <th>Code</th>
                      <th>Meaning</th>
                      <th>Read by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.map((e, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1">{label(e.field)}</td>
                        <td className="mono-num">{e.sourceCode}</td>
                        <td>{e.meaning}</td>
                        <td>
                          {e.readBy === "ai" ? (
                            <StatusPill tone="assist" icon={<Sparkles className="size-3" />}>
                              AI — check it
                            </StatusPill>
                          ) : (
                            "rule"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.conflicts.map((c) => (
                  <p key={`${c.field}-${c.sourceCode}`} className="text-xs text-critical">
                    {label(c.field)} code {c.sourceCode} is given more than one meaning (
                    {c.meanings.join(" / ")}). Correct the text so it has one, then read it again.
                  </p>
                ))}
                {preview.uncovered.map((u) => (
                  <p key={u.field} className="text-xs text-warning">
                    {label(u.field)}: the file also uses code(s) {u.codes.join(", ")}, which this
                    list does not define. Those cells stay unread.
                  </p>
                ))}
                {preview.differsFromFile.map((d) => (
                  <p key={`${d.field}-${d.sourceCode}`} className="text-xs text-warning">
                    {label(d.field)} code {d.sourceCode}: the file says &ldquo;{d.inFile}&rdquo;,
                    this list says &ldquo;{d.inList}&rdquo;. Once confirmed, this list is used for
                    this file.
                  </p>
                ))}
                {preview.unplaced.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Not used — could not tell which column these belong to:{" "}
                    {preview.unplaced.join(" · ")}. Put the column name above them and read again.
                  </p>
                ) : null}
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={saveForForm}
                    onChange={(e) => setSaveForForm(e.target.checked)}
                  />
                  <span>
                    Also use it for later files from this form (files with the same columns). A file
                    that brings its own code list still uses its own.
                  </span>
                </label>
                <Button size="sm" disabled={blocking || saving} onClick={confirm}>
                  {saving ? "Applying and rechecking…" : "Use this code list"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Section>
  );
}
