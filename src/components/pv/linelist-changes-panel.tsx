import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section, StatusPill } from "@/components/pv/primitives";
import { describeRow, linelist as linelistApi } from "@/services/api/linelist";
import { panelEntries } from "@/services/api/linelist-change-log";
import type { LineListJob } from "@/types/pv";

const MADE_BY = { ai: "AI", rule: "rule", recovery: "recovery" } as const;

/**
 * Every automatic correction, newest first, with Undo or Re-apply.
 *
 * Undo means "I'm taking this cell over": the old value returns and Fix
 * leaves the cell alone. Re-apply hands it back. Only the newest change to
 * a cell can be reversed; older ones are shown as superseded.
 */
export function LineListChangesPanel({
  job,
  onChanged,
}: {
  job: LineListJob;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const entries = panelEntries(job.changeLog ?? []);
  if (entries.length === 0) return null;

  const act = async (id: string, action: "undo" | "reapply") => {
    setBusy(id);
    try {
      if (action === "undo") await linelistApi.undoChange(job.id, id);
      else await linelistApi.reapplyChange(job.id, id);
      toast.success(
        action === "undo" ? "Change undone — the cell is yours now." : "Change re-applied.",
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update that change.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Changes made"
      description="Every correction Fix applied, with the value it replaced. Undo keeps the original value and stops Fix changing that cell again."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              {["File row", "Case ID", "Column", "Was → Now", "Why", "Made by", ""].map((h) => (
                <th key={h} className="label-caps px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(({ entry, state, superseded, action }) => {
              const where = describeRow(job, entry.row);
              return (
                <tr
                  key={entry.id}
                  className={`border-b border-border last:border-0 ${superseded ? "opacity-50" : ""}`}
                >
                  <td className="mono-num px-3 py-2">{where.fileRow ?? `#${entry.row}`}</td>
                  <td className="mono-num whitespace-nowrap px-3 py-2">{where.caseId ?? "—"}</td>
                  <td className="mono-num px-3 py-2">{entry.column}</td>
                  <td className="px-3 py-2">
                    <span className="text-muted-foreground line-through">
                      {entry.oldValue || "(blank)"}
                    </span>
                    {" → "}
                    <span>{entry.newValue || "(blank)"}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{entry.reason}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={entry.source === "ai" ? "assist" : "neutral"}>
                      {MADE_BY[entry.source]}
                    </StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {superseded ? (
                      <span className="text-xs text-muted-foreground">Superseded</span>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {state === "undone" ? (
                          <StatusPill tone="info">Kept by you</StatusPill>
                        ) : null}
                        {action ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === entry.id}
                            onClick={() => void act(entry.id, action)}
                          >
                            {action === "undo" ? "Undo" : "Re-apply"}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
