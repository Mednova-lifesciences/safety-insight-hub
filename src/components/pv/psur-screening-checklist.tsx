import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Section, StatusPill, type Tone } from "@/components/pv/primitives";
import { ConfirmWithPassword } from "@/components/pv/confirm-with-password";
import { cn } from "@/lib/utils";
import { psur as psurApi } from "@/services/api/psur";
import {
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
} from "@/services/psur/screening-checklist";
import type {
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
}: {
  doc: PsurDocument;
  onChanged: () => void;
}) {
  const stored = doc.administrativeScreening;
  const [details, setDetails] = useState<PsurSubmissionDetails>(
    stored?.submissionDetails ?? { ...emptySubmissionDetails(), dateReceived: doc.uploadedAt },
  );
  const [checks, setChecks] = useState<PsurScreeningCheckItem[]>(
    normalizeChecks(stored?.checks ?? []),
  );
  const [deficiencies, setDeficiencies] = useState(stored?.outcome?.deficiencies ?? "");
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
    await psurApi.recordScreeningOutcome(doc.id, decision, deficiencies.trim());
    toast.success(
      decision === "ACCEPTED_FOR_ASSESSMENT"
        ? "Accepted — sent for scientific assessment."
        : "Recorded and returned to the MAH.",
    );
    setConfirming(null);
    onChanged();
  }

  return (
    <div className="space-y-4">
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
            {outcome.deficiencies ? (
              <p className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
                {outcome.deficiencies}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Screened by {outcome.by} on {outcome.at.slice(0, 16).replace("T", " ")} UTC.
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
            confirmLabel={`Confirm — ${OUTCOME_LABELS[confirming].toLowerCase()}`}
            actionName="the screening outcome"
            destructive={confirming !== "ACCEPTED_FOR_ASSESSMENT"}
            onConfirmed={() => commitOutcome(confirming)}
            onCancel={() => setConfirming(null)}
          >
            <div className="space-y-1 rounded-md border border-border bg-background px-2 py-1.5">
              <p className="label-caps">Items cited</p>
              <p className="text-xs">
                {recommendation.citedItems.length > 0
                  ? recommendation.citedItems.join(", ")
                  : "None — nothing failed."}
              </p>
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
              <Label htmlFor="screening-deficiencies">Deficiencies / action required</Label>
              <Textarea
                id="screening-deficiencies"
                rows={3}
                placeholder="What the MAH must do, in the words you want on the directive."
                value={deficiencies}
                onChange={(e) => setDeficiencies(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setConfirming("ACCEPTED_FOR_ASSESSMENT")}>
                Accept for assessment
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming("COMPLIANCE_DIRECTIVE")}
              >
                Compliance directive
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming("NOT_ACCEPTED_RESUBMIT")}
              >
                Not accepted — resubmit
              </Button>
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
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusPill tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</StatusPill>
              <span>
                Calculated from the DLP and the date received — correct the dates above to change
                it.
              </span>
            </p>
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
