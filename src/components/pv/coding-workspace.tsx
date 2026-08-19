import { useState } from "react";
import { BookOpen, Check, Search, X } from "lucide-react";
import { toast } from "sonner";
import { coding as codingApi } from "@/services/api/coding";
import { demoCodingHistory, demoCodingSuggestions } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import type { CodingSuggestion } from "@/types/pv";
import {
  AssistLabel,
  EmptyState,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
  type Tone,
} from "./primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNotConfigured } from "@/services/api/client";

const matchTone: Record<CodingSuggestion["matchType"], Tone> = {
  EXACT: "success",
  SYNONYM: "info",
  FUZZY: "warning",
  LLM_RANKED_CANDIDATE: "assist",
};

function SuggestionRow({ s, caseId }: { s: CodingSuggestion; caseId: string }) {
  const [busy, setBusy] = useState(false);

  async function act(kind: "accept" | "reject") {
    setBusy(true);
    try {
      if (kind === "accept") await codingApi.accept(caseId, s.id);
      else await codingApi.reject(caseId, s.id, "Rejected by reviewer");
      toast.success(`Coding ${kind}ed and recorded in the audit trail.`);
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — no coding decision was saved."
          : "The coding decision could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Verbatim:</span>
        <span className="text-sm font-medium">{s.sourceText}</span>
        <StatusPill tone="neutral">{s.kind === "DRUG" ? "Drug / product" : "Reaction"}</StatusPill>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className="text-sm font-semibold">{s.term}</span>
        <span className="mono-num text-xs text-muted-foreground">
          {s.dictionary} {s.code} · {s.dictionaryVersion}
        </span>
        <StatusPill tone={matchTone[s.matchType]}>
          {s.matchType.replaceAll("_", " ").toLowerCase()}
        </StatusPill>
        <StatusPill
          tone={s.confidence >= 0.9 ? "success" : s.confidence >= 0.7 ? "info" : "warning"}
        >
          confidence {(s.confidence * 100).toFixed(0)}%
        </StatusPill>
        {s.status !== "PENDING" ? (
          <StatusPill tone={s.status === "ACCEPTED" ? "success" : "critical"}>
            {s.status.toLowerCase()}
          </StatusPill>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{s.evidence}</p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => act("accept")}>
          <Check className="size-4" /> Accept
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act("reject")}>
          <X className="size-4" /> Reject
        </Button>
        <Button size="sm" variant="outline" disabled={busy}>
          <BookOpen className="size-4" /> Choose another term
        </Button>
      </div>
    </li>
  );
}

export function CodingWorkspace({ caseId }: { caseId: string }) {
  const suggestions = usePvQuery(
    ["coding", caseId],
    () => codingApi.getSuggestions(caseId),
    () => demoCodingSuggestions[caseId] ?? [],
  );
  const history = usePvQuery(
    ["coding-history", caseId],
    () => codingApi.history(caseId),
    () => demoCodingHistory,
  );
  const [dictQuery, setDictQuery] = useState("");
  const [dictDictionary, setDictDictionary] = useState<"MedDRA" | "WHODrug">("MedDRA");
  const [dictResults, setDictResults] = useState<
    | {
        term: string;
        code: string;
        dictionary: "MedDRA" | "WHODrug";
        dictionaryVersion: string;
        synonyms: string[];
      }[]
    | null
  >(null);
  const [dictSearching, setDictSearching] = useState(false);
  const [generating, setGenerating] = useState(false);

  return (
    <div className="space-y-4">
      <Section
        title="Coding assist"
        description="Candidate terms are retrieved from the dictionary services behind the API. The system never generates MedDRA or WHODrug codes."
        actions={
          <div className="flex items-center gap-2">
            <AssistLabel>Recommendations — confirmation required</AssistLabel>
            {suggestions.data ? <SourceTag source={suggestions.data.source} /> : null}
          </div>
        }
      >
        <QueryBoundary query={suggestions} loadingLabel="Requesting dictionary candidates">
          {(items) => {
            const drugs = items.filter((i) => i.kind === "DRUG");
            const reactions = items.filter((i) => i.kind === "REACTION");
            if (items.length === 0)
              return (
                <EmptyState
                  title="No coding candidates returned"
                  description="The coding engine has not returned candidates for this case yet."
                  action={
                    <Button
                      size="sm"
                      disabled={generating}
                      onClick={async () => {
                        setGenerating(true);
                        try {
                          const found = await codingApi.suggest(caseId);
                          if (found.length === 0)
                            toast.info(
                              "No dictionary matches found for this case's product or reaction text.",
                            );
                          else toast.success(`${found.length} candidate(s) generated.`);
                          suggestions.refetch();
                        } catch (err) {
                          toast.error(
                            isNotConfigured(err)
                              ? "Backend not connected — no candidates were generated."
                              : "Could not generate coding candidates.",
                          );
                        } finally {
                          setGenerating(false);
                        }
                      }}
                    >
                      <Search className="size-4" />{" "}
                      {generating ? "Searching dictionaries…" : "Generate coding candidates"}
                    </Button>
                  }
                />
              );
            return (
              <div className="space-y-5">
                <div>
                  <p className="label-caps mb-1">Drug / product coding (WHODrug)</p>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {drugs.length ? (
                      drugs.map((s) => <SuggestionRow key={s.id} s={s} caseId={caseId} />)
                    ) : (
                      <li className="px-3 py-4 text-sm text-muted-foreground">
                        No product candidates.
                      </li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="label-caps mb-1">Reaction coding (MedDRA)</p>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {reactions.length ? (
                      reactions.map((s) => <SuggestionRow key={s.id} s={s} caseId={caseId} />)
                    ) : (
                      <li className="px-3 py-4 text-sm text-muted-foreground">
                        No reaction candidates.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            );
          }}
        </QueryBoundary>

        <form
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setDictSearching(true);
            try {
              const results = await codingApi.searchDictionary(dictDictionary, dictQuery);
              setDictResults(results);
            } catch (err) {
              toast.error(
                isNotConfigured(err)
                  ? "Dictionary search requires the backend dictionary service."
                  : "Dictionary search failed.",
              );
            } finally {
              setDictSearching(false);
            }
          }}
        >
          <div className="min-w-56 flex-1">
            <label className="label-caps" htmlFor="dict-search">
              Search dictionary
            </label>
            <Input
              id="dict-search"
              className="mt-1"
              placeholder="Search MedDRA / WHODrug terms"
              value={dictQuery}
              onChange={(e) => setDictQuery(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={dictDictionary}
            onChange={(e) => setDictDictionary(e.target.value as "MedDRA" | "WHODrug")}
          >
            <option value="MedDRA">MedDRA (reactions)</option>
            <option value="WHODrug">WHODrug (drugs)</option>
          </select>
          <Button type="submit" variant="outline" size="sm" disabled={dictSearching}>
            <Search className="size-4" /> {dictSearching ? "Searching…" : "Search"}
          </Button>
        </form>

        {dictResults ? (
          dictResults.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No dictionary terms matched “{dictQuery}”.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {dictResults.map((r) => (
                <li
                  key={`${r.dictionary}-${r.code}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                >
                  <span className="text-sm font-medium">{r.term}</span>
                  <span className="mono-num text-xs text-muted-foreground">
                    {r.dictionary} {r.code} · {r.dictionaryVersion}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={async () => {
                      try {
                        await codingApi.addCandidate(
                          caseId,
                          r.dictionary === "WHODrug" ? "DRUG" : "REACTION",
                          dictQuery,
                          r,
                        );
                        toast.success(`Added ${r.term} as a coding candidate.`);
                        suggestions.refetch();
                      } catch (err) {
                        toast.error(
                          isNotConfigured(err)
                            ? "Backend not connected — the candidate was not added."
                            : "Could not add candidate.",
                        );
                      }
                    }}
                  >
                    Add as candidate
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Section>

      <Section title="Coding history" description="Every acceptance and rejection is recorded.">
        <QueryBoundary query={history}>
          {(entries) =>
            entries.length === 0 ? (
              <EmptyState title="No coding activity yet" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {entries.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="mono-num text-xs text-muted-foreground">
                      {h.at.replace("T", " ").slice(0, 16)} UTC
                    </span>
                    <span className="font-medium">{h.user}</span>
                    <span>{h.action}</span>
                    <span className="text-muted-foreground">{h.detail}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </Section>
    </div>
  );
}
