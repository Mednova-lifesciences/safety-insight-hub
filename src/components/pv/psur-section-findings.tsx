import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, X } from "lucide-react";
import { StatusPill, type Tone } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FindingResearch } from "@/components/pv/psur-finding-research";
import { psur as psurApi } from "@/services/api/psur";
import { isNotConfigured } from "@/services/api/client";
import {
  actionOwnerLabel,
  isActionOwnerOverridden,
  requiresMahAction,
} from "@/services/psur/finding-ownership";
import { SUGGESTED_SOURCE_LABEL } from "@/services/psur/document-model";
import { buildSourceLink } from "@/services/psur/source-links";
import type { PsurDocument, PsurFinding } from "@/types/pv";
import { isPending } from "@/services/psur/finding-research";

/** What kind of gap a finding is, in a word or two. */
const KIND: Record<PsurFinding["category"], { label: string; tone: Tone }> = {
  MISSING_SECTION: { label: "Missing section", tone: "critical" },
  CONSISTENCY: { label: "Inconsistency", tone: "warning" },
  NUMERICAL: { label: "Numbers don't match", tone: "warning" },
  SIGNAL: { label: "Signal", tone: "info" },
  BENEFIT_RISK: { label: "Benefit-risk", tone: "assist" },
};

const DEFICIENCY: Record<NonNullable<PsurFinding["deficiencyType"]>, string> = {
  MISSING_INFORMATION: "Missing information",
  INCOMPLETE_INFORMATION: "Incomplete information",
  INADEQUATE_EVIDENCE: "Inadequate evidence",
  INCONSISTENCY: "Inconsistency",
  UNCLEAR_AMBIGUOUS_INFORMATION: "Unclear or ambiguous",
  UNSUPPORTED_CLAIM: "Unsupported claim",
  MISSING_REQUIRED_SECTION: "Missing required section",
  INSUFFICIENT_LOCAL_EVIDENCE: "Insufficient local (Nigerian) evidence",
  ADDITIONAL_LITERATURE_REQUIRED: "Additional literature required",
  DATA_DISCREPANCY: "Data discrepancy",
};

const SEVERITY: Record<PsurFinding["severity"], string> = {
  HIGH: "High priority",
  MEDIUM: "Medium priority",
  LOW: "Low priority",
};

/**
 * The AI's findings for one section of the form, shown inside that section
 * so everything about it is in one place.
 *
 * A finding is a gap the AI says the MAH left. The evaluator decides
 * whether it is real (only accepted findings reach the V4 report and the
 * MAH feedback letter), then fixes it — on the form, or with research where
 * the template is answered from outside sources.
 */
