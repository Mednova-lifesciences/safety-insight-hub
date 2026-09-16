import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ExternalLink, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Section, StatusPill, type Tone } from "@/components/pv/primitives";
import { ConfirmWithPassword } from "@/components/pv/confirm-with-password";
import { cn } from "@/lib/utils";
import { psur as psurApi } from "@/services/api/psur";
import {
  OUTCOME_ACTIONS,
  OUTCOME_LABELS,
  SCREENING_GROUPS,
  SCREENING_GROUP_LABELS,
  SCREENING_GROUP_NOTES,
  STATUS_LABELS,
  assessTimeliness,
  checksInGroup,
  emptySubmissionDetails,
  normalizeChecks,
  recommendOutcome,
  returnsToMah,
  screeningCheck,
} from "@/services/psur/screening-checklist";
import type {
  PsurAdministrativeScreening,
  PsurDocument,
  PsurScreeningCheckItem,
  PsurScreeningCheckStatus,
  PsurScreeningOutcomeDecision,
  PsurSubmissionDetails,
} from "@/types/pv";

/**
 * NAFDAC's PSUR Administrative Screening Checklist, as a working surface.
 *
 * Laid out as the paper form is — submission details, then sixteen numbered
 * checks in three groups, then the outcome and sign-off — because the
 * officers already know that form, and a screening record that reads
 * differently from the document it implements is harder to trust and harder
 * to defend.
 *
 * The AI fills it in; the officer owns it. Every row starts as a proposal,
 * marked as such, and stops being one the moment a person touches it.
 */
