import { createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useState } from "react";
import { ArrowRight, Download, FileText, Upload, Wrench } from "lucide-react";
import { toast } from "sonner";
import { psur as psurApi } from "@/services/api/psur";
import { AUTO_FIX_ENABLED } from "@/services/api/feature-flags";
import { demoPsurDocuments, demoPsurFindings } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import {
  AssistLabel,
  EmptyState,
  Field,
  Pager,
  PageHeader,
  paginate,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
  type Tone,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PSUR_V4_TEMPLATE_SECTIONS,
  type PsurBenefitRiskAssessment,
  type PsurDocument,
  type PsurEvidenceQuality,
  type PsurFinding,
  type PsurIntegratedEffectsRow,
  type PsurKeyBenefit,
  type PsurKeyRisk,
  type PsurOverallBenefitRiskOutcome,
  type PsurRiskMinimisationAction,
  type PsurSectionStatus,
  type PsurSignOff,
  type PsurSpecialPopulationArea,
  type PsurSpecialPopulationItem,
  type PsurUncertainty,
  type PsurUncertaintyCategory,
  type PsurV4SectionId,
} from "@/types/pv";
import { buildAuthoritativeSectionCoverage } from "@/services/psur/section-consistency";

export const Route = createFileRoute("/_app/psur")({
  head: () => ({
    meta: [
      { title: "PSUR / PBRER review — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Upload a PSUR/PBRER, extract its structure and review completeness, consistency and numerical findings.",
      },
      { property: "og:title", content: "PSUR / PBRER review — MedNova PV Assist" },
      {
        property: "og:description",
        content:
          "Review assistance for periodic safety reports, with the final assessment recorded by a human.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="psur.review">
      <PsurPage />
    </PermissionGate>
  ),
});

const FLOW = ["Upload PDF or XLSX/CSV", "AI review", "Findings displayed", "Accept / dismiss"];

const categoryTone: Record<PsurFinding["category"], Tone> = {
  MISSING_SECTION: "critical",
  CONSISTENCY: "warning",
  NUMERICAL: "warning",
  SIGNAL: "info",
  BENEFIT_RISK: "assist",
};

/** Human-readable label for each fixed suggestedSource category — see
 *  PsurSuggestedSource (types/pv.ts) for why this list is fixed and where
 *  each category comes from (the NAFDAC PSUR/PBRER assessor template). */
const suggestedSourceLabel: Record<NonNullable<PsurFinding["suggestedSource"]>["type"], string> = {
  VIGIFLOW_NIGERIA: "Check VigiFlow (Nigerian data)",
  REQUEST_FROM_MAH: "Request from the MAH",
  PUBLISHED_LITERATURE: "Published literature",
  REFERENCE_SAFETY_INFORMATION: "Reference Safety Information (RSI/SmPC)",
  WORLDWIDE_REGULATORY_ACTIONS: "Worldwide regulatory actions",
  PATIENT_HCP_FEEDBACK: "Patient/HCP feedback",
  RISK_MANAGEMENT_PLAN: "Risk Management Plan / PASS",
  OTHER: "Other source",
};

const v4SectionLabel = new Map(PSUR_V4_TEMPLATE_SECTIONS.map((s) => [s.id, s.name]));

const deficiencyTypeLabel: Record<NonNullable<PsurFinding["deficiencyType"]>, string> = {
  MISSING_INFORMATION: "Missing information",
  INCOMPLETE_INFORMATION: "Incomplete information",
  INADEQUATE_EVIDENCE: "Inadequate evidence",
  INCONSISTENCY: "Inconsistency",
  UNCLEAR_AMBIGUOUS_INFORMATION: "Unclear/ambiguous",
  UNSUPPORTED_CLAIM: "Unsupported claim",
  MISSING_REQUIRED_SECTION: "Missing required section",
  INSUFFICIENT_LOCAL_EVIDENCE: "Insufficient local (Nigerian) evidence",
  ADDITIONAL_LITERATURE_REQUIRED: "Additional literature required",
  DATA_DISCREPANCY: "Data discrepancy",
};

const riskMinimisationActionLabel: Record<PsurRiskMinimisationAction, string> = {
  NO_ACTION_REQUIRED: "No action required",
  CONTINUE_ROUTINE_PV: "Continue routine pharmacovigilance",
  REQUEST_ADDITIONAL_INFO_FROM_MAH: "Request additional information from MAH",
  REQUEST_MAH_CLARIFICATION: "Request MAH clarification",
  TARGETED_COMMUNICATION_SAFETY_LETTER: "Targeted communication / safety letter",
  SUBMIT_UPDATE_RMP: "Submit or update Risk Management Plan (RMP)",
  PROPOSAL_FOR_PASS: "Proposal for Post-Authorisation Safety Study (PASS)",
  UPDATE_SMPC_PIL_LABEL: "Update to SmPC / PIL / label (variation)",
  REFER_TO_EXPERT_ADVISORY_COMMITTEE: "Refer to Expert Advisory Committee",
  RECOMMEND_SUSPENSION_WITHDRAWAL: "Recommend suspension/withdrawal",
};

const overallOutcomeLabel: Record<PsurOverallBenefitRiskOutcome, string> = {
  FAVOURABLE: "Favourable",
  FAVOURABLE_WITH_CONDITIONS: "Favourable with conditions",
  UNCERTAIN_REQUIRES_FOLLOWUP: "Uncertain — requires follow-up",
  UNFAVOURABLE: "Unfavourable",
};

const uncertaintyCategoryLabel: Record<PsurUncertaintyCategory, string> = {
  DATA_LIMITATIONS_UNDERREPORTING: "Data limitations or under-reporting",
  LIMITED_NIGERIAN_EXPOSURE: "Limited data on local (Nigerian) exposure",
  MISSING_SUBPOPULATION_DATA: "Missing subpopulation data",
  SHORT_FOLLOWUP_DURATION: "Short follow-up duration",
  STUDY_DESIGN_LIMITATIONS: "Study design limitations",
  LIMITED_GENERALISABILITY: "Limited generalisability of the studied population",
  OTHER: "Other",
};

const evidenceQualityLabel: Record<PsurEvidenceQuality, string> = {
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low",
  VERY_LOW: "Very low",
  NOT_ASSESSABLE: "Not assessable",
};

const sectionStatusLabel: Record<PsurSectionStatus, string> = {
  ADEQUATELY_ADDRESSED: "Adequately addressed",
  PRESENT_BUT_INCOMPLETE: "Present but incomplete",
  MISSING: "Missing",
  NOT_APPLICABLE: "Not applicable",
  ASSESSOR_PENDING: "Not yet assessed",
};

function sectionStatusTone(status: PsurSectionStatus): Tone {
  switch (status) {
    case "ADEQUATELY_ADDRESSED":
      return "success";
    case "PRESENT_BUT_INCOMPLETE":
      return "warning";
    case "MISSING":
      return "critical";
    case "NOT_APPLICABLE":
      return "neutral";
    case "ASSESSOR_PENDING":
    default:
      return "info";
  }
}

const specialPopulationAreaLabel: Record<PsurSpecialPopulationArea, string> = {
  PREGNANCY_LACTATION: "Pregnancy & lactation",
  PAEDIATRIC: "Paediatric population",
  GERIATRIC: "Geriatric population",
  HEPATIC_IMPAIRMENT: "Hepatic impairment",
  RENAL_IMPAIRMENT: "Renal impairment",
  OVERDOSE_MISUSE_ABUSE_MEDICATION_ERROR: "Overdose / misuse / abuse / medication error",
  OFF_LABEL_USE: "Off-label use",
  OTHER_MISSING_INFORMATION: "Other missing information",
};

const SPECIAL_POPULATION_AREAS = Object.keys(
  specialPopulationAreaLabel,
) as PsurSpecialPopulationArea[];

function assessmentTone(status: PsurFinding["humanAssessment"]): Tone {
  if (status === "ACCEPTED") return "success";
  if (status === "DISMISSED") return "neutral";
  return "warning";
}

function PsurPage() {
  const docs = usePvQuery(
    ["psur", "documents"],
    () => psurApi.documents(),
    () => demoPsurDocuments,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const activeDoc = (docs.data?.data ?? []).find((d) => d.id === selected) ?? docs.data?.data?.[0];
  const findings = usePvQuery(
    ["psur", "findings", activeDoc?.id ?? "none"],
    async () => (await psurApi.review(activeDoc!.id)).findings,
    () => demoPsurFindings,
  );
  const [uploading, setUploading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [docsPage, setDocsPage] = useState(1);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  return (
    <>
      <PageHeader
        title="PSUR / PBRER review"
        description="Review assistance for periodic safety reports, primarily powered by OpenAI with deterministic checks as a fallback. Findings support a reviewer — they are not a regulatory assessment."
        meta={
          <>
            <AssistLabel>Review assistance — human assessment required</AssistLabel>
            {docs.data ? <SourceTag source={docs.data.source} /> : null}
          </>
        }
      />

      <div className="space-y-4 p-6">
        <Section title="Review flow">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-muted-foreground">
                  {s}
                </span>
                {i < FLOW.length - 1 ? (
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="Upload a periodic report"
          description="PDF narrative report, or an XLSX/CSV cumulative summary tabulation. AI review runs automatically on upload."
        >
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">
              {uploading ? "Uploading and reviewing…" : "Choose a PDF, XLSX or CSV"}
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf,.xlsx,.xls,.csv"
              className="sr-only"
              disabled={uploading}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                // Clear immediately so the element never retains this
                // File — a stray later event on the same input could
                // otherwise silently resubmit it as a second upload.
                e.target.value = "";
                if (!f) return;
                setUploading(true);
                try {
                  const doc = await psurApi.upload(f);
                  toast.success(
                    doc.stage === "REVIEWED"
                      ? "Document uploaded and reviewed."
                      : "Document uploaded.",
                  );
                  setDocsPage(1);
                  docs.refetch();
                } catch (err) {
                  toast.error(
                    isNotConfigured(err)
                      ? "Backend not connected — the document was not uploaded."
                      : "Upload failed.",
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </Section>

        <Section title="Documents">
          <QueryBoundary query={docs}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState
                  title="No documents"
                  description="Upload a PSUR/PBRER to begin a review."
                />
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {paginate(items, docsPage).map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                        <span className="text-sm font-medium">{d.filename}</span>
                        <StatusPill tone="neutral">{d.product}</StatusPill>
                        <StatusPill tone="info">{d.reportingPeriod}</StatusPill>
                        <StatusPill
                          tone={
                            d.stage === "FAILED"
                              ? "critical"
                              : d.stage === "REVIEWED"
                                ? "success"
                                : "info"
                          }
                        >
                          {/* "REVIEWED" means the AI pass has run and
                              generated findings — not that a human has
                              accepted/dismissed them yet. Spelled out here
                              since "reviewed" alone reads as the latter. */}
                          {d.stage === "REVIEWED" ? "AI reviewed" : d.stage.toLowerCase()}
                        </StatusPill>
                        <span className="mono-num text-xs text-muted-foreground">
                          {d.pages} {d.sourceType === "SPREADSHEET" ? "case rows" : "pages"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          onClick={() => setSelected(d.id)}
                        >
                          Open review
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Pager page={docsPage} total={items.length} onPageChange={setDocsPage} />
                </>
              )
            }
          </QueryBoundary>
        </Section>

        {activeDoc ? (
          <>
            <Section title="Document metadata">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="File" value={activeDoc.filename} />
                <Field label="Product" value={activeDoc.product} />
                <Field label="Reporting period" value={activeDoc.reportingPeriod} />
                <Field
                  label="Uploaded by"
                  value={`${activeDoc.uploadedBy} · ${activeDoc.uploadedAt.slice(0, 10)}`}
                />
              </div>
            </Section>

            <AdministrativeScreeningPanel
              key={`screening-${activeDoc.id}`}
              doc={activeDoc}
              findings={findings.data?.data ?? []}
              onChanged={() => docs.refetch()}
            />

            <Section
              title="Review findings"
              description="Missing sections, consistency issues, numerical discrepancies, signal-related items and benefit-risk areas requiring attention."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {findings.data ? <SourceTag source={findings.data.source} /> : null}
                  {AUTO_FIX_ENABLED ? (
                    <QueryBoundary query={findings}>
                      {(items) => {
                        const acceptedCount = items.filter(
                          (f) => f.humanAssessment === "ACCEPTED",
                        ).length;
                        if (acceptedCount === 0) return null;
                        return (
                          <>
                            <Button
                              size="sm"
                              disabled={fixing}
                              onClick={async () => {
                                setFixing(true);
                                try {
                                  const result = await psurApi.runFullFix(activeDoc.id);
                                  if (!result.aiUsed) {
                                    toast.error(
                                      result.aiError ??
                                        "AI fix unavailable — no changes were made.",
                                    );
                                  } else {
                                    toast.success(
                                      `${result.resolvedCount} finding(s) resolved.${result.unresolvedCount ? ` ${result.unresolvedCount} left unresolved.` : ""}`,
                                    );
                                  }
                                  findings.refetch();
                                  docs.refetch();
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "Run Full Fix failed.",
                                  );
                                } finally {
                                  setFixing(false);
                                }
                              }}
                            >
                              <Wrench className="size-4" />{" "}
                              {fixing ? "Fixing with AI…" : `Run Full Fix (${acceptedCount})`}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  await psurApi.downloadFixedDocument(activeDoc.id);
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Could not download this file.",
                                  );
                                }
                              }}
                            >
                              <Download className="size-4" /> Download Fixed Document (Word)
                            </Button>
                          </>
                        );
                      }}
                    </QueryBoundary>
                  ) : null}
                  {activeDoc.stage === "REVIEWED" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await psurApi.downloadExecutiveSummary(activeDoc.id);
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Could not download the summary.",
                            );
                          }
                        }}
                      >
                        <FileText className="size-4" /> Download Executive Summary (Word)
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await psurApi.downloadExecutiveSummaryText(activeDoc.id);
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Could not download the summary.",
                            );
                          }
                        }}
                      >
                        Plain text
                      </Button>
                    </>
                  ) : null}
                  {activeDoc.stage === "REVIEWED" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await psurApi.downloadComplianceDirective(activeDoc.id);
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Could not download the summary.",
                            );
                          }
                        }}
                      >
                        <FileText className="size-4" /> Download Compliance Directive (Word)
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await psurApi.downloadComplianceDirectiveText(activeDoc.id);
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Could not download the summary.",
                            );
                          }
                        }}
                      >
                        Plain text
                      </Button>
                    </>
                  ) : null}
                </div>
              }
            >
              <QueryBoundary query={findings} loadingLabel="Analysing document">
                {(items) =>
                  items.length === 0 ? (
                    <EmptyState title="No findings returned" />
                  ) : (
                    <ul className="space-y-3">
                      {items.map((f) => (
                        <li key={f.id} className="rounded-md border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={categoryTone[f.category]}>
                              {f.category.replaceAll("_", " ").toLowerCase()}
                            </StatusPill>
                            <StatusPill
                              tone={
                                f.severity === "HIGH"
                                  ? "critical"
                                  : f.severity === "MEDIUM"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {f.severity.toLowerCase()} severity
                            </StatusPill>
                            <span className="text-sm font-medium">{f.section}</span>
                            {f.v4Section ? (
                              <StatusPill tone="neutral">
                                {v4SectionLabel.get(f.v4Section) ?? f.v4Section}
                              </StatusPill>
                            ) : null}
                            {f.deficiencyType ? (
                              <StatusPill tone="warning">
                                {deficiencyTypeLabel[f.deficiencyType]}
                              </StatusPill>
                            ) : null}
                            <StatusPill tone={f.source === "ai" ? "assist" : "neutral"}>
                              {f.source === "ai" ? "AI" : "rule"}
                            </StatusPill>
                            {f.assistGenerated ? (
                              <AssistLabel>AI-generated review assistance</AssistLabel>
                            ) : null}
                            {f.humanAssessment ? (
                              <StatusPill tone={assessmentTone(f.humanAssessment)}>
                                {f.humanAssessment.toLowerCase()}
                              </StatusPill>
                            ) : null}
                            {f.suggestedSource?.type === "REQUEST_FROM_MAH" ? (
                              <StatusPill tone="critical">Needs MAH response</StatusPill>
                            ) : (
                              <StatusPill tone="neutral">
                                Assessor can resolve internally
                              </StatusPill>
                            )}
                          </div>
                          <p className="mt-2 text-sm">{f.description}</p>
                          <p className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                            {f.evidence}
                          </p>
                          {f.suggestedSource ? (
                            <p className="mt-2 rounded-md border border-info/30 bg-info-soft px-2 py-1.5 text-xs text-foreground">
                              <span className="font-medium">
                                Suggested source: {suggestedSourceLabel[f.suggestedSource.type]}
                              </span>
                              {" — "}
                              {f.suggestedSource.note}
                            </p>
                          ) : null}
                          {f.humanAssessment === "ACCEPTED" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Accepted as a valid deficiency —{" "}
                              {f.resolved ? "resolved" : "still outstanding"} until a resolution is
                              recorded. Accepting a finding does not by itself mean the underlying
                              deficiency has been fixed.
                            </p>
                          ) : null}
                          {f.humanAssessment === "DISMISSED" && f.rationale ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Dismissed by {f.respondedBy ?? "reviewer"}: {f.rationale}
                            </p>
                          ) : null}
                          {f.resolution ? (
                            <p className="mt-2 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
                              <span className="font-medium">
                                {f.resolved ? "Resolution: " : "Unresolved: "}
                              </span>
                              {f.resolution}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={f.humanAssessment === "ACCEPTED" ? "default" : "outline"}
                              onClick={async () => {
                                try {
                                  await psurApi.recordAssessment(
                                    activeDoc.id,
                                    f.id,
                                    "ACCEPTED",
                                    "Confirmed by reviewer",
                                  );
                                  toast.success("Assessment recorded.");
                                  findings.refetch();
                                } catch (err) {
                                  toast.error(
                                    isNotConfigured(err)
                                      ? "Backend not connected — the assessment was not recorded."
                                      : "Could not record the assessment.",
                                  );
                                }
                              }}
                            >
                              Accept finding
                            </Button>
                            <Button
                              size="sm"
                              variant={f.humanAssessment === "DISMISSED" ? "default" : "ghost"}
                              onClick={() => {
                                setDismissingId(f.id);
                                setDismissReason("");
                              }}
                            >
                              Dismiss
                            </Button>
                          </div>
                          {dismissingId === f.id ? (
                            <div className="mt-3 space-y-2 rounded-md border border-border p-2">
                              <Textarea
                                autoFocus
                                placeholder="Reason for dismissing this finding (required — e.g. 'not applicable to this product', 'already covered under Section 4')"
                                value={dismissReason}
                                onChange={(e) => setDismissReason(e.target.value)}
                                rows={2}
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={!dismissReason.trim()}
                                  onClick={async () => {
                                    try {
                                      await psurApi.recordAssessment(
                                        activeDoc.id,
                                        f.id,
                                        "DISMISSED",
                                        dismissReason.trim(),
                                      );
                                      toast.success("Assessment recorded.");
                                      setDismissingId(null);
                                      findings.refetch();
                                    } catch (err) {
                                      toast.error(
                                        isNotConfigured(err)
                                          ? "Backend not connected — the assessment was not recorded."
                                          : "Could not record the assessment.",
                                      );
                                    }
                                  }}
                                >
                                  Confirm dismissal
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDismissingId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )
                }
              </QueryBoundary>
            </Section>

            {activeDoc.sourceType !== "SPREADSHEET" ? (
              <SpecialPopulationsPanel
                key={`special-populations-${activeDoc.id}`}
                doc={activeDoc}
                onChanged={() => docs.refetch()}
              />
            ) : null}

            {activeDoc.sourceType !== "SPREADSHEET" ? (
              <BenefitRiskPanel
                key={`benefit-risk-${activeDoc.id}`}
                doc={activeDoc}
                onChanged={() => docs.refetch()}
              />
            ) : null}

            <UncertaintiesPanel
              key={`uncertainties-${activeDoc.id}`}
              doc={activeDoc}
              onChanged={() => docs.refetch()}
            />

            <RegulatoryDecisionPanel
              key={`regdecision-${activeDoc.id}`}
              doc={activeDoc}
              onChanged={() => docs.refetch()}
            />

            <SignOffPanel
              key={`signoff-${activeDoc.id}`}
              doc={activeDoc}
              onChanged={() => docs.refetch()}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

/** Administrative Completeness Check — runs before scientific review, per
 *  the V4 template's own instruction. Shows the AI's checks/coverage and
 *  recommendation, and lets the assessor record their OWN decision on
 *  whether to proceed — the AI's recommendation never governs on its own. */
function AdministrativeScreeningPanel({
  doc,
  findings,
  onChanged,
}: {
  doc: PsurDocument;
  findings: PsurFinding[];
  onChanged: () => void;
}) {
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const screening = doc.screening;

  if (!screening) return null;

  // The ONE authoritative view — folds in Sections 9-13's own richer
  // data instead of trusting a second, independent AI guess for them.
  // Every other panel on this page, plus the executive summary and
  // compliance directive, reads through this exact same function.
  const coverage = buildAuthoritativeSectionCoverage(doc);
  const findingsBySection = new Map<PsurV4SectionId, PsurFinding[]>();
  for (const f of findings) {
    if (!f.v4Section) continue;
    const list = findingsBySection.get(f.v4Section) ?? [];
    list.push(f);
    findingsBySection.set(f.v4Section, list);
  }

  const override = screening.humanOverride;

  async function decide(decision: "PROCEED_TO_SCIENTIFIC_REVIEW" | "RETURN_TO_MAH_FIRST") {
    setSubmitting(true);
    try {
      await psurApi.recordScreeningOverride(
        doc.id,
        decision,
        rationale || "Assessor decision recorded.",
      );
      toast.success("Screening decision recorded.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the decision.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section
      title="Administrative Completeness Check"
      description="Runs before detailed scientific review, per the V4 template. This is a recommendation for the assessor — it never automatically accepts or rejects a submission."
    >
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {screening.administrativeChecks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill
                tone={c.status === "YES" ? "success" : c.status === "NO" ? "critical" : "neutral"}
              >
                {c.status.replaceAll("_", " ").toLowerCase()}
              </StatusPill>
              <span className="font-medium">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.comment}</span>
            </li>
          ))}
        </ul>

        <details className="rounded-md border border-border p-2 text-sm" open>
          <summary className="cursor-pointer font-medium">
            Section coverage (
            {
              coverage.filter(
                (s) => s.status === "ADEQUATELY_ADDRESSED" || s.status === "NOT_APPLICABLE",
              ).length
            }
            /{PSUR_V4_TEMPLATE_SECTIONS.length} sections resolved)
          </summary>
          <ul className="mt-2 space-y-1.5">
            {coverage.map((s) => {
              const related = findingsBySection.get(s.section) ?? [];
              return (
                <li
                  key={s.section}
                  className="rounded-md border border-border/60 px-2 py-1.5 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={sectionStatusTone(s.status)}>
                      {sectionStatusLabel[s.status]}
                    </StatusPill>
                    <span className="font-medium">
                      {v4SectionLabel.get(s.section) ?? s.section}
                    </span>
                    <StatusPill tone={s.source === "assessor" ? "success" : "assist"}>
                      {s.source === "assessor" ? "assessor" : s.source === "rule" ? "rule" : "AI"}
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.comment}</p>
                  {s.notApplicableJustification ? (
                    <p className="mt-1 text-muted-foreground">
                      <span className="font-medium">Justification: </span>
                      {s.notApplicableJustification}
                    </p>
                  ) : null}
                  {(s.status === "MISSING" || s.status === "PRESENT_BUT_INCOMPLETE") && (
                    <p className="mt-1">
                      {related.length > 0 ? (
                        <span className="text-foreground">
                          → {related.length} related finding{related.length === 1 ? "" : "s"} below:{" "}
                          <span className="text-muted-foreground">{related[0]!.description}</span>
                        </span>
                      ) : (
                        <span className="text-critical">
                          → No corresponding finding yet — this should not happen; see Review
                          Findings below.
                        </span>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">AI recommendation:</span>
          <StatusPill
            tone={
              screening.recommendation === "PROCEED_TO_SCIENTIFIC_REVIEW" ? "success" : "critical"
            }
          >
            {screening.recommendation.replaceAll("_", " ").toLowerCase()}
          </StatusPill>
        </div>

        {override ? (
          <p className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs">
            <span className="font-medium">
              Assessor decision: {override.decision.replaceAll("_", " ").toLowerCase()}
            </span>
            {" — "}
            {override.rationale} ({override.by}, {override.at.slice(0, 16).replace("T", " ")} UTC)
          </p>
        ) : (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Textarea
              placeholder="Rationale for your screening decision (required for an informed record)"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => decide("PROCEED_TO_SCIENTIFIC_REVIEW")}
              >
                Proceed to scientific review
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => decide("RETURN_TO_MAH_FIRST")}
              >
                Return to MAH first
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function newSpecialPopulationItems(): PsurSpecialPopulationItem[] {
  return SPECIAL_POPULATION_AREAS.map((area) => ({
    area,
    status: "ASSESSOR_PENDING",
    comment: "",
    source: "assessor",
  }));
}

/** Section 9 — Special Populations, Special Situations & Missing
 *  Information. Fixed set of 8 areas (never free-add/remove, since the
 *  template requires every submission to be judged against the SAME
 *  areas) — displays the AI's best-effort per-area assessment and lets
 *  the assessor correct it or explicitly mark an area NOT_APPLICABLE with
 *  a justification. The coarse S9 section-coverage status shown in
 *  Administrative Completeness is DERIVED from these 8 items, so editing
 *  here is what actually moves that status. */
function SpecialPopulationsPanel({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const [items, setItems] = useState<PsurSpecialPopulationItem[]>(
    doc.specialPopulations && doc.specialPopulations.length > 0
      ? doc.specialPopulations
      : newSpecialPopulationItems(),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await psurApi.updateSpecialPopulations(doc.id, items);
      toast.success("Special populations assessment saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="9. Special Populations, Special Situations & Missing Information"
      description="Every area must be either adequately addressed, present but incomplete, missing, or explicitly marked not applicable with a justification — never left ambiguous."
      actions={
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save special populations"}
        </Button>
      }
    >
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.area} className="space-y-2 rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-56 text-sm font-medium">
                {specialPopulationAreaLabel[item.area]}
              </span>
              <Select
                value={item.status}
                onValueChange={(v) =>
                  setItems((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, status: v as PsurSectionStatus, source: "assessor" } : x,
                    ),
                  )
                }
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(sectionStatusLabel) as PsurSectionStatus[])
                    .filter((s) => s !== "ASSESSOR_PENDING")
                    .map((s) => (
                      <SelectItem key={s} value={s}>
                        {sectionStatusLabel[s]}
                      </SelectItem>
                    ))}
                  <SelectItem value="ASSESSOR_PENDING">Not yet assessed</SelectItem>
                </SelectContent>
              </Select>
              <StatusPill tone={item.source === "assessor" ? "success" : "assist"}>
                {item.source === "assessor" ? "assessor" : item.source === "rule" ? "rule" : "AI"}
              </StatusPill>
            </div>
            <Textarea
              placeholder="Comment — what the submission says (or doesn't say) about this area"
              value={item.comment}
              rows={2}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((x, j) =>
                    j === i ? { ...x, comment: e.target.value, source: "assessor" } : x,
                  ),
                )
              }
            />
            {item.status === "NOT_APPLICABLE" ? (
              <Textarea
                placeholder="Justification (required) — why this area genuinely does not apply"
                value={item.notApplicableJustification ?? ""}
                rows={2}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? { ...x, notApplicableJustification: e.target.value, source: "assessor" }
                        : x,
                    ),
                  )
                }
              />
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Section 10 — Benefit-Risk Assessment. Displays the AI's best-effort
 *  extraction (never fabricated — entries the text didn't support are
 *  simply absent/NOT_ASSESSABLE) and lets the assessor edit every field
 *  directly; saving marks the record as assessor-owned. */
function BenefitRiskPanel({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const empty: PsurBenefitRiskAssessment = {
    keyBenefits: [],
    keyRisks: [],
    missingInformation: [],
    integratedEffectsTable: [],
    patientHcpPerspective: { available: false, summary: "" },
    riskMinimisationEffectiveness: { outcome: "NOT_ASSESSABLE", comment: "" },
    assistGenerated: true,
  };
  const [data, setData] = useState<PsurBenefitRiskAssessment>(doc.benefitRisk ?? empty);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await psurApi.updateBenefitRisk(doc.id, data);
      toast.success("Benefit-risk assessment saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="10. Benefit-Risk Assessment"
      description="Key benefits and risks, the integrated effects table, patient/HCP perspective, and risk-minimisation effectiveness. Edit anything the AI extraction got wrong or missed."
      actions={
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save benefit-risk assessment"}
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="label-caps mb-2">10.1 Key benefits</p>
          {data.keyBenefits.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No key benefits recorded — the source text didn't support extracting any, or none have
              been added yet.
            </p>
          ) : null}
          <div className="space-y-2">
            {data.keyBenefits.map((b, i) => (
              <div
                key={b.id}
                className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-4"
              >
                <Input
                  placeholder="Benefit"
                  value={b.benefit}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      keyBenefits: d.keyBenefits.map((x, j) =>
                        j === i ? { ...x, benefit: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Input
                  placeholder="Evidence source"
                  value={b.evidenceSource}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      keyBenefits: d.keyBenefits.map((x, j) =>
                        j === i ? { ...x, evidenceSource: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Input
                  placeholder="Magnitude"
                  value={b.magnitude}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      keyBenefits: d.keyBenefits.map((x, j) =>
                        j === i ? { ...x, magnitude: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Select
                  value={b.evidenceQuality}
                  onValueChange={(v) =>
                    setData((d) => ({
                      ...d,
                      keyBenefits: d.keyBenefits.map((x, j) =>
                        j === i ? { ...x, evidenceQuality: v as PsurEvidenceQuality } : x,
                      ),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(evidenceQualityLabel) as PsurEvidenceQuality[]).map((q) => (
                      <SelectItem key={q} value={q}>
                        {evidenceQualityLabel[q]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() =>
              setData((d) => ({
                ...d,
                keyBenefits: [
                  ...d.keyBenefits,
                  {
                    id: `krb-${Date.now()}`,
                    benefit: "",
                    evidenceSource: "",
                    magnitude: "",
                    evidenceQuality: "NOT_ASSESSABLE",
                  },
                ],
              }))
            }
          >
            Add key benefit
          </Button>
        </div>

        <div>
          <p className="label-caps mb-2">10.2 Key risks</p>
          {data.keyRisks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No key risks recorded yet.</p>
          ) : null}
          <div className="space-y-2">
            {data.keyRisks.map((r, i) => (
              <div key={r.id} className="space-y-2 rounded-md border border-border p-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select
                    value={r.kind}
                    onValueChange={(v) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, kind: v as PsurKeyRisk["kind"] } : x,
                        ),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IDENTIFIED">Important identified risk</SelectItem>
                      <SelectItem value="POTENTIAL">Important potential risk</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Risk"
                    value={r.risk}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, risk: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Input
                    placeholder="Severity"
                    value={r.severity}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, severity: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Frequency"
                    value={r.frequency}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, frequency: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Input
                    placeholder="Frequency data source (mandatory per template)"
                    value={r.frequencyDataSource}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, frequencyDataSource: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="Reversibility"
                    value={r.reversibility}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, reversibility: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Input
                    placeholder="Duration"
                    value={r.duration}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, duration: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Input
                    placeholder="Preventability / risk management"
                    value={r.preventabilityRiskManagement}
                    onChange={(e) =>
                      setData((d) => ({
                        ...d,
                        keyRisks: d.keyRisks.map((x, j) =>
                          j === i ? { ...x, preventabilityRiskManagement: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                </div>
                <Textarea
                  placeholder="Comment"
                  value={r.comment}
                  rows={2}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      keyRisks: d.keyRisks.map((x, j) =>
                        j === i ? { ...x, comment: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() =>
              setData((d) => ({
                ...d,
                keyRisks: [
                  ...d.keyRisks,
                  {
                    id: `krk-${Date.now()}`,
                    kind: "POTENTIAL",
                    risk: "",
                    severity: "",
                    frequency: "",
                    frequencyDataSource: "",
                    reversibility: "",
                    duration: "",
                    preventabilityRiskManagement: "",
                    comment: "",
                  },
                ],
              }))
            }
          >
            Add key risk
          </Button>
        </div>

        <div>
          <p className="label-caps mb-2">10.2 Missing information</p>
          {data.missingInformation.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No missing-information items recorded yet.
            </p>
          ) : null}
          <div className="space-y-2">
            {data.missingInformation.map((m, i) => (
              <div
                key={m.id}
                className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-2"
              >
                <Textarea
                  placeholder="Missing information"
                  value={m.missingInformation}
                  rows={2}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      missingInformation: d.missingInformation.map((x, j) =>
                        j === i ? { ...x, missingInformation: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Textarea
                  placeholder="Risk-minimisation implication"
                  value={m.riskMinimisationImplication}
                  rows={2}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      missingInformation: d.missingInformation.map((x, j) =>
                        j === i ? { ...x, riskMinimisationImplication: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() =>
              setData((d) => ({
                ...d,
                missingInformation: [
                  ...d.missingInformation,
                  {
                    id: `mi-${Date.now()}`,
                    missingInformation: "",
                    riskMinimisationImplication: "",
                  },
                ],
              }))
            }
          >
            Add missing-information item
          </Button>
        </div>

        <div>
          <p className="label-caps mb-2">10.3 Integrated Benefit-Risk Effects Table</p>
          <div className="space-y-2">
            {data.integratedEffectsTable.map((row, i) => (
              <div key={`${row.dimension}-${i}`} className="rounded-md border border-border p-2">
                <p className="text-xs font-medium">{row.dimension.replaceAll("_", " ")}</p>
                <Textarea
                  className="mt-1"
                  placeholder="Evidence and uncertainty"
                  value={row.evidenceAndUncertainty}
                  rows={2}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      integratedEffectsTable: d.integratedEffectsTable.map((x, j) =>
                        j === i ? { ...x, evidenceAndUncertainty: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Textarea
                  className="mt-1"
                  placeholder="Reviewer conclusion"
                  value={row.reviewerConclusion}
                  rows={2}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      integratedEffectsTable: d.integratedEffectsTable.map((x, j) =>
                        j === i ? { ...x, reviewerConclusion: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </div>
            ))}
          </div>
          {data.integratedEffectsTable.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "CONDITION_UNMET_NEED",
                  "CURRENT_TREATMENT_OPTIONS",
                  "BENEFIT",
                  "RISK",
                  "RISK_MANAGEMENT",
                ] as const
              ).map((dim) => (
                <Button
                  key={dim}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setData((d) => ({
                      ...d,
                      integratedEffectsTable: [
                        ...d.integratedEffectsTable,
                        { dimension: dim, evidenceAndUncertainty: "", reviewerConclusion: "" },
                      ],
                    }))
                  }
                >
                  Add {dim.replaceAll("_", " ").toLowerCase()}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label-caps mb-2">10.4 Patient/HCP perspective</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={data.patientHcpPerspective.available}
                onCheckedChange={(c) =>
                  setData((d) => ({
                    ...d,
                    patientHcpPerspective: { ...d.patientHcpPerspective, available: !!c },
                  }))
                }
              />
              Available
            </label>
            <Textarea
              className="mt-2"
              placeholder="Summary (leave blank if unavailable — never fabricated)"
              value={data.patientHcpPerspective.summary}
              rows={2}
              onChange={(e) =>
                setData((d) => ({
                  ...d,
                  patientHcpPerspective: { ...d.patientHcpPerspective, summary: e.target.value },
                }))
              }
            />
          </div>
          <div>
            <p className="label-caps mb-2">10.5 Risk minimisation effectiveness</p>
            <Select
              value={data.riskMinimisationEffectiveness.outcome}
              onValueChange={(v) =>
                setData((d) => ({
                  ...d,
                  riskMinimisationEffectiveness: {
                    ...d.riskMinimisationEffectiveness,
                    outcome:
                      v as PsurBenefitRiskAssessment["riskMinimisationEffectiveness"]["outcome"],
                  },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_APPLICABLE">Not applicable</SelectItem>
                <SelectItem value="EFFECTIVE">Effective</SelectItem>
                <SelectItem value="PARTIALLY_EFFECTIVE">Partially effective</SelectItem>
                <SelectItem value="NOT_EFFECTIVE">Not effective</SelectItem>
                <SelectItem value="NOT_ASSESSABLE">Not assessable — insufficient data</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              className="mt-2"
              placeholder="Comment"
              value={data.riskMinimisationEffectiveness.comment}
              rows={2}
              onChange={(e) =>
                setData((d) => ({
                  ...d,
                  riskMinimisationEffectiveness: {
                    ...d.riskMinimisationEffectiveness,
                    comment: e.target.value,
                  },
                }))
              }
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

/** Section 11 — Uncertainties Affecting the Benefit-Risk Assessment. */
function UncertaintiesPanel({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const [items, setItems] = useState<PsurUncertainty[]>(doc.uncertainties ?? []);
  const [saving, setSaving] = useState(false);
  const noneConfirmed = doc.uncertaintiesNoneConfirmed;

  async function save(confirmNoneApply = false) {
    setSaving(true);
    try {
      await psurApi.updateUncertainties(doc.id, items, confirmNoneApply);
      toast.success(
        confirmNoneApply
          ? "Confirmed: no uncertainties apply this interval."
          : "Uncertainties saved.",
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="11. Uncertainties Affecting the Benefit-Risk Assessment"
      description="This section must not be left blank — if genuinely none apply this interval, say so explicitly rather than leaving it empty."
      actions={
        <Button size="sm" disabled={saving} onClick={() => save(false)}>
          {saving ? "Saving…" : "Save uncertainties"}
        </Button>
      }
    >
      <div className="space-y-2">
        {items.length === 0 && noneConfirmed ? (
          <p className="rounded-md border border-success/30 bg-success-soft px-2 py-1.5 text-xs">
            <span className="font-medium">Confirmed: no uncertainties apply this interval</span> —{" "}
            {noneConfirmed.by}, {noneConfirmed.at.slice(0, 16).replace("T", " ")} UTC.
          </p>
        ) : items.length === 0 ? (
          <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5 text-xs">
            <p>
              Section 11 is still outstanding — an empty list is not the same as "none apply." Add
              an uncertainty, or explicitly confirm none apply this interval.
            </p>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => save(true)}>
              Confirm no uncertainties apply this interval
            </Button>
          </div>
        ) : null}
        {items.map((u, i) => (
          <div key={u.id} className="space-y-2 rounded-md border border-border p-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <Select
                value={u.category}
                onValueChange={(v) =>
                  setItems((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, category: v as PsurUncertaintyCategory } : x,
                    ),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(uncertaintyCategoryLabel) as PsurUncertaintyCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {uncertaintyCategoryLabel[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={u.impactOnConclusion}
                onValueChange={(v) =>
                  setItems((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? { ...x, impactOnConclusion: v as PsurUncertainty["impactOnConclusion"] }
                        : x,
                    ),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Impact: Low</SelectItem>
                  <SelectItem value="MODERATE">Impact: Moderate</SelectItem>
                  <SelectItem value="HIGH">Impact: High</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={u.addressedByMah}
                onValueChange={(v) =>
                  setItems((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? { ...x, addressedByMah: v as PsurUncertainty["addressedByMah"] }
                        : x,
                    ),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">Addressed by MAH: Yes</SelectItem>
                  <SelectItem value="PARTIALLY">Addressed by MAH: Partially</SelectItem>
                  <SelectItem value="NO">Addressed by MAH: No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Description"
              value={u.description}
              rows={2}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                )
              }
            />
            <Textarea
              placeholder="Rationale (mandatory — tie to this specific uncertainty)"
              value={u.rationale}
              rows={2}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, rationale: e.target.value } : x)),
                )
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setItems((prev) => [
              ...prev,
              {
                id: `unc-${Date.now()}`,
                category: "OTHER",
                description: "",
                impactOnConclusion: "MODERATE",
                addressedByMah: "NO",
                rationale: "",
              },
            ])
          }
        >
          Add uncertainty
        </Button>
      </div>
    </Section>
  );
}

/** Section 12 — Regulatory Decision & Recommended Actions. The AI's
 *  suggestion (document.aiRecommendation) is shown as a clearly-labelled,
 *  non-binding starting point; the assessor's own decision is a
 *  structurally separate field the assessor must set explicitly. */
function RegulatoryDecisionPanel({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const [actions, setActions] = useState<PsurRiskMinimisationAction[]>(
    doc.regulatoryDecision?.actions ?? [],
  );
  const [outcome, setOutcome] = useState<PsurOverallBenefitRiskOutcome | undefined>(
    doc.regulatoryDecision?.overallOutcome,
  );
  const [basis, setBasis] = useState(doc.regulatoryDecision?.basis ?? "");
  const [nextDue, setNextDue] = useState(doc.regulatoryDecision?.nextPsurDueDate ?? "");
  const [followUp, setFollowUp] = useState(doc.regulatoryDecision?.followUpRequired ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await psurApi.updateRegulatoryDecision(doc.id, {
        actions,
        overallOutcome: outcome,
        basis,
        nextPsurDueDate: nextDue || undefined,
        followUpRequired: followUp || undefined,
      });
      toast.success("Regulatory decision recorded.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="12. Regulatory Decision & Recommended Actions"
      description="The assessor's own decision — the AI never makes a binding regulatory recommendation on its own."
      actions={
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save regulatory decision"}
        </Button>
      }
    >
      <div className="space-y-4">
        {doc.aiRecommendation ? (
          <div className="rounded-md border border-info/30 bg-info-soft p-3 text-sm">
            <p className="font-medium">AI suggestion (non-binding — the assessor decides)</p>
            <p className="mt-1 text-xs">
              {doc.aiRecommendation.overallOutcome
                ? overallOutcomeLabel[doc.aiRecommendation.overallOutcome]
                : "No outcome suggested"}
              {doc.aiRecommendation.actions.length > 0
                ? ` — ${doc.aiRecommendation.actions.map((a) => riskMinimisationActionLabel[a]).join("; ")}`
                : ""}
            </p>
            {doc.aiRecommendation.basis ? (
              <p className="mt-1 text-xs text-muted-foreground">{doc.aiRecommendation.basis}</p>
            ) : null}
          </div>
        ) : null}

        <div>
          <p className="label-caps mb-2">Risk minimisation considerations</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(riskMinimisationActionLabel) as PsurRiskMinimisationAction[]).map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={actions.includes(a)}
                  onCheckedChange={(c) =>
                    setActions((prev) => (c ? [...prev, a] : prev.filter((x) => x !== a)))
                  }
                />
                {riskMinimisationActionLabel[a]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="label-caps mb-2">Overall benefit-risk outcome</p>
          <Select
            value={outcome ?? ""}
            onValueChange={(v) => setOutcome(v as PsurOverallBenefitRiskOutcome)}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Not yet decided" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(overallOutcomeLabel) as PsurOverallBenefitRiskOutcome[]).map((o) => (
                <SelectItem key={o} value={o}>
                  {overallOutcomeLabel[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Textarea
          placeholder="Regulatory action recommended and basis for the recommendation above"
          value={basis}
          rows={3}
          onChange={(e) => setBasis(e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label-caps mb-1">Next PSUR/PBRER due date</p>
            <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </div>
          <div>
            <p className="label-caps mb-1">Follow-up information required/deadline</p>
            <Input value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </div>
        </div>

        {doc.regulatoryDecision ? (
          <p className="text-xs text-muted-foreground">
            Last recorded by {doc.regulatoryDecision.decidedBy} on{" "}
            {doc.regulatoryDecision.decidedAt.slice(0, 16).replace("T", " ")} UTC.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/** Section 13 — Conclusion, Sign-off & Document Control. Pure assessor
 *  input; never AI-generated. */
function SignOffPanel({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const [signOff, setSignOff] = useState<PsurSignOff>(
    doc.signOff ?? { conclusion: "", reviewerConfidence: undefined, references: "" },
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await psurApi.updateSignOff(doc.id, signOff);
      toast.success("Sign-off recorded.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="13. Conclusion, Sign-off & Document Control"
      description="Pure assessor input — never generated by the AI."
      actions={
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save sign-off"}
        </Button>
      }
    >
      <div className="space-y-3">
        <Textarea
          placeholder="Overall conclusion, referencing the outcome selected in Section 12 and the key drivers from Section 10"
          value={signOff.conclusion}
          rows={3}
          onChange={(e) => setSignOff((s) => ({ ...s, conclusion: e.target.value }))}
        />
        <div>
          <p className="label-caps mb-2">Reviewer confidence in this conclusion</p>
          <Select
            value={signOff.reviewerConfidence ?? ""}
            onValueChange={(v) =>
              setSignOff((s) => ({
                ...s,
                reviewerConfidence: v as PsurSignOff["reviewerConfidence"],
              }))
            }
          >
            <SelectTrigger className="w-96">
              <SelectValue placeholder="Not yet set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HIGH">
                High — robust literature review, exposure and safety data
              </SelectItem>
              <SelectItem value="MEDIUM">Medium — some important uncertainties</SelectItem>
              <SelectItem value="LOW">
                Low — substantial missing information/limited or no exposure
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Textarea
          placeholder="References"
          value={signOff.references}
          rows={2}
          onChange={(e) => setSignOff((s) => ({ ...s, references: e.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label-caps mb-1">Evaluator's name and signature</p>
            <Input
              value={signOff.evaluatorName ?? ""}
              onChange={(e) => setSignOff((s) => ({ ...s, evaluatorName: e.target.value }))}
            />
            {signOff.evaluatorSignedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Signed {signOff.evaluatorSignedAt.slice(0, 16).replace("T", " ")} UTC
              </p>
            ) : null}
          </div>
          <div>
            <p className="label-caps mb-1">Peer reviewed by (name and signature)</p>
            <Input
              value={signOff.peerReviewerName ?? ""}
              onChange={(e) => setSignOff((s) => ({ ...s, peerReviewerName: e.target.value }))}
            />
            {signOff.peerReviewedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Signed {signOff.peerReviewedAt.slice(0, 16).replace("T", " ")} UTC
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
  );
}
