import { useState } from "react";
import { toast } from "sonner";
import { BookOpenCheck, Check, Pencil, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { psur as psurApi } from "@/services/api/psur";
import { ai, type AiPsurResearchCandidate } from "@/services/api/ai";
import { MEMO_CRITERIA } from "@/services/psur/assessment-memo";
import {
  canResolveWithResearch,
  findingNeedsResearch,
  criterionForFinding,
  searchCriterionFor,
} from "@/services/psur/finding-research";
import { searchSubstance, submissionDetailsOf } from "@/services/psur/memo-draft";
import type { MemoCriterionId, PsurDocument, PsurFinding } from "@/types/pv";

function criterionName(id: MemoCriterionId): string {
  const c = MEMO_CRITERIA.find((x) => x.id === id)!;
  return `${c.number}. ${c.label}`;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Fixing an accepted finding, shown with the finding inside its section.
 *
 * Every finding can be fixed on the form ("Fix on the form"). Where the
 * template is answered from outside the submission (Sections 2, 3, 4, 6
 * and 7) it can also be fixed with research: found through the registry
 * search or written by the assessor, always with its source. That research
 * prints with the finding in the V4 report, also counts for the memo
 * criterion of the finding's section, and the MAH feedback letter lists
 * the finding as resolved by NAFDAC. The finding stays, so it can be
 * edited or reopened.
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
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(existing?.content ?? "");
  const [citation, setCitation] = useState(existing?.citation ?? "");
  const [origin, setOrigin] = useState<"ai" | "assessor">("assessor");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AiPsurResearchCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canResolveWithResearch(finding)) return null;
  // Fixed on the form, or in a section that takes no research. A finding
  // resolved with research before its section stopped taking research
  // keeps showing that resolution.
  if (finding.formResolution || (!findingNeedsResearch(finding) && !existing))
    return <FormFix doc={doc} finding={finding} canEdit={canEdit} onChanged={onChanged} />;

  const chosen = criterionForFinding(finding);

  const startEditing = () => {
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
      toast.success("Fixed. It prints with this finding in the V4 report.");
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
              Fixed with research
            </StatusPill>
            <span className="text-muted-foreground">
              by {existing.by} on {existing.at.slice(0, 16).replace("T", " ")} UTC
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
        <div className="flex flex-wrap items-start gap-2">
          <Button size="sm" variant="outline" onClick={startEditing}>
            <BookOpenCheck className="size-4" /> Fix with research
          </Button>
          <FormFix doc={doc} finding={finding} canEdit={canEdit} onChanged={onChanged} inline />
        </div>
      ) : null}

      {open ? (
        <div
          className="space-y-2 rounded-md border border-border p-3"
          data-testid="finding-research-form"
        >
          <p className="text-xs text-muted-foreground">
            Find or write what fills this gap, with its source. It prints with this finding in the
            V4 report, and the MAH feedback letter lists the gap as fixed by NAFDAC.
          </p>

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

          <label className="block">
            <span className="text-sm font-medium">What fills this gap:</span>
            <Textarea
              className="mt-1"
              rows={4}
              aria-label="Research for this finding"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Your answer, in your words — what you found that fills this gap."
            />
          </label>
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

/**
 * Resolving a finding whose section is answered from the submission or by
 * the evaluator (Section 1's details, exposure, signals, Sections 9-13),
 * not from research: the evaluator corrects the form itself, then records
 * what they corrected. The finding stays listed, resolved by NAFDAC.
 */
function FormFix({
  doc,
  finding,
  canEdit,
  onChanged,
  inline = false,
}: {
  doc: PsurDocument;
  finding: PsurFinding;
  canEdit: boolean;
  onChanged: () => void;
  /** Sits beside the research button rather than on its own line. */
  inline?: boolean;
}) {
  const done = finding.formResolution;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(done?.note ?? "");
  const [busy, setBusy] = useState(false);

  if (done && !open) {
    return (
      <div className="mt-2 rounded-md border border-success/30 bg-success-soft/40 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="success" icon={<Check className="size-3.5" />}>
            Fixed on the form
          </StatusPill>
          <span className="text-muted-foreground">
            by {done.by} on {done.at.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-foreground">{done.note}</p>
        {canEdit ? (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await psurApi.reopenFinding(doc.id, finding.id);
                  toast.success("Reopened.");
                  onChanged();
                } catch (err) {
                  toast.error(errorText(err, "Could not reopen the finding."));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RotateCcw className="size-4" /> Undo resolution
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (!canEdit) return null;
  if (!open) {
    return (
      <div className={inline ? "" : "mt-2"} data-testid="finding-form-fix">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Pencil className="size-4" /> Fix on the form
        </Button>
      </div>
    );
  }
  return (
    <div
      className="mt-2 space-y-2 rounded-md border border-border p-3"
      data-testid="finding-form-fix"
    >
      <p className="text-xs text-muted-foreground">
        Correct this section of the form, then say here what you corrected. The finding stays listed
        as fixed by NAFDAC, and the MAH feedback letter says so.
      </p>
      <Textarea
        rows={2}
        aria-label="What you corrected on the form"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Date of review entered as 12 September 2026, from the QPPV signature on the title page."
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !note.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await psurApi.resolveFindingOnForm(doc.id, finding.id, note);
              toast.success("Fixed on the form.");
              setOpen(false);
              onChanged();
            } catch (err) {
              toast.error(errorText(err, "Could not save."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check className="size-4" /> {busy ? "Saving…" : "Mark resolved"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
