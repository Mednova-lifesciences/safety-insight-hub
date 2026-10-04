import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Section, StatusPill, type Tone } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRole } from "@/lib/auth";
import { psur as psurApi } from "@/services/api/psur";
import { ai, type AiPsurResearchCandidate, type AiPsurResearchResponse } from "@/services/api/ai";
import { currentActor } from "@/services/api/db";
import {
  MEMO_CRITERIA,
  MEMO_REFERENCE_PREFIX,
  factualCriteria,
} from "@/services/psur/assessment-memo";
import {
  bandFor,
  matrixTotals,
  proposeVerdict,
  PROVISIONAL_CIOMS_RUBRIC,
} from "@/services/psur/cioms";
import {
  EVIDENCE_CRITERIA,
  RESEARCHABLE_CRITERIA,
  defaultMemoDraft,
  defaultSourceType,
  emptyCiomsMatrix,
  evidenceForCriterion,
  homeSection,
  memoBlockers,
  memoWarnings,
  searchSubstance,
  verdictFromSection12,
  submissionDetailsOf,
  type EvidenceStatus,
} from "@/services/psur/memo-draft";
import { canEditCiomsMatrix } from "@/services/psur/workflow";
import { defaultFieldForCriterion, type V4FieldId } from "@/services/psur/v4-fields";
import { V4FieldSelect } from "@/components/pv/v4-field-select";
import type {
  AssessmentMemoDraft,
  CiomsMatrix,
  CiomsScoreRow,
  EvidenceEntry,
  EvidenceSourceType,
  MemoAnswers,
  MemoCriterionId,
  PsurDocument,
} from "@/types/pv";

const SOURCE_TYPE_LABEL: Record<EvidenceSourceType, string> = {
  VIGIFLOW_NIGERIA: "VigiFlow (Nigeria)",
  PUBLISHED_LITERATURE: "Published literature",
  REFERENCE_SAFETY_INFORMATION: "Reference safety information",
  WORLDWIDE_REGULATORY_ACTIONS: "Worldwide regulatory actions",
  PATIENT_HCP_FEEDBACK: "Patient / HCP feedback",
  RISK_MANAGEMENT_PLAN: "Risk management plan",
  SUBMITTED_PSUR: "The submitted PSUR",
  OTHER: "Other",
};

const STATUS_TONE: Record<EvidenceStatus, Tone> = {
  ACCEPTED: "success",
  CANDIDATE: "warning",
  REJECTED: "neutral",
  SUPERSEDED: "neutral",
  WITHDRAWN: "neutral",
};

const STATUS_LABEL: Record<EvidenceStatus, string> = {
  ACCEPTED: "Accepted",
  CANDIDATE: "Candidate — not in the memo until accepted",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
  WITHDRAWN: "Withdrawn — its finding was reopened",
};

const SCORE_ROWS: { key: keyof CiomsScoreRow; label: string }[] = [
  { key: "seriousness", label: "Seriousness" },
  { key: "duration", label: "Duration" },
  { key: "incidence", label: "Incidence" },
];

function criterionLabel(id: MemoCriterionId): string {
  const c = MEMO_CRITERIA.find((x) => x.id === id)!;
  return `${c.number}. ${c.label}`;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** A citation is shown as a link when it carries one, else as text. */
function CitationText({ citation }: { citation: string }) {
  const url = citation.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,;]+$/, "");
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Source: </span>
      {citation}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-1 inline-flex items-center gap-0.5 text-info underline"
        >
          open <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

