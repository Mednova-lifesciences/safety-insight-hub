import { useState } from "react";
import { toast } from "sonner";
import { BookOpenCheck, Check, Pencil, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/pv/primitives";
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
import { psur as psurApi } from "@/services/api/psur";
import { ai, type AiPsurResearchCandidate } from "@/services/api/ai";
import { MEMO_CRITERIA } from "@/services/psur/assessment-memo";
import {
  canResolveWithResearch,
  criterionForFinding,
  searchCriterionFor,
} from "@/services/psur/finding-research";
import {
  EVIDENCE_CRITERIA,
  searchSubstance,
  submissionDetailsOf,
} from "@/services/psur/memo-draft";
import type { MemoCriterionId, PsurDocument, PsurFinding } from "@/types/pv";

const NOT_IN_MEMO = "NONE";

function criterionName(id: MemoCriterionId): string {
  const c = MEMO_CRITERIA.find((x) => x.id === id)!;
  return `${c.number}. ${c.label}`;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * "Resolve with research" on an accepted review finding.
 *
 * The assessor fills the gap the finding names — finding research through
 * the registry search or writing their own — and saves it. The research is
 * filed once, as accepted evidence in the assessment memo; the finding is
 * marked resolved and STAYS in the list, so it can be edited or reopened.
 * The MAH feedback letter then reports it as resolved by NAFDAC.
 */
export function FindingResearch({
  doc,
  finding,
  canEdit,
  onChanged,
}: {
  doc: PsurDocument;
  finding: PsurFinding;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const existing = finding.researchResolution;
  const suggested = criterionForFinding(finding);
  const [open, setOpen] = useState(false);
  const [criterion, setCriterion] = useState<string>(
    existing ? (existing.criterion ?? NOT_IN_MEMO) : (suggested ?? NOT_IN_MEMO),
  );
  const [content, setContent] = useState(existing?.content ?? "");
  const [citation, setCitation] = useState(existing?.citation ?? "");
  const [origin, setOrigin] = useState<"ai" | "assessor">("assessor");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AiPsurResearchCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canResolveWithResearch(finding)) return null;

  const chosen = criterion === NOT_IN_MEMO ? undefined : (criterion as MemoCriterionId);

  const startEditing = () => {
    setCriterion(existing ? (existing.criterion ?? NOT_IN_MEMO) : (suggested ?? NOT_IN_MEMO));
    setContent(existing?.content ?? "");
    setCitation(existing?.citation ?? "");
    setOrigin("assessor");
    setResults(null);
    setOpen(true);
  };

  const search = async () => {
    const substance = searchSubstance(doc);
    if (!substance) {
      toast.error(
        "The product's active substance is not known, so there is nothing to search for.",
      );
      return;
    }
    setSearching(true);
    try {
      const r = await ai.psur.research({
        criterion: searchCriterionFor(chosen),
        substance,
        interval: submissionDetailsOf(doc).intervalCovered,
        focus: `${finding.description} ${finding.evidence}`.trim(),
      });
      if (r.error) toast.message(r.error);
      setResults(r.candidates);
    } catch (err) {
      toast.error(errorText(err, "The search could not be run."));
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await psurApi.resolveFindingWithResearch(doc.id, finding.id, {
        content,
        citation,
        criterion: chosen,
        origin,
      });
      toast.success(
        chosen
          ? `Resolved. Filed in the memo under criterion ${MEMO_CRITERIA.find((c) => c.id === chosen)!.number}.`
          : "Resolved. Not filed in the memo.",
      );
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, "Could not save the research."));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      await psurApi.reopenFinding(doc.id, finding.id);
      toast.success("Reopened. Its research was taken out of the memo and kept on record.");
      onChanged();
    } catch (err) {
      toast.error(errorText(err, "Could not reopen the finding."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2" data-testid="finding-research">
      {existing && !open ? (
        <div className="rounded-md border border-success/30 bg-success-soft/40 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="success" icon={<BookOpenCheck className="size-3.5" />}>
              Resolved with research
            </StatusPill>
            <span className="text-muted-foreground">
              by {existing.by} on {existing.at.slice(0, 16).replace("T", " ")} UTC ·{" "}
              {existing.criterion
                ? `in the memo under ${criterionName(existing.criterion).slice(0, 70)}`
                : "not filed in the memo"}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{existing.content}</p>
          <p className="mt-1 text-muted-foreground">Source: {existing.citation}</p>
          {canEdit ? (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={startEditing}>
                <Pencil className="size-4" /> Edit research
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={reopen}>
                <RotateCcw className="size-4" /> Undo resolution
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!existing && !open && canEdit ? (
        <Button size="sm" variant="outline" onClick={startEditing}>
          <BookOpenCheck className="size-4" /> Resolve with research
        </Button>
      ) : null}

      {open ? (
        <div
          className="space-y-2 rounded-md border border-border p-3"
          data-testid="finding-research-form"
        >
          <p className="text-xs text-muted-foreground">
            Fill the gap this finding names. Saving marks it resolved by you, files the research in
            the assessment memo, and lists it on the MAH feedback letter as resolved by NAFDAC. The
            finding stays here so you can edit or reopen it.
          </p>
          <label className="block">
            <span className="label-caps">File in the memo under</span>
            <Select value={criterion} onValueChange={setCriterion}>
              <SelectTrigger className="mt-1" aria-label="Memo criterion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE_CRITERIA.map((id) => (
                  <SelectItem key={id} value={id}>
                    {criterionName(id).slice(0, 90)}
                  </SelectItem>
                ))}
                <SelectItem value={NOT_IN_MEMO}>
                  Don't add to the memo — resolve the finding only
                </SelectItem>
              </SelectContent>
            </Select>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={searching} onClick={search}>
              <Search className="size-4" />{" "}
              {searching ? "Searching public sources…" : "Find research for me"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Searches PubMed, DailyMed and MHRA for this gap. Citations come from the registry.
            </span>
          </div>

          {results ? (
            results.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No sources found. Write your own below.
              </p>
            ) : (
              <ul
                className="max-h-80 space-y-2 overflow-y-auto"
                data-testid="finding-research-results"
              >
                {results.map((c) => (
                  <li key={c.source_id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        tone={
                          c.relevance === "HIGH"
                            ? "success"
                            : c.relevance === "LOW"
                              ? "neutral"
                              : "info"
                        }
                      >
                        {c.relevance === "HIGH"
                          ? "Addresses this gap"
                          : c.relevance === "LOW"
                            ? "Less relevant"
                            : "Relevant"}
                      </StatusPill>
                      <span className="text-muted-foreground">
                        {c.registry}
                        {c.published ? ` · ${c.published}` : ""}
                      </span>
                      {c.summarised_by_ai ? <Sparkles className="size-3.5 text-assist" /> : null}
                    </div>
                    <p className="mt-1 font-medium">{c.title}</p>
                    <p className="mt-1 whitespace-pre-wrap">{c.content}</p>
                    <p className="mt-1 text-muted-foreground">Source: {c.citation}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1"
                      onClick={() => {
                        setContent(c.content);
                        setCitation(c.citation);
                        setOrigin("ai");
                      }}
                    >
                      <Plus className="size-4" /> Use this
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          <Textarea
            rows={4}
            aria-label="Research for this finding"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What you found that fills this gap, in your words."
          />
          <Input
            aria-label="Source for this research"
            value={citation}
            onChange={(e) => setCitation(e.target.value)}
            placeholder="Source: URL, DOI or document reference (required)"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !content.trim() || !citation.trim()} onClick={save}>
              <Check className="size-4" /> {busy ? "Saving…" : "Save research"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
