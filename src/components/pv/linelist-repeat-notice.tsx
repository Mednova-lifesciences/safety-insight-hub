import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { findRepeatUploads, type UploadRef } from "@/services/api/linelist-repeats";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Each repeat upload in the organisation, with the earlier upload it
 *  repeats. `refreshKey` changes when the job list does. */
export function useRepeatUploads(refreshKey = "") {
  return useQuery({
    queryKey: ["linelist", "repeats", refreshKey],
    queryFn: findRepeatUploads,
    staleTime: 60_000,
  });
}

/**
 * Said on a line list that repeats an earlier identical upload: its cases
 * are counted once, from the earlier upload, and — on E2B — it is not
 * exported, so the same cases are never sent to VigiFlow twice.
 */
export function RepeatUploadNotice({
  of,
  context,
}: {
  of: UploadRef | undefined;
  context: "line-list" | "e2b";
}) {
  if (!of) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
      data-e2e-repeat-of={of.id}
    >
      <Copy className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="space-y-1">
        <p className="font-medium">
          A repeat upload: this line list is identical to {of.filename}, uploaded{" "}
          {day(of.uploadedAt)}.
        </p>
        <p className="text-muted-foreground">
          {context === "e2b"
            ? "Its cases are already in that upload, so it is not exported — exporting both would send the same cases to VigiFlow twice. Export the earlier upload."
            : "Its cases are counted once — signals, batch flags and observed vs expected use the earlier upload, and the duplicates check does not pair the two. Work on the earlier upload; this copy can be left as it is."}
        </p>
      </div>
    </div>
  );
}