function YesNo({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: "Yes" | "No" | undefined;
  disabled: boolean;
  onChange: (v: "Yes" | "No" | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {(["Yes", "No"] as const).map((v) => (
        <Button
          key={v}
          type="button"
          size="sm"
          variant={value === v ? "default" : "outline"}
          disabled={disabled}
          aria-pressed={value === v}
          onClick={() => onChange(value === v ? undefined : v)}
        >
          {v}
        </Button>
      ))}
    </div>
  );
}

function EvidenceItem({
  doc,
  criterion,
  entry,
  status,
  canEdit,
  onChanged,
}: {
  doc: PsurDocument;
  criterion: MemoCriterionId;
  entry: EvidenceEntry;
  status: EvidenceStatus;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry.content);
  const [citation, setCitation] = useState(entry.citation);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, "That change could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const muted = status === "REJECTED" || status === "SUPERSEDED" || status === "WITHDRAWN";
  return (
    <li
      className={`rounded-md border border-border p-3 ${muted ? "opacity-60" : ""}`}
      data-testid="evidence-item"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
        <StatusPill tone="info">{SOURCE_TYPE_LABEL[entry.sourceType]}</StatusPill>
        <span className="text-xs text-muted-foreground">
          {entry.origin === "ai" ? "Found by AI search" : "Entered"} by {entry.addedBy}
          {entry.acceptedBy ? ` · accepted by ${entry.acceptedBy}` : ""}
          {entry.rejectedBy ? ` · rejected by ${entry.rejectedBy}` : ""}
        </span>
        {entry.findingId ? <StatusPill tone="success">Resolves a review finding</StatusPill> : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} />
          <Input
            value={citation}
            onChange={(e) => setCitation(e.target.value)}
            placeholder="Citation (required)"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !content.trim() || !citation.trim()}
              onClick={() =>
                // Both cases are a revision: the edited text is a new,
                // accepted entry superseding the original, which is kept —
                // so the record shows it started as this AI candidate.
                run(
                  () => psurApi.reviseEvidence(doc.id, entry.id, { content, citation }, criterion),
                  status === "CANDIDATE"
                    ? "Edited and accepted."
                    : "Revision saved; the original is kept on record.",
                )
              }
            >
              <Check className="size-4" />{" "}
              {status === "CANDIDATE" ? "Save and accept" : "Save revision"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{entry.content}</p>
          <CitationText citation={entry.citation} />
        </>
      )}
      {canEdit && !editing && (status === "CANDIDATE" || status === "ACCEPTED") ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {status === "CANDIDATE" ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() => psurApi.acceptEvidence(doc.id, entry.id), "Accepted into the memo.")
                }
              >
                <Check className="size-4" /> Accept
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit, then accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(() => psurApi.rejectEvidence(doc.id, entry.id), "Rejected; kept on record.")
                }
              >
                <X className="size-4" /> Reject
              </Button>
            </>
          ) : entry.findingId ? (
            // Edited from its finding, so the finding and the memo cannot
            // end up showing different research.
            <span className="text-xs text-muted-foreground">
              Edit this from its finding in Review findings above.
            </span>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Revise
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ResearchResults({
  doc,
  criterion,
  result,
  onChanged,
  onDone,
}: {
  doc: PsurDocument;
  criterion: MemoCriterionId;
  result: AiPsurResearchResponse;
  onChanged: () => void;
  onDone: (sourceId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const keep = async (c: AiPsurResearchCandidate) => {
    setBusy(c.source_id);
    try {
      await psurApi.addEvidence(doc.id, {
        criterion,
        section: homeSection(criterion),
        sourceType: c.source_type as EvidenceSourceType,
        citation: c.citation,
        content: c.content,
        origin: "ai",
      });
      toast.success("Added as a candidate. Accept it below to put it in the memo.");
      onDone(c.source_id);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, "Could not add that source."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="mt-3 rounded-md border border-assist/30 bg-assist-soft/30 p-3"
      data-testid="research-results"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-assist" />
        <span>
          Searched:{" "}
          {result.registries
            .map((r) => `${r.name} (${r.error ? "unreachable" : `${r.count} found`})`)
            .join(" · ")}
        </span>
        <span>
          {result.ai_used
            ? "Remarks summarised by AI from each source's own text; citations come from the registry."
            : "Showing each source's own text."}
        </span>
      </div>
      {result.error ? <p className="mt-2 text-xs text-warning">{result.error}</p> : null}
      {result.candidates.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No sources found for this criterion.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {result.candidates.map((c) => (
            <li
              key={c.source_id}
              className="rounded-md border border-border bg-background p-3"
              data-testid="research-candidate"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  tone={
                    c.relevance === "HIGH" ? "success" : c.relevance === "LOW" ? "neutral" : "info"
                  }
                >
                  {c.relevance === "HIGH"
                    ? "Highly relevant"
                    : c.relevance === "LOW"
                      ? "Less relevant"
                      : "Relevant"}
                </StatusPill>
                <span className="text-xs text-muted-foreground">{c.registry}</span>
                {c.published ? (
                  <span className="text-xs text-muted-foreground">{c.published}</span>
                ) : null}
                {c.in_interval === true ? (
                  <StatusPill tone="success">Within reporting interval</StatusPill>
                ) : null}
                {c.in_interval === false ? (
                  <StatusPill tone="neutral">Outside reporting interval</StatusPill>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">{c.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{c.content}</p>
              {c.summarised_by_ai ? (
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">What the source itself says</summary>
                  <p className="mt-1 whitespace-pre-wrap">{c.excerpt}</p>
                </details>
              ) : null}
              <CitationText citation={c.citation} />
              <Button
                size="sm"
                className="mt-2"
                variant="outline"
                disabled={busy !== null}
                onClick={() => keep(c)}
              >
                <Plus className="size-4" /> {busy === c.source_id ? "Adding…" : "Add as candidate"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddEvidenceForm({
  doc,
  criterion,
  initial,
  onChanged,
  onClose,
}: {
  doc: PsurDocument;
  criterion: MemoCriterionId;
  initial?: { content: string; citation: string } | undefined;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [sourceType, setSourceType] = useState<EvidenceSourceType>(defaultSourceType(criterion));
  const [v4Field, setV4Field] = useState<V4FieldId>(
    defaultFieldForCriterion(criterion) ?? "S13_FURTHER",
  );
  const [citation, setCitation] = useState(initial?.citation ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [busy, setBusy] = useState(false);
  const vigiflow = criterion === "PATIENT_EXPOSURE";
  return (
    <div
      className="mt-3 space-y-2 rounded-md border border-border p-3"
      data-testid="add-evidence-form"
    >
      <Select value={sourceType} onValueChange={(v) => setSourceType(v as EvidenceSourceType)}>
        <SelectTrigger aria-label="Source type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SOURCE_TYPE_LABEL) as EvidenceSourceType[]).map((t) => (
            <SelectItem key={t} value={t}>
              {SOURCE_TYPE_LABEL[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <V4FieldSelect value={v4Field} onChange={setV4Field} />
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        aria-label="Evidence text"
        placeholder={
          vigiflow
            ? "e.g. 3 ADR reports on VigiFlow during the reporting interval, some co-administered with other medications."
            : "What the source says, in your words."
        }
      />
      <Input
        value={citation}
        onChange={(e) => setCitation(e.target.value)}
        aria-label="Citation"
        placeholder={
          vigiflow
            ? "e.g. VigiFlow (NAFDAC national database), searched 3 October 2026 — entered by hand"
            : "Citation: URL, DOI or document reference (required)"
        }
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !content.trim() || !citation.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await psurApi.addEvidence(doc.id, {
                criterion,
                section: homeSection(criterion),
                sourceType,
                citation,
                content,
                origin: "assessor",
                v4Field,
              });
              toast.success("Evidence added and accepted.");
              onChanged();
              onClose();
            } catch (err) {
              toast.error(errorText(err, "Could not add the evidence."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check className="size-4" /> Add evidence
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CriterionCard({
  doc,
  criterion,
  draft,
  setDraft,
  canEdit,
  onChanged,
}: {
  doc: PsurDocument;
  criterion: MemoCriterionId;
  draft: AssessmentMemoDraft;
  setDraft: (d: AssessmentMemoDraft) => void;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<AiPsurResearchResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const entries = evidenceForCriterion(doc.assessmentSections ?? [], criterion);
  const live = entries.filter((e) => e.status === "ACCEPTED" || e.status === "CANDIDATE");
  const history = entries.filter(
    (e) => e.status === "REJECTED" || e.status === "SUPERSEDED" || e.status === "WITHDRAWN",
  );
  const researchable = RESEARCHABLE_CRITERIA.includes(criterion);
  const setAnswer = (key: keyof MemoAnswers, v: "Yes" | "No" | undefined) =>
    setDraft({ ...draft, answers: { ...draft.answers, [key]: v } });

  return (
    <div className="rounded-lg border border-border p-4" data-testid={`criterion-${criterion}`}>
      <h3 className="text-sm font-semibold text-foreground">{criterionLabel(criterion)}</h3>
      <div className="mt-2 flex flex-wrap gap-4">
        {criterion === "PATIENT_EXPOSURE" ? (
          <>
            <YesNo
              label="African component?"
              value={draft.answers.PATIENT_EXPOSURE_AFRICAN}
              disabled={!canEdit}
              onChange={(v) => setAnswer("PATIENT_EXPOSURE_AFRICAN", v)}
            />
            <YesNo
              label="Nigerian component?"
              value={draft.answers.PATIENT_EXPOSURE_NIGERIAN}
              disabled={!canEdit}
              onChange={(v) => setAnswer("PATIENT_EXPOSURE_NIGERIAN", v)}
            />
          </>
        ) : criterion === "OVERALL_SAFETY_EVALUATION" ? null : (
          <YesNo
            label="Answer"
            value={
              draft.answers[criterion as "RSI_CHANGES" | "WORLDWIDE_ACTIONS" | "RELEVANT_STUDIES"]
            }
            disabled={!canEdit}
            onChange={(v) => setAnswer(criterion as keyof MemoAnswers, v)}
          />
        )}
      </div>

      {criterion === "OVERALL_SAFETY_EVALUATION" ? (
        <div className="mt-3">
          <label className="label-caps" htmlFor="overall-safety">
            Risks in order of seriousness — one per line
          </label>
          <Textarea
            id="overall-safety"
            className="mt-1"
            rows={5}
            disabled={!canEdit}
            value={draft.overallSafetyEnumeration}
            onChange={(e) => setDraft({ ...draft, overallSafetyEnumeration: e.target.value })}
            placeholder={
              "Respiratory depression\nSeizures\nSerotonin syndrome, particularly with serotonergic drugs"
            }
          />
        </div>
      ) : null}

      {criterion === "PATIENT_EXPOSURE" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The figure for this criterion comes from NAFDAC's VigiFlow database, which the system
          cannot search yet. Enter the count by hand and cite VigiFlow as the source.
        </p>
      ) : null}

      {live.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {live.map(({ entry, status }) => (
            <EvidenceItem
              key={entry.id}
              criterion={criterion}
              doc={doc}
              entry={entry}
              status={status}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No evidence yet. Without an answer or accepted evidence, the memo will print “Not
          assessed” for this criterion.
        </p>
      )}

      {history.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setShowHistory((s) => !s)}
          >
            {showHistory ? "Hide" : "Show"} {history.length} earlier, rejected or withdrawn{" "}
            {history.length === 1 ? "entry" : "entries"}
          </button>
          {showHistory ? (
            <ul className="mt-2 space-y-2">
              {history.map(({ entry, status }) => (
                <EvidenceItem
                  key={entry.id}
                  criterion={criterion}
                  doc={doc}
                  entry={entry}
                  status={status}
                  canEdit={false}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {researchable ? (
            <Button
              size="sm"
              variant="outline"
              disabled={searching}
              onClick={async () => {
                const substance = searchSubstance(doc);
                if (!substance) {
                  toast.error(
                    "The product's active substance is not known, so there is nothing to search for.",
                  );
                  return;
                }
                setSearching(true);
                try {
                  setResult(
                    await ai.psur.research({
                      criterion,
                      substance,
                      interval: submissionDetailsOf(doc).intervalCovered,
                    }),
                  );
                } catch (err) {
                  toast.error(errorText(err, "The search could not be run."));
                } finally {
                  setSearching(false);
                }
              }}
            >
              <Search className="size-4" />{" "}
              {searching
                ? "Searching public sources…"
                : `Search public sources for ${searchSubstance(doc) || "the product"}`}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
            <Plus className="size-4" /> Add evidence by hand
          </Button>
        </div>
      ) : null}

      {adding ? (
        <AddEvidenceForm
          doc={doc}
          criterion={criterion}
          onChanged={onChanged}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {result ? (
        <ResearchResults
          doc={doc}
          criterion={criterion}
          result={result}
          onChanged={onChanged}
          onDone={(sourceId) =>
            setResult((r) =>
              r ? { ...r, candidates: r.candidates.filter((c) => c.source_id !== sourceId) } : r,
            )
          }
        />
      ) : null}
    </div>
  );
}

/** Paste text, let the AI propose where it belongs, confirm or move it. */
function PasteAndRoute({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [citation, setCitation] = useState("");
  const [proposal, setProposal] = useState<{
    criterion: MemoCriterionId;
    confidence: number;
    reason: string;
  } | null>(null);
  const [target, setTarget] = useState<MemoCriterionId | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="rounded-lg border border-dashed border-border p-4"
      data-testid="paste-and-route"
    >
      <h3 className="text-sm font-semibold text-foreground">Paste your own research</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Paste text from any source. The system suggests which criterion it belongs to; you confirm
        or move it.
      </p>
      <Textarea
        className="mt-2"
        rows={4}
        aria-label="Pasted research"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setProposal(null);
          setTarget(null);
        }}
        placeholder="Paste a paragraph from a label, a safety communication, a study…"
      />
      <Input
        className="mt-2"
        aria-label="Citation for pasted research"
        value={citation}
        onChange={(e) => setCitation(e.target.value)}
        placeholder="Citation: URL, DOI or document reference (required)"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await ai.psur.routeEvidence({ text });
              const criterion = r.criterion as MemoCriterionId;
              setProposal({ criterion, confidence: r.confidence, reason: r.reason });
              setTarget(criterion);
            } catch (err) {
              toast.error(errorText(err, "Could not suggest a criterion."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles className="size-4" /> Suggest criterion
        </Button>
        {proposal ? (
          <span className="text-xs text-muted-foreground" data-testid="route-proposal">
            Suggested: <strong>{criterionLabel(proposal.criterion).slice(0, 60)}</strong> (
            {Math.round(proposal.confidence * 100)}% confident) — {proposal.reason}
          </span>
        ) : null}
      </div>
      {target ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={target} onValueChange={(v) => setTarget(v as MemoCriterionId)}>
            <SelectTrigger className="w-[28rem] max-w-full" aria-label="Criterion">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVIDENCE_CRITERIA.map((id) => (
                <SelectItem key={id} value={id}>
                  {criterionLabel(id).slice(0, 80)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={busy || !citation.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await psurApi.addEvidence(doc.id, {
                  criterion: target,
                  section: homeSection(target),
                  sourceType: defaultSourceType(target),
                  citation,
                  content: text,
                  origin: "assessor",
                });
                toast.success("Added to the memo.");
                setText("");
                setCitation("");
                setProposal(null);
                setTarget(null);
                onChanged();
              } catch (err) {
                toast.error(errorText(err, "Could not add the evidence."));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check className="size-4" /> Add to this criterion
          </Button>
          {!citation.trim() ? (
            <span className="text-xs text-warning">A citation is required.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScoreInput({
  value,
  disabled,
  label,
  onChange,
}: {
  value: number;
  disabled: boolean;
  label: string;
  onChange: (n: number) => void;
}) {
  return (
    <Input
      type="number"
      min={0}
      step={1}
      aria-label={label}
      className="h-8 w-16 text-center"
      disabled={disabled}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
    />
  );
}

function CiomsEditor({
  matrix,
  setMatrix,
  disabled,
}: {
  matrix: CiomsMatrix;
  setMatrix: (m: CiomsMatrix) => void;
  disabled: boolean;
}) {
  const totals = matrixTotals(matrix);
  const setRow = (
    col: "epidemiologyOfDisease" | "effectivenessOfProduct",
    key: keyof CiomsScoreRow,
    n: number,
  ) => setMatrix({ ...matrix, [col]: { ...matrix[col], [key]: n } });
  const setAdr = (
    i: number,
    patch: Partial<{ reaction: string; key: keyof CiomsScoreRow; n: number }>,
  ) =>
    setMatrix({
      ...matrix,
      adrs: matrix.adrs.map((a, j) =>
        j !== i
          ? a
          : {
              reaction: patch.reaction ?? a.reaction,
              scores: patch.key ? { ...a.scores, [patch.key]: patch.n! } : a.scores,
            },
      ),
    });
  return (
    <div className="overflow-x-auto" data-testid="cioms-editor">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2" />
            <th className="p-2">Epidemiology of Disease</th>
            <th className="p-2">Effectiveness of Product</th>
            {matrix.adrs.map((a, i) => (
              <th key={i} className="p-2">
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 min-w-36"
                    aria-label={`Adverse reaction ${i + 1}`}
                    value={a.reaction}
                    disabled={disabled}
                    placeholder="Adverse reaction"
                    onChange={(e) => setAdr(i, { reaction: e.target.value })}
                  />
                  {!disabled ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${a.reaction || "reaction"}`}
                      onClick={() =>
                        setMatrix({ ...matrix, adrs: matrix.adrs.filter((_, j) => j !== i) })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SCORE_ROWS.map(({ key, label }) => (
            <tr key={key} className="border-b border-border">
              <td className="p-2 font-medium">{label}</td>
              <td className="p-2">
                <ScoreInput
                  label={`Epidemiology ${label}`}
                  value={matrix.epidemiologyOfDisease[key]}
                  disabled={disabled}
                  onChange={(n) => setRow("epidemiologyOfDisease", key, n)}
                />
              </td>
              <td className="p-2">
                <ScoreInput
                  label={`Effectiveness ${label}`}
                  value={matrix.effectivenessOfProduct[key]}
                  disabled={disabled}
                  onChange={(n) => setRow("effectivenessOfProduct", key, n)}
                />
              </td>
              {matrix.adrs.map((a, i) => (
                <td key={i} className="p-2">
                  <ScoreInput
                    label={`${a.reaction || `Reaction ${i + 1}`} ${label}`}
                    value={a.scores[key]}
                    disabled={disabled}
                    onChange={(n) => setAdr(i, { key, n })}
                  />
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="p-2">Total</td>
            <td className="p-2" data-testid="total-epidemiology">
              {totals?.epidemiology ?? "—"}
            </td>
            <td className="p-2" data-testid="total-effectiveness">
              {totals?.effectiveness ?? "—"}
            </td>
            {matrix.adrs.map((_, i) => (
              <td key={i} className="p-2">
                {totals?.adrs[i] ?? "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {!totals ? (
        <p className="mt-1 text-xs text-warning">
          Every score must be a whole number of 0 or more before totals can be shown.
        </p>
      ) : null}
      {!disabled ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() =>
            setMatrix({
              ...matrix,
              adrs: [
                ...matrix.adrs,
                { reaction: "", scores: { seriousness: 0, duration: 0, incidence: 0 } },
              ],
            })
          }
        >
          <Plus className="size-4" /> Add adverse reaction column
        </Button>
      ) : null}
    </div>
  );
}

/**
 * NAFDAC's internal assessment memo, assembled by the assessor.
 *
 * Facts 1-6 come from the screening; criteria 7-11 from evidence the
 * assessor found, pasted or accepted from the public-registry search; the
 * matrix and conclusions are theirs. Nothing the AI found reaches the memo
 * until a person accepts it.
 */
export function PsurAssessmentMemoPanel({
  doc,
  canEdit,
  onChanged,
}: {
  doc: PsurDocument;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const role = useRole();
  const canScore = canEdit && !!role && canEditCiomsMatrix(role);
  const [draft, setDraft] = useState<AssessmentMemoDraft>(() => ({
    ...defaultMemoDraft(doc),
    ...(doc.memoDraft ?? {}),
  }));
  const [matrix, setMatrix] = useState<CiomsMatrix>(() => doc.ciomsMatrix ?? emptyCiomsMatrix());
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  // Separate from the draft: saving the matrix stamps "last changed by",
  // which must name someone who actually changed a score.
  const [matrixDirty, setMatrixDirty] = useState(false);
  const dirty = draftDirty || matrixDirty;

  const update = (d: AssessmentMemoDraft) => {
    setDraft(d);
    setDraftDirty(true);
  };
  const updateMatrix = (m: CiomsMatrix) => {
    setMatrix(m);
    setMatrixDirty(true);
  };

  const totals = matrixTotals(matrix);
  const proposedBand = totals ? bandFor(totals.effectiveness) : undefined;
  const proposedVerdict = totals ? proposeVerdict(totals) : undefined;
  const blockers = memoBlockers(draft, matrix);
  const warnings = memoWarnings(doc, draft);
  const section12Verdict = verdictFromSection12(doc);
  const facts = useMemo(
    () => factualCriteria(submissionDetailsOf(doc), draft.therapeuticCategory),
    [doc, draft.therapeuticCategory],
  );

  const save = async () => {
    setSaving(true);
    try {
      if (draftDirty) await psurApi.saveMemoDraft(doc.id, draft);
      if (matrixDirty && canScore && totals) {
        await psurApi.saveCiomsMatrix(doc.id, matrix, currentActor().name);
        setMatrixDirty(false);
      }
      setDraftDirty(false);
      onChanged();
      return true;
    } catch (err) {
      toast.error(errorText(err, "Could not save the memo."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Autosave shortly after the assessor stops typing. Answers and scores
  // live in this component until saved, and leaving the page used to lose
  // them silently. The Save button stays for anyone who wants it now.
  useEffect(() => {
    if (!canEdit || !dirty) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 1500);
    return () => window.clearTimeout(timer);
    // `save` is recreated each render; the state it reads is listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, matrix, draftDirty, matrixDirty, canEdit]);

  const field = (key: keyof AssessmentMemoDraft, label: string, placeholder = "") => (
    <label className="block">
      <span className="label-caps">{label}</span>
      <Input
        className="mt-1"
        disabled={!canEdit}
        value={String(draft[key] ?? "")}
        placeholder={placeholder}
        onChange={(e) => update({ ...draft, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <Section
      id="assessment-memo"
      title="Assessment memo"
      description="NAFDAC's internal memo and review report. Research each criterion, accept the evidence you rely on, score the matrix, then generate the Word document."
      actions={
        canEdit ? (
          <Button
            size="sm"
            variant="outline"
            disabled={saving || !dirty}
            onClick={() => save().then((ok) => ok && toast.success("Memo saved."))}
          >
            <Save className="size-4" /> {saving ? "Saving…" : dirty ? "Save memo" : "Saved"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Memo details</h3>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="label-caps">Reference number</span>
              <div className="mt-1 flex items-center gap-1">
                <span className="mono-num text-sm text-muted-foreground">
                  {MEMO_REFERENCE_PREFIX}
                </span>
                <Input
                  disabled={!canEdit}
                  aria-label="Reference number"
                  value={draft.referenceSuffix}
                  placeholder="455/III"
                  onChange={(e) => update({ ...draft, referenceSuffix: e.target.value })}
                />
              </div>
            </label>
            {field("memoDate", "Date")}
            {field("to", "To")}
            {field("from", "From")}
            {field("signatory", "Signatory (printed after “For:”)", "Pharm. … Director (PV)")}
            {field("signatoryTitle", "Signatory title")}
            {field("productNameAndStrength", "Product name and strength")}
            {field("therapeuticCategory", "Therapeutic category", "e.g. Narcotic analgesic")}
            {field("mahName", "Submitted by (MAH)")}
            {field("locationAddress", "Location address")}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Criteria 1–6 — from the submission
          </h3>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {facts.map((c) => (
                <tr key={c.id} className="border-b border-border">
                  <td className="w-8 p-2 text-muted-foreground">{c.number}</td>
                  <td className="p-2">{c.label}</td>
                  <td className={`p-2 ${c.unestablished ? "text-muted-foreground italic" : ""}`}>
                    {c.remarks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Criteria 7–11 — researched evidence
          </h3>
          {canEdit ? <PasteAndRoute doc={doc} onChanged={onChanged} /> : null}
          {EVIDENCE_CRITERIA.map((id) => (
            <CriterionCard
              key={id}
              doc={doc}
              criterion={id}
              draft={draft}
              setDraft={update}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Summary Table 1: ICH and CIOMS principle
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {canScore
              ? "Score each row. Totals are calculated, never typed."
              : "Only the Evaluator and the Peer Reviewer may change scores."}
            {matrix.lastEditedBy || doc.ciomsMatrix?.lastEditedBy
              ? ` Last changed by ${doc.ciomsMatrix?.lastEditedBy ?? matrix.lastEditedBy}.`
              : ""}
          </p>
          <div className="mt-2">
            <CiomsEditor matrix={matrix} setMatrix={updateMatrix} disabled={!canScore} />
          </div>
          {PROVISIONAL_CIOMS_RUBRIC.provisional ? (
            <p className="mt-2 rounded-md bg-warning-soft p-2 text-xs text-warning">
              The scoring rubric is provisional: {PROVISIONAL_CIOMS_RUBRIC.provenance} The memo will
              say so. Confirm the band and the verdict yourself.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <span className="label-caps">Efficacy band (confirmed)</span>
            <Input
              className="mt-1"
              aria-label="Efficacy band"
              disabled={!canEdit}
              value={draft.bandConfirmed}
              placeholder="e.g. Medium"
              onChange={(e) => update({ ...draft, bandConfirmed: e.target.value })}
            />
            {proposedBand ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                Proposed: {proposedBand.label} (effectiveness total {totals!.effectiveness})
                {canEdit && draft.bandConfirmed !== proposedBand.label ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update({ ...draft, bandConfirmed: proposedBand.label })}
                  >
                    Confirm proposal
                  </Button>
                ) : null}
              </div>
            ) : null}
            {proposedBand && draft.bandConfirmed && draft.bandConfirmed !== proposedBand.label ? (
              <p className="mt-1 text-xs text-warning" data-testid="band-differs">
                The confirmed band differs from what the current effectiveness total proposes. If
                the scores changed since it was confirmed, check it still holds.
              </p>
            ) : null}
          </div>
          <div>
            <span className="label-caps">Benefit-risk verdict (confirmed)</span>
            <Input
              className="mt-1"
              aria-label="Benefit-risk verdict"
              disabled={!canEdit}
              value={draft.verdictConfirmed}
              placeholder="e.g. Positive Benefit-Risk Balance"
              onChange={(e) => update({ ...draft, verdictConfirmed: e.target.value })}
            />
            {section12Verdict ? (
              <div className="mt-1 text-xs text-foreground" data-testid="section12-verdict">
                Section 12 decision: <strong>{section12Verdict}</strong>
                {canEdit && draft.verdictConfirmed !== section12Verdict ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update({ ...draft, verdictConfirmed: section12Verdict })}
                  >
                    Use the Section 12 decision
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No overall outcome recorded in Section 12 yet. Record it there and this verdict will
                follow it.
              </p>
            )}
            {proposedVerdict ? (
              <div className="mt-1 text-xs text-muted-foreground">
                Proposed: {proposedVerdict.verdict}. {proposedVerdict.reasoning}
                {canEdit && draft.verdictConfirmed !== proposedVerdict.verdict ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update({ ...draft, verdictConfirmed: proposedVerdict.verdict })}
                  >
                    Confirm proposal
                  </Button>
                ) : null}
              </div>
            ) : null}
            {/* Section 12 is the assessor's decision and outranks the
                rubric's proposal; this hint only matters without it. */}
            {!section12Verdict &&
            proposedVerdict &&
            draft.verdictConfirmed &&
            draft.verdictConfirmed !== proposedVerdict.verdict ? (
              <p className="mt-1 text-xs text-warning" data-testid="verdict-differs">
                The confirmed verdict differs from what the current scores propose. If the scores
                changed since it was confirmed, check it still holds.
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <span className="label-caps">Analysis of matrix</span>
          <p className="text-xs text-muted-foreground">
            The first paragraph is the lead-in; each further line prints as a bold point beneath it.
            The score comparison and the efficacy band line are added automatically from the matrix
            when the memo is generated, so they always match the scores.
          </p>
          <Textarea
            className="mt-1"
            rows={5}
            aria-label="Analysis of matrix"
            disabled={!canEdit}
            value={draft.analysisOfMatrix}
            onChange={(e) => update({ ...draft, analysisOfMatrix: e.target.value })}
          />
        </div>

        <div>
          <span className="label-caps">Conclusion</span>
          <Textarea
            className="mt-1"
            rows={4}
            aria-label="Conclusion"
            disabled={!canEdit}
            value={draft.conclusion}
            placeholder="The product possesses a Positive Benefit-Risk Balance, and the MAH may be required to continuously communicate these risks…"
            onChange={(e) => update({ ...draft, conclusion: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Generate the memo</h3>
          {blockers.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-warning" data-testid="memo-blockers">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-success">Ready to generate.</p>
          )}
          {warnings.length > 0 ? (
            <ul
              className="mt-2 list-disc pl-5 text-xs text-muted-foreground"
              data-testid="memo-warnings"
            >
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={blockers.length > 0 || saving}
              onClick={async () => {
                if (canEdit && dirty && !(await save())) return;
                try {
                  await psurApi.downloadAssessmentMemo(doc.id);
                  toast.success("Assessment memo downloaded.");
                } catch (err) {
                  toast.error(errorText(err, "Could not generate the memo."));
                }
              }}
            >
              <Download className="size-4" /> Generate memo (Word)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={blockers.length > 0 || saving}
              onClick={async () => {
                if (canEdit && dirty && !(await save())) return;
                try {
                  await psurApi.downloadAssessmentMemoText(doc.id);
                } catch (err) {
                  toast.error(errorText(err, "Could not generate the memo."));
                }
              }}
            >
              <FileText className="size-4" /> Plain text
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
