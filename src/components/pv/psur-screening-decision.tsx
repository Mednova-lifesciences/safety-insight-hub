import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { psur as psurApi } from "@/services/api/psur";
import { usePermission } from "@/lib/auth";
import { ConfirmWithPassword } from "@/components/pv/confirm-with-password";
import type { PsurDocument } from "@/types/pv";

/** The two ways a screening decision can go. */
type PsurScreeningDecisionValue = "PROCEED_TO_SCIENTIFIC_REVIEW" | "RETURN_TO_MAH_FIRST";

/**
 * The Review Officer's screening decision: forward for scientific review,
 * or back to the MAH.
 *
 * Extracted into its own component because two surfaces need exactly this
 * control and must not drift apart — the officer's own screening queue
 * (/screening) and the Administrative Completeness Check panel on the
 * review page (/psur), where the officer can also act on it.
 *
 * The decision is gated on `psur.screen`, which only the Review Officer
 * holds. That matters most on /psur, which evaluators and peer reviewers
 * also open: they still SEE the completeness check, because knowing what
 * screening found is useful context for reviewing the report, but the
 * decision itself is not theirs to take and renders as a read-only record
 * for them. This is a UI gate; the server enforces the same rule.
 */
export function PsurScreeningDecision({
  doc,
  onChanged,
}: {
  doc: PsurDocument;
  onChanged: () => void;
}) {
  const [rationale, setRationale] = useState("");
  const canScreen = usePermission("psur.screen");
  const override = doc.screening?.humanOverride;

  // Which decision the officer has asked for but not yet confirmed. Null
  // means the buttons are showing; anything else means the confirmation
  // card has taken their place. Deliberately one piece of state rather than
  // a boolean plus a pending value — there is no such thing as "confirming"
  // without knowing which decision is being confirmed.
  const [pending, setPending] = useState<PsurScreeningDecisionValue | null>(null);

  async function commit(decision: PsurScreeningDecisionValue) {
    await psurApi.recordScreeningOverride(
      doc.id,
      decision,
      rationale.trim() || "Review Officer decision recorded.",
    );
    toast.success(
      decision === "PROCEED_TO_SCIENTIFIC_REVIEW"
        ? "Sent for scientific review."
        : "Returned to the MAH.",
    );
    setPending(null);
    onChanged();
  }

  // Already decided: everyone sees the record, nobody gets the buttons
  // again. A screening decision is a one-way handoff, not a toggle.
  if (override) {
    return (
      <p className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
        <span className="font-medium">
          Screening decision: {override.decision.replaceAll("_", " ").toLowerCase()}
        </span>
        {" — "}
        {override.rationale} ({override.by}, {override.at.slice(0, 16).replace("T", " ")} UTC)
      </p>
    );
  }

  if (!canScreen) {
    return (
      <p className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
        Awaiting the Review Officer&rsquo;s screening decision.
      </p>
    );
  }

  // Step two: the warning and the password, in place of the buttons.
  if (pending) {
    const proceeding = pending === "PROCEED_TO_SCIENTIFIC_REVIEW";
    return (
      <ConfirmWithPassword
        title={
          proceeding ? "Send this report for scientific review?" : "Return this report to the MAH?"
        }
        warning={
          proceeding
            ? "This hands the report to the evaluators and takes it off your desk. A screening decision cannot be undone or re-taken."
            : "This ends the assessment and sends the report back to the marketing authorisation holder. It will not reach scientific review, and the decision cannot be undone."
        }
        confirmLabel={proceeding ? "Confirm and send for review" : "Confirm and return to MAH"}
        actionName="the screening decision"
        destructive={!proceeding}
        onConfirmed={() => commit(pending)}
        onCancel={() => setPending(null)}
      >
        <div className="rounded-md border border-border bg-background px-2 py-1.5">
          <p className="label-caps">Your rationale</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rationale.trim() || "Review Officer decision recorded."}
          </p>
        </div>
      </ConfirmWithPassword>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Textarea
        placeholder="Rationale for your screening decision (required for an informed record)"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={2}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setPending("PROCEED_TO_SCIENTIFIC_REVIEW")}>
          Proceed to scientific review
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPending("RETURN_TO_MAH_FIRST")}>
          Return to MAH first
        </Button>
      </div>
    </div>
  );
}
