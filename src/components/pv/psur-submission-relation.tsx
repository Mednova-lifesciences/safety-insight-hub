import { useRef, useState } from "react";
import { Copy, RefreshCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { psur as psurApi } from "@/services/api/psur";
import { submissionRelation } from "@/services/psur/psur-calendar";
import { OUTCOME_LABELS } from "@/services/psur/screening-checklist";
import type { PsurDocumentSummary } from "@/types/pv";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * On a report's page: "this is a corrected resubmission of …" or "this is
 * the same file as …", with what was decided about the earlier one, so the
 * officer screening it knows what was asked for last time.
 */
export function SubmissionRelationNote({
  doc,
  docs,
}: {
  doc: PsurDocumentSummary;
  docs: PsurDocumentSummary[];
}) {
  const rel = submissionRelation(doc, docs);
  if (!rel) return null;
  const same = rel.kind === "SAME_FILE";
  const Icon = same ? Copy : RefreshCcw;
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-info/40 bg-info-soft px-4 py-3 text-sm"
      data-e2e-relation={rel.kind}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-info" />
      <div className="space-y-1">
        <p className="font-medium">
          {same
            ? `The exact same file as ${rel.earlier.filename}, uploaded ${day(rel.earlier.uploadedAt)}.`
            : `A resubmission of ${rel.earlier.filename} (uploaded ${day(rel.earlier.uploadedAt)}), for the same period${rel.earlier.dlp ? ` — DLP ${rel.earlier.dlp}` : ""}.`}
        </p>
        {rel.screened ? (
          <p className="text-muted-foreground">
            That report was screened on {day(rel.screened.at)}:{" "}
            <span className="text-foreground">{OUTCOME_LABELS[rel.screened.decision]}</span>
            {rel.screened.citedItems.length
              ? ` — items cited: ${rel.screened.citedItems.map((c) => `${c.number} (${c.label})`).join("; ")}.`
              : "."}
            {same ? "" : " Check that this version answers them."}
          </p>
        ) : (
          <p className="text-muted-foreground">That report has not been screened yet.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Before an upload: asks the person to confirm when the exact same file
 * (by its contents, whatever it is called) is already in the organisation.
 * Returns the fingerprint so the upload does not compute it again.
 */
export function useSameFileGuard() {
  const [match, setMatch] = useState<{ filename: string; uploadedAt: string } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  async function check(file: File): Promise<{ proceed: boolean; fileSha256?: string }> {
    let found: Awaited<ReturnType<typeof psurApi.findSameFile>>;
    try {
      found = await psurApi.findSameFile(file);
    } catch {
      // The check is a courtesy: if it cannot run, the upload goes ahead.
      return { proceed: true };
    }
    if (!found.match) return { proceed: true, fileSha256: found.fileSha256 };
    const proceed = await new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setMatch(found.match);
    });
    return { proceed, fileSha256: found.fileSha256 };
  }

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setMatch(null);
  };

  const dialog = (
    <AlertDialog open={!!match} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This file has already been uploaded</AlertDialogTitle>
          <AlertDialogDescription>
            {match
              ? `It is the exact same file as ${match.filename}, uploaded ${day(match.uploadedAt)} — the contents are identical, even if the name is different. A corrected version would be a different file.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Don't upload</AlertDialogCancel>
          <AlertDialogAction onClick={() => close(true)}>Upload it anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { check, dialog };
}