export function PsurScreeningChecklist({
  doc,
  onChanged,
  onScreened,
}: {
  doc: PsurDocument;
  onChanged: () => void;
  /** Fired once the outcome is recorded, so the page can clear this form
   *  away — the report has left the officer's desk with it. */
  onScreened?: (decision: PsurScreeningOutcomeDecision) => void;
}) {
  const stored = doc.administrativeScreening;
  const [details, setDetails] = useState<PsurSubmissionDetails>(
    stored?.submissionDetails ?? { ...emptySubmissionDetails(), dateReceived: doc.uploadedAt },
  );
  const [checks, setChecks] = useState<PsurScreeningCheckItem[]>(
    normalizeChecks(stored?.checks ?? []),
  );
  const [deficiencies, setDeficiencies] = useState(stored?.outcome?.deficiencies ?? "");
  const [conclusions, setConclusions] = useState(stored?.outcome?.conclusions ?? "");
  const [officerName, setOfficerName] = useState(stored?.outcome?.officerName ?? "");
  const [responseDeadline, setResponseDeadline] = useState(
    stored?.outcome?.mahResponseDeadline ?? "",
  );
  const [nextDue, setNextDue] = useState(stored?.outcome?.nextPsurDueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<PsurScreeningOutcomeDecision | null>(null);

  const outcome = stored?.outcome;
  const recommendation = recommendOutcome(checks);
  // Recomputed live so the officer sees the effect of correcting a date
  // immediately, rather than after a save round-trip.
  const timeliness = assessTimeliness(details);

  function setCheck(id: PsurScreeningCheckItem["id"], patch: Partial<PsurScreeningCheckItem>) {
    setChecks((cs) =>
      cs.map((c) => (c.id === id ? { ...c, ...patch, assistGenerated: false } : c)),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await psurApi.updateAdministrativeScreening(doc.id, {
        submissionDetails: details,
        checks,
      });
      toast.success("Screening checklist saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the checklist.");
    } finally {
      setSaving(false);
    }
  }

  async function commitOutcome(decision: PsurScreeningOutcomeDecision) {
    // Save the form first, so the outcome is recorded against exactly what
    // is on screen rather than against a stale stored copy.
    await psurApi.updateAdministrativeScreening(doc.id, {
      submissionDetails: details,
      checks,
    });
    await psurApi.recordScreeningOutcome(
      doc.id,
      decision,
      deficiencies.trim(),
      conclusions.trim(),
      officerName.trim(),
      responseDeadline,
      nextDue,
    );
    toast.success(
      decision === "ACCEPTED_FOR_ASSESSMENT"
        ? "Accepted — sent for scientific assessment."
        : "Recorded and returned to the MAH.",
    );
    setConfirming(null);
    if (onScreened) onScreened(decision);
    else onChanged();
  }

  // The decision, at the top as well as the bottom.
  //
  // Sixteen checks with a comment box each make a long page, and on a phone
  // the outcome was several screens below the fold — an officer looking for
  // "proceed to scientific review" had no way of knowing it was down there
  // at all. The buttons themselves live in section C, where the form puts
  // them; this is a jump to it, plus what the checklist currently implies,
  // so the decision is visible from the moment the page opens.
  const decisionSummary = outcome ? null : (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        recommendation.decision === "ACCEPTED_FOR_ASSESSMENT"
          ? "border-border bg-muted/50"
          : "border-warning/40 bg-warning-soft",
      )}
    >
      <p className="label-caps">Decision</p>
      <p className="mt-1 text-sm font-medium">{OUTCOME_ACTIONS[recommendation.decision]}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{recommendation.reason}</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => {
          document
            .getElementById("screening-outcome")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        Go to the decision <ArrowDown className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {decisionSummary}
      <SubmissionDetailsPanel
        details={details}
        onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
        daysToReceipt={timeliness.daysToReceipt}
        locked={!!outcome}
      />

      <Section
        title="B. Screening checks"
        description="Any No in items 1–8 is a validation deficiency. Items 9–16 are presence checks only — adequacy is the assessor's job."
        actions={
          outcome ? null : (
            <Button size="sm" variant="outline" disabled={saving} onClick={save}>
              <Save className="size-4" /> {saving ? "Saving…" : "Save checklist"}
            </Button>
          )
        }
      >
        <div className="space-y-5">
          {SCREENING_GROUPS.map((group) => (
            <div key={group} className="space-y-2">
              <div>
                <p className="label-caps">{SCREENING_GROUP_LABELS[group]}</p>
                <p className="text-xs text-muted-foreground">{SCREENING_GROUP_NOTES[group]}</p>
              </div>
              {checksInGroup(group).map((def) => {
                const row = checks.find((c) => c.id === def.id);
                if (!row) return null;
                return (
                  <CheckRow
                    key={def.id}
                    number={def.number}
                    label={def.label}
                    externalRecord={def.requiresExternalRecord}
                    computed={def.computed === true}
                    row={row}
                    locked={!!outcome}
                    onChange={(patch) => setCheck(def.id, patch)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="screening-outcome"
        title="C. Outcome and sign-off"
        description="The officer's decision. The checklist recommends; it never decides."
      >
        {outcome ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                tone={outcome.decision === "ACCEPTED_FOR_ASSESSMENT" ? "success" : "critical"}
              >
                {OUTCOME_LABELS[outcome.decision]}
              </StatusPill>
              {outcome.citedItems.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  Items cited: {outcome.citedItems.join(", ")}
                </span>
              ) : null}
            </div>
            {outcome.conclusions ? (
              <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5">
                <p className="label-caps">Final conclusions</p>
                <p className="mt-0.5 text-xs">{outcome.conclusions}</p>
              </div>
            ) : null}
            {outcome.deficiencies ? (
              <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5">
                <p className="label-caps">Deficiencies / action required</p>
                <p className="mt-0.5 text-xs">{outcome.deficiencies}</p>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Signed by {outcome.officerName || outcome.by} on{" "}
              {outcome.at.slice(0, 16).replace("T", " ")} UTC
              {outcome.officerName && outcome.officerName !== outcome.by
                ? ` (account: ${outcome.by})`
                : ""}
              .
            </p>
          </div>
        ) : confirming ? (
          <ConfirmWithPassword
            title={
              confirming === "ACCEPTED_FOR_ASSESSMENT"
                ? "Accept this submission for assessment?"
                : confirming === "COMPLIANCE_DIRECTIVE"
                  ? "Issue a compliance directive?"
                  : "Reject this submission?"
            }
            warning={
              confirming === "ACCEPTED_FOR_ASSESSMENT"
                ? "This hands the report to the evaluators and closes your screening. It cannot be re-screened."
                : "This ends the assessment here and returns the report to the marketing authorisation holder. It cannot be undone."
            }
            confirmLabel={`Confirm — ${OUTCOME_ACTIONS[confirming].toLowerCase()}`}
            actionName="the screening outcome"
            destructive={confirming !== "ACCEPTED_FOR_ASSESSMENT"}
            blockedReason={
              !officerName.trim()
                ? "Enter your name in the sign-off block above — a screening outcome cannot be recorded unsigned."
                : !conclusions.trim()
                  ? "Record your conclusions above before signing off."
                  : returnsToMah(confirming) && !responseDeadline
                    ? "Set a date for the MAH to respond by — a directive they cannot be late for is not enforceable."
                    : undefined
            }
            onConfirmed={() => commitOutcome(confirming)}
            onCancel={() => setConfirming(null)}
          >
            <div className="space-y-2 rounded-md border border-border bg-background px-2 py-1.5">
              <div>
                <p className="label-caps">Items cited</p>
                <p className="text-xs">
                  {recommendation.citedItems.length > 0
                    ? recommendation.citedItems.join(", ")
                    : "None — nothing failed."}
                </p>
              </div>

              {/* Both dates exist only because the report is going back to
                  the MAH: one is when they must reply to this letter, the
                  other when their resubmission is due. Neither means
                  anything for a submission that was accepted, so neither is
                  shown then. */}
              {returnsToMah(confirming) ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="screening-response-deadline" className="text-xs">
                      MAH response deadline
                    </Label>
                    <Input
                      id="screening-response-deadline"
                      type="date"
                      value={responseDeadline}
                      onChange={(e) => setResponseDeadline(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="screening-next-due" className="text-xs">
                      PSUR / PBRER resubmission date
                    </Label>
                    <Input
                      id="screening-next-due"
                      type="date"
                      value={nextDue}
                      onChange={(e) => setNextDue(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <p className="label-caps">Signing as</p>
                <p className="text-xs">{officerName.trim() || "—"}</p>
              </div>
            </div>
          </ConfirmWithPassword>
        ) : (
          <div className="space-y-3">
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-xs",
                recommendation.decision === "ACCEPTED_FOR_ASSESSMENT"
                  ? "border-border bg-muted/50"
                  : "border-warning/40 bg-warning-soft",
              )}
            >
              <p className="font-medium">
                The checklist suggests: {OUTCOME_LABELS[recommendation.decision]}
              </p>
              <p className="mt-0.5 text-muted-foreground">{recommendation.reason}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="screening-conclusions">Final conclusions</Label>
              <Textarea
                id="screening-conclusions"
                rows={3}
                placeholder="Your closing assessment of this submission — what you found, and why the outcome follows."
                value={conclusions}
                onChange={(e) => setConclusions(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The screening record&rsquo;s own conclusion. This is what the evaluator reads first.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="screening-deficiencies">Deficiencies / action required</Label>
              <Textarea
                id="screening-deficiencies"
                rows={3}
                placeholder="What the MAH must do, in the words you want on the directive."
                value={deficiencies}
                onChange={(e) => setDeficiencies(e.target.value)}
              />
            </div>

            {/* The form's own sign-off block. The typed name is the
                signature a person claims; the password confirmation on the
                next step is what makes the claim theirs. */}
            <div className="space-y-1.5 border-t border-border pt-3">
              <Label htmlFor="screening-officer">
                Screening officer &mdash; name and signature
              </Label>
              <Input
                id="screening-officer"
                placeholder="Your full name, as it should appear on the record"
                value={officerName}
                onChange={(e) => setOfficerName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                You will confirm with your password on the next step. The date is recorded
                automatically.
              </p>
            </div>

            {/* Labelled with what the decision DOES, with the form's own
                wording underneath. An officer looking for "proceed to
                scientific review" should not have to work out that
                "Accepted for assessment" is the same thing. */}
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  "ACCEPTED_FOR_ASSESSMENT",
                  "COMPLIANCE_DIRECTIVE",
                  "NOT_ACCEPTED_RESUBMIT",
                ] as PsurScreeningOutcomeDecision[]
              ).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={d === "ACCEPTED_FOR_ASSESSMENT" ? "default" : "outline"}
                  className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                  onClick={() => setConfirming(d)}
                >
                  <span className="text-sm font-medium">{OUTCOME_ACTIONS[d]}</span>
                  <span className="text-xs font-normal opacity-80">{OUTCOME_LABELS[d]}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

const DETAIL_FIELDS: { key: keyof PsurSubmissionDetails; label: string }[] = [
  { key: "productName", label: "Product name" },
  { key: "activeSubstance", label: "Active substance" },
  { key: "nafdacRegNo", label: "NAFDAC Reg. No." },
  { key: "mah", label: "MAH" },
  { key: "qppv", label: "QPPV" },
  { key: "qppvContact", label: "QPPV tel / e-mail" },
  { key: "ibd", label: "IBD" },
  { key: "firstNafdacRegistrationDate", label: "First NAFDAC reg. date" },
  { key: "dlp", label: "DLP" },
  { key: "intervalCovered", label: "Interval covered" },
  { key: "dateReceived", label: "Date received" },
];

function SubmissionDetailsPanel({
  details,
  onChange,
  daysToReceipt,
  locked,
}: {
  details: PsurSubmissionDetails;
  onChange: (patch: Partial<PsurSubmissionDetails>) => void;
  daysToReceipt: number | undefined;
  locked: boolean;
}) {
  return (
    <Section
      title="A. Submission details"
      description="Read off the submitted document. A blank field means it was not found — fill it in from the paperwork rather than leaving a gap."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DETAIL_FIELDS.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`detail-${key}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`detail-${key}`}
              value={details[key]}
              disabled={locked}
              placeholder="Not found in the document"
              onChange={(e) =>
                onChange({ [key]: e.target.value } as Partial<PsurSubmissionDetails>)
              }
            />
          </div>
        ))}
        <div className="space-y-1">
          {/* Derived, never typed: a stored copy could disagree with the two
              dates it comes from. */}
          <Label className="text-xs">Days DLP → receipt</Label>
          <Input
            value={daysToReceipt === undefined ? "—" : String(daysToReceipt)}
            disabled
            className="mono-num"
          />
        </div>
      </div>
    </Section>
  );
}

const STATUS_ORDER: PsurScreeningCheckStatus[] = ["YES", "NO", "NOT_APPLICABLE", "NOT_ASSESSABLE"];

function statusTone(status: PsurScreeningCheckStatus): Tone {
  if (status === "YES") return "success";
  if (status === "NO") return "critical";
  if (status === "NOT_APPLICABLE") return "neutral";
  return "warning";
}

function CheckRow({
  number,
  label,
  externalRecord,
  computed,
  row,
  locked,
  onChange,
}: {
  number: number;
  label: string;
  externalRecord: string | undefined;
  computed: boolean;
  row: PsurScreeningCheckItem;
  locked: boolean;
  onChange: (patch: Partial<PsurScreeningCheckItem>) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex gap-3">
        <span className="mono-num shrink-0 text-xs text-muted-foreground">{number}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">{label}</p>

          {externalRecord ? (
            <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5 text-xs">
              <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-medium">You must check this yourself. </span>
                {externalRecord}
              </span>
            </p>
          ) : null}

          {computed ? (
            // items-start + flex-wrap, not items-center: the sentence is
            // long, and on a phone it has to wrap underneath the pill rather
            // than be squeezed into a narrow column beside it.
            <div className="flex flex-wrap items-start gap-2 text-xs text-muted-foreground">
              <StatusPill tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</StatusPill>
              <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                Calculated from the DLP and the date received — correct the dates above to change
                it.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={locked}
                  onClick={() => onChange({ status: s })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-60",
                    row.status === s
                      ? "border-primary bg-accent font-medium"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
              {row.assistGenerated ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="size-3" /> AI proposal — not yet confirmed
                </span>
              ) : null}
            </div>
          )}

          <Textarea
            rows={2}
            placeholder="Deficiency noted"
            value={row.deficiency}
            disabled={locked || computed}
            onChange={(e) => onChange({ deficiency: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/** A one-line read of where a checklist stands, for the queue rows. */
export function ScreeningSummaryPill({ doc }: { doc: PsurDocument }) {
  const screening = doc.administrativeScreening;
  if (!screening) {
    return (
      <StatusPill tone="neutral">
        <AlertTriangle className="size-3" /> Not screened yet
      </StatusPill>
    );
  }
  const checks = normalizeChecks(screening.checks);
  const failed = checks.filter((c) => c.status === "NO").length;
  const unresolved = checks.filter((c) => c.status === "NOT_ASSESSABLE").length;

  if (failed > 0) {
    return <StatusPill tone="critical">{failed} of 16 failing</StatusPill>;
  }
  if (unresolved > 0) {
    return <StatusPill tone="warning">{unresolved} still to confirm</StatusPill>;
  }
  return <StatusPill tone="success">All 16 checks pass</StatusPill>;
}

/**
 * The officer's completed checklist, read-only, for the evaluator and peer
 * reviewer.
 *
 * They need to know what screening found — it is real context for the
 * scientific review — but the decision was the officer's step and is not
 * theirs to revisit. Deliberately a summary rather than the full form: all
 * sixteen rows with their status, but no controls, and the failures and
 * unresolved items pulled to the top where a reviewer will actually read
 * them.
 */
export function ScreeningRecord({ screening }: { screening: PsurAdministrativeScreening }) {
  const checks = normalizeChecks(screening.checks);
  const failed = checks.filter((c) => c.status === "NO");
  const unresolved = checks.filter((c) => c.status === "NOT_ASSESSABLE");
  const outcome = screening.outcome;

  return (
    <Section
      title="Administrative screening (Review Officer)"
      description="NAFDAC's 16-item screening checklist, completed on receipt. Shown here as a record — the screening decision belongs to the Review Officer."
      actions={
        outcome ? (
          <StatusPill
            tone={outcome.decision === "ACCEPTED_FOR_ASSESSMENT" ? "success" : "critical"}
          >
            {OUTCOME_LABELS[outcome.decision]}
          </StatusPill>
        ) : (
          <StatusPill tone="warning">Screening not yet concluded</StatusPill>
        )
      }
    >
      <div className="space-y-3">
        {outcome?.conclusions ? (
          <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5">
            <p className="label-caps">Officer&rsquo;s conclusions</p>
            <p className="mt-0.5 text-xs">{outcome.conclusions}</p>
          </div>
        ) : null}

        {failed.length > 0 ? (
          <div className="space-y-1">
            <p className="label-caps">Failed ({failed.length})</p>
            {failed.map((c) => (
              <p key={c.id} className="text-xs">
                <span className="mono-num text-muted-foreground">
                  {screeningCheck(c.id).number}.
                </span>{" "}
                {screeningCheck(c.id).label}
                {c.deficiency ? (
                  <span className="text-muted-foreground"> — {c.deficiency}</span>
                ) : null}
              </p>
            ))}
          </div>
        ) : null}

        {unresolved.length > 0 ? (
          <div className="space-y-1">
            <p className="label-caps">Could not be settled from the submission</p>
            <p className="text-xs text-muted-foreground">
              Item(s){" "}
              {unresolved
                .map((c) => screeningCheck(c.id).number)
                .sort((a, b) => a - b)
                .join(", ")}
              .
            </p>
          </div>
        ) : null}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">All 16 checks</summary>
          <ul className="mt-2 space-y-1">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <StatusPill tone={statusTone(c.status)}>{STATUS_LABELS[c.status]}</StatusPill>
                <span className="mono-num text-muted-foreground">
                  {screeningCheck(c.id).number}.
                </span>
                <span>{screeningCheck(c.id).label}</span>
              </li>
            ))}
          </ul>
        </details>

        {outcome ? (
          <p className="text-xs text-muted-foreground">
            Signed by {outcome.officerName || outcome.by} on{" "}
            {outcome.at.slice(0, 16).replace("T", " ")} UTC.
          </p>
        ) : null}
      </div>
    </Section>
  );
}