export function SectionFindings({
  doc,
  findings,
  canEvaluate,
  canResearch,
  onChanged,
  edited = false,
}: {
  doc: PsurDocument;
  findings: PsurFinding[];
  canEvaluate: boolean;
  canResearch: boolean;
  onChanged: () => void;
  /** The evaluator has changed this section since it was saved. */
  edited?: boolean;
}) {
  if (findings.length === 0) return null;
  const pending = findings.filter(isPending).length;
  return (
    <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          What the AI found missing or wrong here ({findings.length})
        </p>
        {pending > 0 ? (
          <span className="text-xs text-muted-foreground">{pending} waiting for your decision</span>
        ) : null}
      </div>
      {edited && pending > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          You have changed this section, but{" "}
          {pending === 1 ? "a finding here is" : `${pending} findings here are`} still undecided. If
          you fixed a gap the MAH left, accept it and mark it fixed, so the MAH feedback letter
          tells them. If the AI was wrong, dismiss it.
        </p>
      ) : null}
      <ul className="space-y-2">
        {findings.map((f) => (
          <FindingItem
            key={f.id}
            doc={doc}
            finding={f}
            canEvaluate={canEvaluate}
            canResearch={canResearch}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function FindingItem({
  doc,
  finding: f,
  canEvaluate,
  canResearch,
  onChanged,
}: {
  doc: PsurDocument;
  finding: PsurFinding;
  canEvaluate: boolean;
  canResearch: boolean;
  onChanged: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [reassignReason, setReassignReason] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = KIND[f.category];
  const link = f.suggestedSource ? buildSourceLink(f, doc.product) : null;

  const record = async (assessment: "ACCEPTED" | "DISMISSED", rationale: string) => {
    setBusy(true);
    try {
      await psurApi.recordAssessment(doc.id, f.id, assessment, rationale);
      toast.success(assessment === "ACCEPTED" ? "Accepted as a real gap." : "Dismissed.");
      setDismissing(false);
      onChanged();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — nothing was recorded."
          : "Could not record your decision.",
      );
    } finally {
      setBusy(false);
    }
  };

  const status = !f.humanAssessment
    ? { text: "Is this a real gap? Decide below.", tone: "warning" as Tone }
    : f.humanAssessment === "DISMISSED"
      ? {
          text: "Dismissed — not a real gap. Not in the report or the MAH letter.",
          tone: "neutral" as Tone,
        }
      : f.resolved
        ? {
            text: "Real gap, fixed by NAFDAC. The report and the MAH letter say so.",
            tone: "success" as Tone,
          }
        : {
            text: "Real gap, not fixed yet. The MAH letter asks for it in the next PSUR.",
            tone: "critical" as Tone,
          };

  return (
    <li className="rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={kind.tone}>{kind.label}</StatusPill>
        <StatusPill tone={f.source === "ai" ? "assist" : "neutral"}>
          {f.source === "ai" ? "AI" : "Rule"}
        </StatusPill>
        <span className="text-xs text-muted-foreground">{SEVERITY[f.severity]}</span>
      </div>
      <p className="mt-2">{f.description}</p>
      <p
        className={`mt-1 text-xs ${status.tone === "critical" ? "text-critical" : status.tone === "success" ? "text-success" : "text-muted-foreground"}`}
      >
        {status.text}
        {f.humanAssessment === "DISMISSED" && f.rationale ? ` Reason: ${f.rationale}` : ""}
      </p>

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">More detail</summary>
        <div className="mt-2 space-y-2">
          <p className="border-l-2 border-border pl-2">What the AI saw: {f.evidence}</p>
          {f.deficiencyType ? <p>Type of gap: {DEFICIENCY[f.deficiencyType]}</p> : null}
          <p>
            Who must act: {actionOwnerLabel(f)}
            {isActionOwnerOverridden(f) && f.actionOwnerOverride
              ? ` (set by ${f.actionOwnerOverride.by}: ${f.actionOwnerOverride.rationale})`
              : ""}
          </p>
          {f.suggestedSource ? (
            <p>
              Where to look: {SUGGESTED_SOURCE_LABEL[f.suggestedSource.type]} —{" "}
              {f.suggestedSource.note}
              {link ? (
                <>
                  {" "}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  >
                    Search {link.site} →
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {canEvaluate ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReassigning(true);
                  setReassignReason("");
                }}
              >
                {requiresMahAction(f)
                  ? "Keep this off the MAH letter"
                  : "Put this on the MAH letter"}
              </Button>
              {f.actionOwnerOverride ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await psurApi.clearActionOwnerOverride(doc.id, f.id);
                      toast.success("Back to the default.");
                      onChanged();
                    } catch {
                      toast.error("Could not change it.");
                    }
                  }}
                >
                  Undo that choice
                </Button>
              ) : null}
            </div>
          ) : null}
          {reassigning ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                autoFocus
                aria-label="Reason"
                placeholder="Why? (required — e.g. 'I can close this from VigiFlow without going back to the MAH')"
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!reassignReason.trim()}
                  onClick={async () => {
                    try {
                      await psurApi.recordActionOwnerOverride(
                        doc.id,
                        f.id,
                        requiresMahAction(f) ? "ASSESSOR" : "MAH",
                        reassignReason.trim(),
                      );
                      toast.success("Recorded.");
                      setReassigning(false);
                      onChanged();
                    } catch {
                      toast.error("Could not record the change.");
                    }
                  }}
                >
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReassigning(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </details>

      {canEvaluate && !f.humanAssessment && !dismissing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => record("ACCEPTED", "Confirmed by reviewer")}
          >
            <Check className="size-4" /> Yes, it's a real gap
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setDismissing(true)}>
            <X className="size-4" /> No, dismiss it
          </Button>
        </div>
      ) : null}
      {canEvaluate && f.humanAssessment && !f.resolved && !dismissing ? (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline"
          onClick={() =>
            f.humanAssessment === "ACCEPTED"
              ? setDismissing(true)
              : record("ACCEPTED", "Confirmed by reviewer")
          }
        >
          {f.humanAssessment === "ACCEPTED" ? "Change to dismissed" : "Change to accepted"}
        </button>
      ) : null}
      {dismissing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={2}
            autoFocus
            aria-label="Reason for dismissing"
            placeholder="Why is this not a real gap? (required — e.g. 'it is in section 4 of the PSUR')"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => record("DISMISSED", reason.trim())}
            >
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {f.humanAssessment === "ACCEPTED" ? (
        <FindingResearch doc={doc} finding={f} canEdit={canResearch} onChanged={onChanged} />
      ) : null}
    </li>
  );
}
