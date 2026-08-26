import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Newspaper,
  ScanSearch,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ai, type AiLiteratureAnalysis } from "@/services/api/ai";
import { isNotConfigured } from "@/services/api/client";
import { recordAudit } from "@/services/api/db";
import { signals as signalsApi } from "@/services/api/signals";
import {
  DEMO_LITERATURE_ARTICLES,
  literatureSignalsToCsv,
  screenArticles,
  type FlaggedLiteratureSignal,
  type LiteratureArticle,
} from "@/services/literature/screener";
import { PageHeader, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_app/literature")({
  head: () => ({
    meta: [
      { title: "Literature screening — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Weekly local-literature surveillance: keyword screening plus AI-assisted clinical reading of Nigerian medical journals and health news.",
      },
      { property: "og:title", content: "Literature screening — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Automated local literature surveillance feeding the signal review queue.",
      },
    ],
  }),
  component: LiteratureScreeningPage,
});

interface ScreeningResult {
  flag: FlaggedLiteratureSignal;
  ai: AiLiteratureAnalysis | null;
  aiState: "idle" | "loading" | "done" | "unavailable";
  aiNote: string | null;
  dismissed: boolean;
  signalReference: string | null;
}

function newUserId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `usr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function LiteratureScreeningPage() {
  const [userArticles, setUserArticles] = useState<LiteratureArticle[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [screenedAt, setScreenedAt] = useState<string | null>(null);
  const [screening, setScreening] = useState(false);
  const [results, setResults] = useState<ScreeningResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const allArticles = useMemo(
    () => [...DEMO_LITERATURE_ARTICLES, ...userArticles],
    [userArticles],
  );
  const activeResults = useMemo(() => results.filter((r) => !r.dismissed), [results]);
  const highRiskCount = activeResults.filter((r) => r.flag.riskLevel === "HIGH").length;

  function updateResult(articleId: string, patch: Partial<ScreeningResult>) {
    setResults((prev) => prev.map((r) => (r.flag.article.id === articleId ? { ...r, ...patch } : r)));
  }

  async function runScreening() {
    setScreening(true);
    // A short pause makes the pass feel deliberate rather than instant —
    // this mirrors a batch job a reviewer watches complete.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const flagged = screenArticles(allArticles);
    setResults(
      flagged.map((flag) => ({
        flag,
        ai: null,
        aiState: "idle" as const,
        aiNote: null,
        dismissed: false,
        signalReference: null,
      })),
    );
    setScreenedAt(new Date().toISOString());
    setScreening(false);
    toast.success(
      `${allArticles.length} publication(s) screened — ${flagged.length} flagged for review.`,
    );
  }

  async function screenPasted() {
    const text = pastedText.trim();
    if (!text) return;
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    const article: LiteratureArticle = {
      id: newUserId(),
      title: firstLine.length > 8 ? firstLine.slice(0, 120) : "Pasted article text",
      publication: "Pasted by reviewer",
      date: new Date().toISOString().slice(0, 10),
      author: "Manual submission",
      text,
      origin: "user",
    };
    setUserArticles((prev) => [...prev, article]);
    setPastedText("");
    const flag = screenArticles([article])[0];
    if (!flag) {
      toast.info("No safety keywords matched the pasted text.");
      return;
    }
    setResults((prev) => [
      ...prev.filter((r) => r.flag.article.id !== article.id),
      {
        flag,
        ai: null,
        aiState: "idle",
        aiNote: null,
        dismissed: false,
        signalReference: null,
      },
    ]);
    setScreenedAt((prev) => prev ?? new Date().toISOString());
    toast.success(`Pasted text flagged (${flag.riskLevel} risk).`);
  }

  function onFileChosen(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (text.trim()) {
        setPastedText(text.slice(0, 20_000));
        toast.info("File loaded — review the text, then screen it.");
      }
    };
    reader.readAsText(file);
  }

  async function analyzeWithAi(result: ScreeningResult) {
    const id = result.flag.article.id;
    updateResult(id, { aiState: "loading", aiNote: null });
    try {
      const res = await ai.literature.analyze({
        title: result.flag.article.title,
        text: result.flag.article.text,
      });
      if (!res.ai_used || !res.analysis) {
        updateResult(id, {
          aiState: "unavailable",
          aiNote: res.error ?? "AI analysis unavailable — keyword results only.",
        });
        return;
      }
      updateResult(id, { aiState: "done", ai: res.analysis, aiNote: res.model ?? null });
    } catch {
      updateResult(id, {
        aiState: "unavailable",
        aiNote: "AI analysis failed — keyword results only.",
      });
    }
  }

  async function createSignal(result: ScreeningResult) {
    const id = result.flag.article.id;
    try {
      const created = await signalsApi.createLiteratureSignal({
        product: result.ai?.products[0] ?? "Unspecified product",
        reaction: result.ai?.reaction_terms[0] ?? "Unspecified reaction",
        literature: {
          articleId: result.flag.article.id,
          publication: result.flag.article.publication,
          headline: result.flag.article.title,
          publicationDate: result.flag.article.date,
          author: result.flag.article.author,
          keywords: result.flag.keywords,
          contextSnippet: result.flag.snippet,
          riskLevel: result.flag.riskLevel,
        },
      });
      toast.success(`Signal ${created.reference} created — awaiting review on the Signal page.`);
      updateResult(id, { signalReference: created.reference });
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the signal was not created."
          : "Could not create the signal.",
      );
    }
  }

  function dismiss(result: ScreeningResult) {
    updateResult(result.flag.article.id, { dismissed: true });
    void recordAudit({
      action: "LITERATURE_FINDING_DISMISSED",
      entity: "LiteratureArticle",
      entityId: result.flag.article.id,
      newValue: `${result.flag.article.publication}: ${result.flag.article.title}`,
      reason: "Reviewed — not actionable",
    });
  }

  function exportCsv() {
    const csv = literatureSignalsToCsv(activeResults.map((r) => r.flag));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mednova_literature_safety_signals.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Literature screening"
        description="Weekly local-literature surveillance required by NAFDAC GVP: journals and health news that global indexes never see. The keyword engine flags first; the AI assist adds a structured clinical reading; a human decides what becomes a signal."
        actions={
          <Button variant="outline" size="sm" disabled={activeResults.length === 0} onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="rounded-md border border-info/30 bg-info-soft px-3 py-2 text-xs text-foreground">
          Keyword flags are triage signals only — they never auto-create anything. Creating a
          signal records an audited POTENTIAL entry on the Signal review page, where a qualified
          reviewer confirms or refutes it.
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="panel space-y-3 p-4">
            <p className="label-caps">Weekly corpus</p>
            <p className="text-sm text-muted-foreground">
              {DEMO_LITERATURE_ARTICLES.length} indexed local publications are pre-loaded for this
              demonstration{userArticles.length > 0 ? `, plus ${userArticles.length} you added` : ""}.
              In production this runs nightly against journal RSS feeds and health news sources.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={screening} onClick={runScreening}>
                <ScanSearch className="size-4" /> {screening ? "Screening…" : "Run screening now"}
              </Button>
              {screenedAt ? (
                <span className="mono-num text-xs text-muted-foreground">
                  Last screened {screenedAt.slice(0, 16).replace("T", " ")}
                </span>
              ) : null}
            </div>
            {results.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  ["Flagged", String(results.length)],
                  ["High risk", String(highRiskCount)],
                  ["Signals created", String(results.filter((r) => r.signalReference).length)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border px-3 py-2">
                    <p className="label-caps">{label}</p>
                    <p className="mono-num mt-0.5 text-xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel space-y-3 p-4">
            <p className="label-caps">Screen your own article</p>
            <Textarea
              rows={5}
              placeholder="Paste the article's text here (title on the first line helps), then screen it…"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={!pastedText.trim()} onClick={screenPasted}>
                <ScanSearch className="size-4" /> Screen pasted text
              </Button>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Load .txt / .md file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onFileChosen(f);
                }}
              />
            </div>
          </section>
        </div>

        {results.length > 0 ? (
          <section className="space-y-3">
              <p className="label-caps">Flagged publications</p>
            {results.map((r) => (
              <article key={r.flag.article.id} className="panel space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <Newspaper className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.flag.article.title}</p>
                    <p className="mono-num mt-0.5 text-xs text-muted-foreground">
                      {r.flag.article.publication} · {r.flag.article.date} ·{" "}
                      {r.flag.article.author}
                    </p>
                  </div>
                  <StatusPill tone={r.flag.riskLevel === "HIGH" ? "critical" : "warning"}>
                    {r.flag.riskLevel} risk
                  </StatusPill>
                  <StatusPill tone={r.flag.article.origin === "demo" ? "neutral" : "info"}>
                    {r.flag.article.origin === "demo" ? "Demo corpus" : "Pasted"}
                  </StatusPill>
                  {r.signalReference ? (
                    <StatusPill tone="success">Signal {r.signalReference}</StatusPill>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {r.flag.keywords.map((k) => (
                    <StatusPill key={k} tone="assist">
                      {k}
                    </StatusPill>
                  ))}
                </div>

                <p className="border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
                  {r.flag.snippet}
                </p>

                {r.aiState === "done" && r.ai ? (
                  <div className="space-y-2 rounded-md border border-assist/30 bg-assist-soft px-3 py-2.5 text-sm">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-assist">
                      <Sparkles className="size-3.5" /> AI assist — review before acting
                      {r.aiNote ? (
                        <span className="font-normal text-muted-foreground">· {r.aiNote}</span>
                      ) : null}
                    </p>
                    <p>{r.ai.summary}</p>
                    {r.ai.products.length > 0 || r.ai.reaction_terms.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {r.ai.products.map((p) => (
                          <StatusPill key={`p-${p}`} tone="neutral">
                            {p}
                          </StatusPill>
                        ))}
                        {r.ai.reaction_terms.map((t) => (
                          <StatusPill key={`r-${t}`} tone="warning">
                            {t}
                          </StatusPill>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{r.ai.rationale}</p>
                  </div>
                ) : null}
                {r.aiState === "unavailable" ? (
                  <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
                    {r.aiNote}
                  </div>
                ) : null}
                {r.aiState === "loading" ? (
                  <p className="animate-pulse text-xs text-muted-foreground">Analyzing with AI…</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={r.aiState === "loading" || r.aiState === "done"}
                    onClick={() => analyzeWithAi(r)}
                  >
                    <Sparkles className="size-4" />
                    {r.aiState === "done" ? "AI analysis applied" : "Analyze with AI"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!!r.signalReference}
                    onClick={() => createSignal(r)}
                  >
                    Create signal
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => dismiss(r)}>
                    <X className="size-4" /> Dismiss
                  </Button>
                  {r.signalReference ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/signals">View on Signal review</Link>
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}
