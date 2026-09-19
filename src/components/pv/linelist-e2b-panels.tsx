import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Search, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, StatusPill } from "@/components/pv/primitives";
import { linelist as linelistApi, suggestMedDraTerm } from "@/services/api/linelist";
import { termMappings } from "@/services/api/term-mappings";
import { coding } from "@/services/api/coding";
import { reactionTermKey, type OrgTermMapping } from "@/services/e2b-r3/term-mappings";
import { e2bCheckIncomplete } from "@/services/api/linelist-e2b-checks";
import type { LineListFixLocation, LineListIssue, LineListJob } from "@/types/pv";

/** Where a person goes to clear each kind of E2B blocker. */
const FIX_IN_LABEL: Record<LineListFixLocation, string> = {
  FILE: "Correct in the file",
  OUTCOME_TERMS: "Settings → Outcome terms",
  REPORTER_DESIGNATIONS: "Settings → Reporter qualifications",
  REACTION_TERMS: "Choose MedDRA term below",
  SOURCE_CODEBOOK: "Correct the code or add the form's legend",
};

/** The action for one finding: a link where the fix lives, or plain text
 *  when the fix is in the file itself. */
export function FixAction({ fixIn }: { fixIn: LineListFixLocation | undefined }) {
  if (!fixIn) return null;
  if (fixIn === "OUTCOME_TERMS" || fixIn === "REPORTER_DESIGNATIONS") {
    return (
      <Link
        to="/settings"
        hash={fixIn === "OUTCOME_TERMS" ? "outcome-terms" : "reporter-designations"}
        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        {FIX_IN_LABEL[fixIn]} →
      </Link>
    );
  }
  if (fixIn === "REACTION_TERMS") {
    return (
      <a
        href="#reaction-terms"
        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        {FIX_IN_LABEL[fixIn]} ↓
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground">{FIX_IN_LABEL[fixIn]}</span>;
}

/**
 * One line answering "can this file go to VigiFlow?", with what is left
 * grouped by where it is fixed. Settings (sender, receiver, report type)
 * and the C.1.7 decision are deliberately not counted here — those belong
 * to the E2B page.
 */
export function E2bReadinessBanner({ job, issues }: { job: LineListJob; issues: LineListIssue[] }) {
  const blockers = issues.filter((i) => i.blocksE2b && i.row > 0);
  if (!job.checkedAt && blockers.length === 0) return null;
  const blockedCases = new Set(blockers.map((i) => i.row)).size;
  const byPlace = new Map<LineListFixLocation, number>();
  for (const i of blockers) {
    const place = i.fixIn ?? "FILE";
    byPlace.set(place, (byPlace.get(place) ?? 0) + 1);
  }
  const incomplete = e2bCheckIncomplete(issues);
  if (blockedCases === 0 && incomplete) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          Not fully checked yet: a service needed for the E2B check could not be reached. Re-run
          validation once it is available before relying on this list.
        </span>
      </div>
    );
  }
  if (blockedCases === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        <span>
          Every case's data is ready for a validated E2B(R3) export. What remains is on the E2B
          page: organization settings and the C.1.7 decision.
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-critical/30 bg-critical/5 px-3 py-2 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 text-critical" />
        {blockedCases} of {job.rows} case(s) have data that would block VigiFlow.
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {[...byPlace.entries()].map(([place, count]) => (
          <li key={place} className="flex items-center gap-1">
            <span className="mono-num font-semibold">{count}</span>
            <FixAction fixIn={place} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How this line list's genuinely ambiguous separators are read. Saved on
 * the line list and used identically by these checks, E2B preflight and
 * export — so the cases never change underneath a C.1.7 decision.
 */
export function ParsingOptionsPanel({ job, onSaved }: { job: LineListJob; onSaved: () => void }) {
  const [slash, setSlash] = useState(!!job.parsingOptions?.slashSeparatesReactions);
  const [oneName, setOneName] = useState(!!job.parsingOptions?.productCellIsOneName);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setSlash(!!job.parsingOptions?.slashSeparatesReactions);
    setOneName(!!job.parsingOptions?.productCellIsOneName);
  }, [
    job.id,
    job.parsingOptions?.slashSeparatesReactions,
    job.parsingOptions?.productCellIsOneName,
  ]);
  const changed =
    slash !== !!job.parsingOptions?.slashSeparatesReactions ||
    oneName !== !!job.parsingOptions?.productCellIsOneName;

  async function save() {
    setSaving(true);
    try {
      await linelistApi.setParsingOptions(job.id, {
        slashSeparatesReactions: slash,
        productCellIsOneName: oneName,
      });
      toast.success("Saved. This line list has been rechecked with the new reading.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="How to read this file"
      description="Decided once for this line list. Line-list checks, E2B preflight and E2B export all use it."
    >
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={slash}
            onChange={(e) => setSlash(e.target.checked)}
          />
          <span>
            <span className="font-medium">"/" separates two reactions</span>
            <span className="block text-xs text-muted-foreground">
              Off by default: "Rash/Urticaria" is usually one reaction. Turn on only if this source
              writes "Fever/Rash" to mean two reactions.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={oneName}
            onChange={(e) => setOneName(e.target.checked)}
          />
          <span>
            <span className="font-medium">The product cell is one product name</span>
            <span className="block text-xs text-muted-foreground">
              Off by default: "Penta, OPV" is two suspect vaccines in one case. "MR/MV" is always
              kept as one name.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={!changed || saving} onClick={save}>
            {saving ? "Saving and rechecking…" : "Save"}
          </Button>
          {job.parsingOptions?.setBy ? (
            <span className="text-xs text-muted-foreground">
              Last set by {job.parsingOptions.setBy}
              {job.parsingOptions.setAt
                ? ` on ${new Date(job.parsingOptions.setAt).toLocaleString()}`
                : ""}
            </span>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

type Llt = { code: string; term: string };

/**
 * Reaction words in this line list that are not MedDRA terms (typos,
 * local phrasing), each decided once: accept the AI suggestion, ask for
 * one, or search the dictionary. The choice is remembered for the whole
 * organization and every affected line list is rechecked.
 */
export function ReactionTermsPanel({
  job,
  issues,
  onDecided,
}: {
  job: LineListJob;
  issues: LineListIssue[];
  onDecided: () => void;
}) {
  const terms = useMemo(() => {
    const byKey = new Map<string, { term: string; rows: number }>();
    for (const i of issues) {
      if (i.fixIn !== "REACTION_TERMS" || !i.value) continue;
      const key = reactionTermKey(i.value);
      const entry = byKey.get(key) ?? { term: i.value, rows: 0 };
      entry.rows += 1;
      byKey.set(key, entry);
    }
    return [...byKey.entries()].map(([key, v]) => ({ key, ...v }));
  }, [issues]);

  const [saved, setSaved] = useState<Record<string, OrgTermMapping>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Llt | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Llt[]>([]);

  useEffect(() => {
    if (terms.length === 0) return;
    termMappings
      .listAll()
      .then((all) => {
        const next: Record<string, OrgTermMapping> = {};
        for (const m of all) if (m.kind === "REACTION") next[m.termKey] = m;
        setSaved(next);
      })
      .catch(() => {
        /* suggestions are a convenience; the panel still works without */
      });
  }, [terms.length, job.checkedAt]);

  if (terms.length === 0) return null;

  async function accept(term: string, llt: Llt) {
    setBusy(term);
    try {
      await linelistApi.codeReactionTerm(job.id, term, llt);
      toast.success(`"${term}" will be coded as ${llt.term} (${llt.code}) in every line list.`);
      setSearchFor(null);
      onDecided();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that term.");
    } finally {
      setBusy(null);
    }
  }

  async function askAi(term: string) {
    setBusy(term);
    try {
      const match = await suggestMedDraTerm(term);
      const key = reactionTermKey(term);
      setSuggestions((s) => ({
        ...s,
        [key]: match ? { code: match.value, term: match.label } : null,
      }));
      if (!match) {
        toast.warning(`No MedDRA term found for "${term}". Try searching.`);
      } else if (saved[key]?.id) {
        // Keep the newer proposal, so the next person sees it too.
        await termMappings.saveAiSuggestion(saved[key]!.id, match).catch(() => {});
      }
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    if (!query.trim()) return;
    const wanted = query.trim().toLowerCase();
    const matches = await coding.searchDictionary("MedDRA", query.trim());
    // Exact term first, then the closest (shortest): a search for "Rash"
    // otherwise lists "Allergic rash" above "Rash" itself.
    const rank = (term: string) => (term.trim().toLowerCase() === wanted ? 0 : 1);
    setResults(
      matches
        .filter((m) => m.source === "dictionary")
        .sort((x, y) => rank(x.term) - rank(y.term) || x.term.length - y.term.length)
        .slice(0, 8)
        .map((m) => ({ code: m.code, term: m.term })),
    );
  }

  return (
    <Section
      id="reaction-terms"
      title={`Reaction terms to code (${terms.length})`}
      description="Reactions VigiFlow cannot accept because they are not MedDRA terms — typos or local phrasing. Choose the right term once; it is remembered for every line list."
    >
      <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
        {terms.map(({ key, term, rows }) => {
          const stored = saved[key];
          const fromAi = suggestions[key];
          const suggestion: Llt | null =
            fromAi ??
            (stored?.aiSuggestion
              ? { code: stored.aiSuggestion, term: stored.aiSuggestionLabel ?? stored.aiSuggestion }
              : null);
          return (
            <li key={key} className="rounded-md border border-border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">"{term}"</span>
                <span className="text-xs text-muted-foreground">
                  {rows} case{rows === 1 ? "" : "s"}
                </span>
                {suggestion ? (
                  <>
                    <StatusPill tone="assist" icon={<Sparkles className="size-3" />}>
                      AI: {suggestion.term} ({suggestion.code})
                    </StatusPill>
                    <Button
                      size="sm"
                      disabled={busy === term}
                      onClick={() => accept(term, suggestion)}
                    >
                      Use this term
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === term}
                  onClick={() => askAi(term)}
                >
                  <Sparkles className="size-3.5" />
                  {busy === term ? "Asking AI…" : suggestion ? "Ask AI again" : "Suggest with AI"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSearchFor(searchFor === term ? null : term);
                    setQuery(term);
                    setResults([]);
                  }}
                >
                  <Search className="size-3.5" /> Search MedDRA
                </Button>
              </div>
              {searchFor === term ? (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") search();
                      }}
                      placeholder="e.g. Pyrexia"
                    />
                    <Button size="sm" variant="outline" onClick={search}>
                      Search
                    </Button>
                  </div>
                  {results.length > 0 ? (
                    <ul className="space-y-1">
                      {results.map((r) => (
                        <li
                          key={r.code}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span>
                            {r.term}{" "}
                            <span className="mono-num text-muted-foreground">{r.code}</span>
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === term}
                            onClick={() => accept(term, r)}
                          >
                            Use
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
