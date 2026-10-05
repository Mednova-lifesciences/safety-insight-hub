import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/pv/primitives";
import { linelist as linelistApi } from "@/services/api/linelist";
import { DROP_REASON_LABELS, decisionFor } from "@/services/api/linelist-decisions";
import type { DropReason, LineListJob } from "@/types/pv";

/**
 * Keep · Drop… · Step down for one case.
 *
 * The decision applies to the case, so every issue row of that case shows
 * the same control and the same state.
 */
export function LineListDecisionControl({
  job,
  row,
  onChanged,
}: {
  job: LineListJob;
  row: number;
  onChanged: () => void;
}) {
  const current = decisionFor(job.decisions, row);
  const [busy, setBusy] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [reason, setReason] = useState<DropReason | "">("");
  const [note, setNote] = useState("");

  if (row < 1) return <span className="text-xs text-muted-foreground">Whole file</span>;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDrop = async () => {
    if (!reason) return;
    await run(
      () =>
        linelistApi.decideCase(job.id, {
          row,
          decision: "DROP",
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      "Case dropped — it will not be in the XML.",
    );
    setDropOpen(false);
    setReason("");
    setNote("");
  };

  return (
    <div className="flex items-center gap-1.5">
      {current ? (
        <StatusPill tone={current.decision === "DROP" ? "critical" : "warning"}>
          {current.decision === "DROP" ? "Dropped" : "Held"}
        </StatusPill>
      ) : (
        <span className="text-xs text-muted-foreground">Keep</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={busy} aria-label="Decide this case">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {current ? (
            <DropdownMenuItem
              onSelect={() => void run(() => linelistApi.keepCase(job.id, row), "Case returned to Keep.")}
            >
              Keep
            </DropdownMenuItem>
          ) : null}
          {current?.decision !== "DROP" ? (
            <DropdownMenuItem onSelect={() => setDropOpen(true)}>Drop…</DropdownMenuItem>
          ) : null}
          {current?.decision !== "STEP_DOWN" ? (
            <DropdownMenuItem
              onSelect={() =>
                void run(
                  () => linelistApi.decideCase(job.id, { row, decision: "STEP_DOWN" }),
                  "Case held for later — out of the XML and the fixed file until you keep it.",
                )
              }
            >
              Step down
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dropOpen} onOpenChange={setDropOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop this case</DialogTitle>
            <DialogDescription>
              It will not be in the XML. It stays in the fixed line list, marked as dropped, with
              the reason you give.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={(v) => setReason(v as DropReason)}>
            {(Object.keys(DROP_REASON_LABELS) as DropReason[]).map((r) => (
              <div key={r} className="flex items-center gap-2">
                <RadioGroupItem value={r} id={`drop-${row}-${r}`} />
                <Label htmlFor={`drop-${row}-${r}`}>{DROP_REASON_LABELS[r]}</Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor={`drop-note-${row}`}>
              Note{reason === "OTHER" ? " (required)" : " (optional)"}
            </Label>
            <Textarea
              id={`drop-note-${row}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === "DUPLICATE" ? "e.g. duplicate of file row 14" : ""}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !reason || (reason === "OTHER" && !note.trim())}
              onClick={() => void confirmDrop()}
            >
              Drop case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
