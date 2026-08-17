import { useState } from "react";
import { AlertTriangle, Check, HelpCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { seriousness as seriousnessApi } from "@/services/api/seriousness";
import { demoSeriousness } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import type { CaseDetail, SeriousnessAssessment } from "@/types/pv";
import {
  AssistLabel,
  EmptyState,
  Field,
  QueryBoundary,
  Section,
  SeriousnessBadge,
  SourceTag,
  StatusPill,
} from "./primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isNotConfigured } from "@/services/api/client";

type Decision = "ACCEPT_REPORTED" | "MARK_SERIOUS" | "REQUEST_INFO";

const DECISION_LABEL: Record<Decision, string> = {
  ACCEPT_REPORTED: "Accept reported classification",
  MARK_SERIOUS: "Mark as serious",
  REQUEST_INFO: "Request more information",
};

export function SeriousnessAssist({ caseDetail }: { caseDetail: CaseDetail }) {
  const query = usePvQuery<SeriousnessAssessment | null>(
    ["seriousness", caseDetail.id],
    () => seriousnessApi.get(caseDetail.id),
    () => demoSeriousness[caseDetail.id] ?? null,
  );
  const [decision, setDecision] = useState<Decision | null>(null);
  const [rationale, setRationale] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!decision) return;
    if (rationale.trim().length < 5) {
      toast.error("A rationale is required for the audit record.");
      return;
    }
    setPending(true);
    try {
      await seriousnessApi.recordDecision(caseDetail.id, decision, rationale.trim());
      toast.success("Decision recorded and written to the audit trail.");
      setDecision(null);
      setRationale("");
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the decision was not saved. No case value was changed."
          : "The decision could not be saved. No case value was changed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      title="Seriousness assist"
      description="Assistive analysis of the narrative against ICH E2A seriousness criteria. It never changes the official case value."
      actions={query.data ? <SourceTag source={query.data.source} /> : null}
    >
      <QueryBoundary query={query} loadingLabel="Running seriousness analysis">
        {(assessment) =>
          !assessment ? (
            <EmptyState
              title="No seriousness analysis available"
              description="Run the analysis from the backend seriousness engine to review narrative evidence for this case."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await seriousnessApi.analyzeCase(caseDetail.id);
                      query.refetch();
                    } catch {
                      toast.error("Seriousness engine is not reachable.");
                    }
                  }}
                >
                  Run analysis
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Reported seriousness" value={<SeriousnessBadge value={assessment.reportedSeriousness} />} />
                <Field label="Narrative assessment" value={<SeriousnessBadge value={assessment.narrativeAssessment} />} />
                <Field
                  label="Result"
                  value={
                    assessment.mismatch ? (
                      <StatusPill tone="warning" icon={<AlertTriangle className="size-3" />}>
                        Potential seriousness mismatch
                      </StatusPill>
                    ) : (
                      <StatusPill tone="success">Consistent with reported classification</StatusPill>
                    )
                  }
                />
              </div>

              <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5">
                <p className="text-sm text-foreground">{assessment.rationale}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Engine: <span className="mono-num">{assessment.engineVersion}</span> · The official
                  case seriousness remains <strong>{assessment.reportedSeriousness.replace("_", "-").toLowerCase()}</strong> until a
                  reviewer records a decision.
                </p>
              </div>

              <div>
                <p className="label-caps mb-2">ICH seriousness criteria</p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {assessment.criteria.map((c) => (
                    <li key={c.criterion} className="flex flex-wrap items-start gap-3 px-3 py-2">
                      <StatusPill tone={c.detected ? "warning" : "neutral"}>
                        {c.detected ? "Evidence found" : "Not detected"}
                      </StatusPill>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{c.criterion}</p>
                        {c.evidence.map((e) => (
                          <p key={e} className="mt-1 border-l-2 border-warning/50 pl-2 text-xs text-muted-foreground italic">
                            “{e}”
                          </p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <AssistLabel>Assistive flag — human review required</AssistLabel>
                  {assessment.reviewState === "REVIEWED" ? (
                    <StatusPill tone="success">
                      Reviewed by {assessment.reviewedBy ?? "reviewer"}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="warning">Pending review</StatusPill>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={decision === "ACCEPT_REPORTED" ? "default" : "outline"}
                    onClick={() => setDecision("ACCEPT_REPORTED")}
                  >
                    <Check className="size-4" /> {DECISION_LABEL.ACCEPT_REPORTED}
                  </Button>
                  <Button
                    size="sm"
                    variant={decision === "MARK_SERIOUS" ? "default" : "outline"}
                    onClick={() => setDecision("MARK_SERIOUS")}
                  >
                    <ShieldAlert className="size-4" /> {DECISION_LABEL.MARK_SERIOUS}
                  </Button>
                  <Button
                    size="sm"
                    variant={decision === "REQUEST_INFO" ? "default" : "outline"}
                    onClick={() => setDecision("REQUEST_INFO")}
                  >
                    <HelpCircle className="size-4" /> {DECISION_LABEL.REQUEST_INFO}
                  </Button>
                </div>

                {decision ? (
                  <div className="space-y-2">
                    <label className="label-caps" htmlFor="ser-rationale">
                      Rationale (recorded in the audit trail)
                    </label>
                    <Textarea
                      id="ser-rationale"
                      rows={3}
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                      placeholder="Document the clinical reasoning for this decision."
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={submit} disabled={pending}>
                        Record {DECISION_LABEL[decision].toLowerCase()}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDecision(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )
        }
      </QueryBoundary>
    </Section>
  );
}
