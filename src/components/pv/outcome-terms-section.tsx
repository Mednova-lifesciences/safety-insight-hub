import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGE_SIZE, Pager, Section, StatusPill } from "@/components/pv/primitives";
import { termMappings } from "@/services/api/term-mappings";
import { linelist as linelistApi } from "@/services/api/linelist";
import {
  REACTION_OUTCOME_LABELS,
  REACTION_OUTCOMES,
  type OrgTermMapping,
} from "@/services/e2b-r3/term-mappings";
import type { ReactionOutcome } from "@/services/e2b-r3/types";

/**
 * Outcome words from any line list that are not one of the six E2B
 * outcomes ("Hospitalized", "Fully better", "Recoverd"). Each is decided
 * once for the organization; saving rechecks every line list it affects,
 * so their errors clear straight away. Newest first, ten per page — this
 * list only grows.
 */
export function OutcomeTermsSection() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<OrgTermMapping[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [draft, setDraft] = useState<Record<string, ReactionOutcome>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(p = page) {
    try {
      const result = await termMappings.listPage("OUTCOME", p, PAGE_SIZE);
      setItems(result.items);
      setTotal(result.total);
      setPending(result.pending);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load outcome terms.");
    }
  }

  useEffect(() => {
    load(page);
  }, [page]);

  async function save(term: OrgTermMapping) {
    const value =
      draft[term.id] ??
      (term.mappedValue as ReactionOutcome | undefined) ??
      (term.aiSuggestion as ReactionOutcome | undefined);
    if (!value) return;
    setSaving(term.id);
    try {
      await termMappings.decide(term, value);
      const rechecked = await linelistApi.recheckAffected("OUTCOME_TERMS");
      toast.success(
        `"${term.term}" → ${REACTION_OUTCOME_LABELS[value]}.${rechecked ? ` ${rechecked} line list(s) rechecked.` : ""}`,
      );
      setDraft(({ [term.id]: _saved, ...rest }) => rest);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section
      id="outcome-terms"
      title="Outcome terms"
      description='Words line lists use for how a reaction ended that are not one of the six E2B(R3) outcomes. Choose which one each means — once. Words like "Hospitalized" describe seriousness, not an ending: if the file does not say how the reaction ended, choose Unknown.'
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No unrecognised outcome words yet. They appear here automatically when a line list uses
          one.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {pending > 0
              ? `${pending} word(s) waiting for a decision — cases using them cannot be exported until then.`
              : "Every word has a decision."}
          </p>
          <ul className="space-y-2">
            {items.map((t) => {
              const selected =
                draft[t.id] ??
                (t.mappedValue as ReactionOutcome | undefined) ??
                (t.aiSuggestion as ReactionOutcome | undefined);
              const unchanged = !!t.mappedValue && selected === t.mappedValue;
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-48 flex-1">
                    <p className="text-sm font-medium">"{t.term}"</p>
                    <p className="text-xs text-muted-foreground">
                      {t.firstSeenFile ? `First seen in ${t.firstSeenFile}` : null}
                      {t.decidedBy ? ` · Decided by ${t.decidedBy}` : null}
                    </p>
                  </div>
                  {t.mappedValue ? (
                    <StatusPill tone="success">Mapped</StatusPill>
                  ) : (
                    <StatusPill tone="warning">Needs a decision</StatusPill>
                  )}
                  {!t.mappedValue && t.aiSuggestion ? (
                    <StatusPill tone="assist" icon={<Sparkles className="size-3" />}>
                      AI suggests{" "}
                      {REACTION_OUTCOME_LABELS[t.aiSuggestion as ReactionOutcome] ?? t.aiSuggestion}
                    </StatusPill>
                  ) : null}
                  <Select
                    value={selected ?? ""}
                    onValueChange={(v) => setDraft((d) => ({ ...d, [t.id]: v as ReactionOutcome }))}
                  >
                    <SelectTrigger className="w-72" aria-label={`Outcome for ${t.term}`}>
                      <SelectValue placeholder="Choose an outcome…" />
                    </SelectTrigger>
                    <SelectContent>
                      {REACTION_OUTCOMES.map((o) => (
                        <SelectItem key={o} value={o}>
                          {REACTION_OUTCOME_LABELS[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={!selected || unchanged || saving === t.id}
                    onClick={() => save(t)}
                  >
                    {saving === t.id ? "Saving…" : "Save"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <Pager page={page} total={total} onPageChange={setPage} />
        </div>
      )}
    </Section>
  );
}
