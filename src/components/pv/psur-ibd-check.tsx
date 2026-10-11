import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePvQuery } from "@/lib/data-source";
import { psur as psurApi } from "@/services/api/psur";
import { ibdRegister } from "@/services/api/psur-ibd";
import {
  checkDlpAgainstIbd,
  compareIbd,
  readDocumentDate,
  showDate,
} from "@/services/psur/ibd-register";
import type { PsurDocument } from "@/types/pv";

/**
 * Under the IBD, wherever it is shown (screening Section A; V4 Section 1):
 * how the PSUR's stated IBD compares with the organisation's register, the
 * option to use the registered one, and whether the DLP fits the IBD's
 * cycle. Shared by the Review Officer's, Evaluator's and Peer Reviewer's
 * pages so they all say the same thing.
 */
export function IbdCheck({
  doc,
  details,
  dlp,
  canApply,
  onApplied,
}: {
  doc: PsurDocument;
  /** The values on screen now, edits included. */
  details: { productName: string; activeSubstance: string; nafdacRegNo: string; ibd: string };
  dlp: string;
  /** False once the page is locked (signed off / decided). */
  canApply: boolean;
  /** The page puts the new IBD into its own field, so a later save keeps it. */
  onApplied: (shownIbd: string) => void;
}) {
  const register = usePvQuery(
    ["psur", "ibd-register"],
    () => ibdRegister.list(),
    () => [],
  );
  const [busy, setBusy] = useState(false);
  const entries = register.data?.data ?? [];
  if (register.isLoading) return null;
  const c = compareIbd(entries, details);

  async function useRegistered() {
    if (c.status === "NOT_IN_REGISTER") return;
    setBusy(true);
    try {
      await psurApi.useRegisteredIbd(doc.id, c.match.entry);
      onApplied(showDate(c.match.entry.ibd));
      toast.success(
        `The registered IBD (${showDate(c.match.entry.ibd)}) is now used for this report.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the IBD.");
    } finally {
      setBusy(false);
    }
  }

  async function addToRegister() {
    if (c.status !== "NOT_IN_REGISTER" || !c.stated) return;
    setBusy(true);
    try {
      await ibdRegister.save({
        activeSubstance: details.activeSubstance || details.productName,
        ibd: c.stated,
        productNames: details.productName ? [details.productName] : [],
        nafdacRegNos: details.nafdacRegNo ? [details.nafdacRegNo] : [],
        source: `As stated in the PSUR (${doc.filename})`,
      });
      await register.refetch();
      toast.success("Added to the IBD register. Check the source in Settings → Product IBDs.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to the register.");
    } finally {
      setBusy(false);
    }
  }

  const decision = doc.ibdDecision;
  const ibdForDlp =
    c.status === "NOT_IN_REGISTER" ? c.stated : (c.registered ?? readDocumentDate(details.ibd));
  const dlpCheck = ibdForDlp ? checkDlpAgainstIbd(ibdForDlp, dlp) : null;
  const where =
    c.status === "NOT_IN_REGISTER"
      ? ""
      : ` (matched on ${c.match.matchedOn}; source: ${c.match.entry.source || "not stated"})`;

  return (
    <div className="space-y-1 text-xs" aria-live="polite">
      {c.status === "ALIGNS" ? (
        <p className="flex items-start gap-1.5 text-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>Aligns with the registered IBD{where}.</span>
        </p>
      ) : c.status === "NOT_IN_REGISTER" ? (
        <p className="flex flex-wrap items-start gap-1.5 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>This product is not in the IBD register, so this IBD cannot be checked.</span>
          {c.stated && canApply ? (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 text-xs"
              disabled={busy}
              onClick={addToRegister}
            >
              Add it to the register
            </Button>
          ) : null}
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-1.5 text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {c.status === "DIFFERS"
              ? `The PSUR states ${showDate(c.stated)}; the registered IBD is ${showDate(c.registered)}${where}.`
              : c.status === "NOT_STATED"
                ? `Not stated in the PSUR. The registered IBD is ${showDate(c.registered)}${where}.`
                : `"${c.statedText}" could not be read as a date. The registered IBD is ${showDate(c.registered)}${where}.`}
          </span>
          {canApply ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={busy}
              onClick={useRegistered}
            >
              Use the registered IBD
            </Button>
          ) : null}
        </div>
      )}
      {decision ? (
        <p className="text-muted-foreground">
          As stated in the PSUR: {decision.statedInPsur || "not stated"} · replaced with the
          registered IBD by {decision.by} on {new Date(decision.at).toLocaleDateString()}. A wrongly
          stated IBD may mean the interval was counted from the wrong date — consider it under
          screening item 5.
        </p>
      ) : null}
      {dlpCheck ? (
        <p className={dlpCheck.aligned ? "text-muted-foreground" : "text-warning"}>
          {dlpCheck.aligned
            ? `The Data Lock Point fits the IBD's cycle (${dlpCheck.expected.join(" or ")}).`
            : `The Data Lock Point (${dlp}) does not fall on the IBD's cycle — expected around ${dlpCheck.expected.join(" or ")}. For information; the assessor decides what it means.`}
        </p>
      ) : null}
    </div>
  );
}
