/**
 * Deterministic local-literature screening engine — the TypeScript port of
 * mednova_literature_screener.py. NAFDAC GVP requires weekly screening of
 * local (non-indexed) medical literature; this flags articles whose text
 * matches known pharmacovigilance safety keywords and rates their risk.
 * The AI assist (ai.literature.analyze) layers a structured clinical
 * reading on top — it never replaces this pass and never auto-decides.
 */

export interface LiteratureArticle {
  id: string;
  title: string;
  publication: string;
  /** YYYY-MM-DD */
  date: string;
  author: string;
  text: string;
  origin: "demo" | "user";
}

export type LiteratureRiskLevel = "HIGH" | "MODERATE";

export interface FlaggedLiteratureSignal {
  article: LiteratureArticle;
  keywords: string[];
  riskLevel: LiteratureRiskLevel;
  snippet: string;
  screenedAt: string;
}

const SAFETY_KEYWORDS = [
  "adverse\\s*(?:drug)?\\s*reaction",
  "adverse\\s*event",
  "side\\s*effect",
  "toxicity",
  "hepatotoxicity",
  "liver\\s*injury",
  "kidney\\s*damage",
  "renal\\s*failure",
  "anaphylaxis",
  "edema",
  "rash",
  "skin\\s*reaction",
  "cardiac",
  "arrhythmia",
  "hospitalization",
  "hospitalisation",
  "death",
  "fatal",
  "overdose",
  "counterfeit",
  "toxic",
].map((k) => new RegExp(k, "gi"));

const HIGH_RISK_TERMS = new Set([
  "toxicity",
  "hepatotoxicity",
  "liver injury",
  "fatal",
  "death",
  "counterfeit",
  "renal failure",
]);

function extractContext(text: string, keyword: string, charsContext = 80): string {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(escaped, "i").exec(text);
  if (!match) return `${text.slice(0, charsContext)}...`;
  const start = Math.max(0, match.index - Math.floor(charsContext / 2));
  const end = Math.min(text.length, match.index + match[0].length + Math.floor(charsContext / 2));
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet.replaceAll("\n", " ").trim();
}

export function screenArticle(article: LiteratureArticle): FlaggedLiteratureSignal | null {
  const corpus = `${article.title} ${article.text}`;
  const matches = new Set<string>();
  let highRisk = false;

  for (const pattern of SAFETY_KEYWORDS) {
    pattern.lastIndex = 0;
    for (const m of corpus.matchAll(pattern)) {
      const term = m[0].toLowerCase().trim();
      if (!term) continue;
      matches.add(term);
      if (HIGH_RISK_TERMS.has(term)) highRisk = true;
    }
  }

  if (matches.size === 0) return null;
  const keywords = [...matches].sort();

  return {
    article,
    keywords,
    riskLevel: highRisk ? "HIGH" : "MODERATE",
    snippet: extractContext(corpus, keywords[0]!),
    screenedAt: new Date().toISOString(),
  };
}

export function screenArticles(articles: LiteratureArticle[]): FlaggedLiteratureSignal[] {
  return articles
    .map(screenArticle)
    .filter((s): s is FlaggedLiteratureSignal => s !== null);
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * CSV in exactly the standardized schema from the technical hand-off
 * blueprint (§2.3): the transfer format between the screener and the
 * signals database.
 */
export function literatureSignalsToCsv(signals: FlaggedLiteratureSignal[]): string {
  const header = [
    "Signal ID",
    "Publication",
    "Headline",
    "Risk Level",
    "Keywords Detected",
    "Context Snippet",
    "Screening Date",
  ];
  const rows = signals.map((s) =>
    [
      s.article.id,
      s.article.publication,
      s.article.title,
      s.riskLevel,
      s.keywords.join("; "),
      s.snippet,
      s.screenedAt.slice(0, 10),
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(","),
  );
  return [header.map(csvEscape).join(","), ...rows].join("\n");
}

function demoId(id: string): string {
  return id;
}

export const DEMO_LITERATURE_ARTICLES: LiteratureArticle[] = [
  {
    id: demoId("AJMMS-2026-004"),
    title:
      "A review of therapeutic outcomes and adverse profiles in hypertensive cohorts in Ibadan",
    publication: "African Journal of Medicine and Medical Sciences",
    date: "2026-02-14",
    author: "Okeke et al.",
    origin: "demo",
    text: "A total of 120 patients on Amlodipine monotherapy were reviewed. Five patients reported severe peripheral edema and acute skin rash. One patient developed unexpected acute liver injury, raising potential drug safety concerns.",
  },
  {
    id: demoId("NMJ-2026-112"),
    title: "Efficacy of novel antimalarial combinations in pediatric populations in Kano",
    publication: "Nigerian Medical Journal",
    date: "2026-03-01",
    author: "Yusuf, A. & Bello, M.",
    origin: "demo",
    text: "We monitored 80 subjects undergoing therapy with Artemether-Lumefantrine. Mild nausea and headache were common, and resolved spontaneously. No severe adverse events or cardiac QT prolongation were observed.",
  },
  {
    id: demoId("LAGOS-HEALTH-NEWS"),
    title: "Suspected counterfeit paracetamol syrup batch flags toxicity scare in Lagos state",
    publication: "Lagos Health Watch",
    date: "2026-03-10",
    author: "Staff Reporter",
    origin: "demo",
    text: "The Ministry of Health has cautioned hospitals regarding a specific batch of paracetamol syrup following three cases of severe hepatotoxicity in young children. Adverse drug reactions were reported at Lagos State University Teaching Hospital (LASUTH).",
  },
  {
    id: demoId("AJMMS-2026-009"),
    title: "Managing diabetic neuropathy in urban clinical settings: A multi-center study",
    publication: "African Journal of Medicine and Medical Sciences",
    date: "2026-03-15",
    author: "Eze, C.",
    origin: "demo",
    text: "Metformin and Gabapentin combination was well-tolerated across the 200 enrolled patients. Glycemic control was optimized with minimal gastrointestinal discomfort and no major toxicities or drug-drug interactions reported.",
  },
];
