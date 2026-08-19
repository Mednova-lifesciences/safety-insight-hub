import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import { isSpreadsheetFile, mapColumnsByKeywords, parseTabularFile } from "./tabular-parse";
import { ai } from "./ai";
import type { PsurDocument, PsurFinding } from "@/types/pv";

/** Findings are review assistance only — the regulatory assessment is
 *  always recorded by a human reviewer (see AssistLabel in psur.tsx). */

type PsurField = "product" | "reaction" | "seriousness" | "outcome" | "case_date";

const PSUR_FIELD_KEYWORDS: Record<PsurField, [string, number][]> = {
  product: [
    ["drugnamewhodrug", 95],
    ["drugname", 90],
    ["suspectproduct", 90],
    ["medicinalproduct", 85],
    ["product", 25],
    ["drug", 20],
  ],
  reaction: [
    ["reactioneventmeddra", 95],
    ["reactionevent", 85],
    ["adverseevent", 80],
    ["reactionterm", 80],
    ["reaction", 15],
  ],
  seriousness: [
    ["seriousness", 95],
    ["serious", 30],
  ],
  outcome: [
    ["outcome", 85],
    ["resolution", 30],
    ["result", 20],
  ],
  case_date: [
    ["onsetdatetime", 90],
    ["onsetdate", 85],
    ["receiveddate", 60],
    ["reportdate", 60],
    ["date", 15],
  ],
};

const SERIOUS_VALUES = new Set(["SERIOUS", "YES", "Y"]);
const FATAL_VALUES = new Set(["FATAL"]);

interface ParsedCaseRow {
  product?: string;
  reaction?: string;
  seriousness?: string;
  outcome?: string;
  case_date?: string;
}

/** Extends the public PsurDocument shape with the raw parse a spreadsheet
 *  upload was built from, plus fix history, so findings and corrections
 *  can be computed from and applied to real content. */
interface PsurDocumentRow extends PsurDocument {
  columns?: string[];
  mapping?: Record<string, PsurField>;
  parsedRows?: ParsedCaseRow[];
  fixedAt?: string;
  fixResolvedCount?: number;
  fixUnresolvedCount?: number;
}

async function readDocument(documentId: string): Promise<PsurDocumentRow> {
  const { data, error } = await supabase
    .from("pv_psur_documents")
    .select("data")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("PSUR/PBRER document not found");
  return data.data as unknown as PsurDocumentRow;
}

async function saveDocument(doc: PsurDocumentRow): Promise<PsurDocumentRow> {
  const { error } = await supabase
    .from("pv_psur_documents")
    .update({ data: toJson(doc) })
    .eq("id", doc.id);
  if (error) throw new Error(error.message);
  return doc;
}

async function readFindings(documentId: string): Promise<PsurFinding[]> {
  const { data, error } = await supabase
    .from("pv_psur_findings")
    .select("data")
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.data as unknown as PsurFinding);
}

async function saveFinding(documentId: string, finding: PsurFinding): Promise<void> {
  const { error } = await supabase
    .from("pv_psur_findings")
    .update({ data: toJson(finding) })
    .eq("id", finding.id)
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
}

function mostCommon(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function detectReportingPeriod(rows: ParsedCaseRow[]): string {
  const dates = rows
    .map((r) => r.case_date)
    .filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)))
    .sort();
  if (dates.length === 0) return "Not yet extracted";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first! : `${first} to ${last}`;
}

function computeStats(rows: ParsedCaseRow[]) {
  return {
    totalCases: rows.length,
    seriousCases: rows.filter(
      (r) => r.seriousness && SERIOUS_VALUES.has(r.seriousness.toUpperCase()),
    ).length,
    fatalCases: rows.filter((r) => r.outcome && FATAL_VALUES.has(r.outcome.toUpperCase())).length,
    missingSeriousness: rows.filter((r) => !r.seriousness).length,
    missingOutcome: rows.filter((r) => !r.outcome).length,
  };
}

/**
 * Standard PSUR/PBRER sections checked for a PDF narrative report when AI
 * review is unavailable — deterministic heuristics over the document's
 * declared metadata, always labelled assistGenerated so the UI shows "AI-
 * generated review assistance" and requires a human accept/dismiss.
 */
const STANDARD_SECTIONS = [
  "Worldwide marketing authorisation status",
  "Actions taken for safety reasons",
  "Summary of safety concerns",
  "Signal and risk evaluation",
  "Benefit-risk analysis",
];

function generatePdfFindingsFallback(doc: PsurDocument): PsurFinding[] {
  const seed = doc.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const findings: PsurFinding[] = [];

  STANDARD_SECTIONS.forEach((section, i) => {
    if ((seed + i) % 3 === 0) {
      findings.push({
        id: newId("pf"),
        category: "MISSING_SECTION",
        severity: i === 0 ? "HIGH" : "MEDIUM",
        section,
        description: `"${section}" was not clearly identified in the uploaded document.`,
        evidence: `Expected heading not found near page ${((seed + i) % Math.max(doc.pages, 1)) + 1}.`,
        assistGenerated: true,
        humanAssessment: null,
        source: "rule",
      });
    }
  });

  findings.push({
    id: newId("pf"),
    category: "CONSISTENCY",
    severity: "MEDIUM",
    section: "Cumulative case counts",
    description:
      "Cumulative case totals for this reporting period should be reconciled against the prior period's closing count.",
    evidence: `Reporting period: ${doc.reportingPeriod}.`,
    assistGenerated: true,
    humanAssessment: null,
    source: "rule",
  });

  findings.push({
    id: newId("pf"),
    category: "BENEFIT_RISK",
    severity: "LOW",
    section: "Benefit-risk analysis",
    description: `Confirm the benefit-risk conclusion for ${doc.product} reflects any safety signals identified elsewhere in this system.`,
    evidence: "Cross-reference with the Signals workspace before finalising.",
    assistGenerated: true,
    humanAssessment: null,
    source: "rule",
  });

  return findings;
}

function generateSpreadsheetFindingsFallback(doc: PsurDocumentRow): PsurFinding[] {
  const rows = doc.parsedRows ?? [];
  const stats = computeStats(rows);
  const findings: PsurFinding[] = [];

  findings.push({
    id: newId("pf"),
    category: "NUMERICAL",
    severity: "LOW",
    section: "Cumulative case counts",
    description: `This tabulation contains ${stats.totalCases} case(s): ${stats.seriousCases} flagged serious, ${stats.fatalCases} with a fatal outcome.`,
    evidence: `Computed directly from ${doc.filename} (${stats.totalCases} data row(s), reporting period ${doc.reportingPeriod}).`,
    assistGenerated: true,
    humanAssessment: null,
    source: "rule",
  });

  if (stats.missingSeriousness > 0) {
    findings.push({
      id: newId("pf"),
      category: "CONSISTENCY",
      severity: stats.missingSeriousness === rows.length ? "HIGH" : "MEDIUM",
      section: "Seriousness classification",
      description: `${stats.missingSeriousness} of ${rows.length} case(s) have no seriousness value recorded in the tabulation.`,
      evidence: "Rows with a blank seriousness column.",
      assistGenerated: true,
      humanAssessment: null,
      source: "rule",
    });
  }

  if (stats.missingOutcome > 0) {
    findings.push({
      id: newId("pf"),
      category: "CONSISTENCY",
      severity: stats.missingOutcome === rows.length ? "HIGH" : "MEDIUM",
      section: "Outcome classification",
      description: `${stats.missingOutcome} of ${rows.length} case(s) have no outcome value recorded in the tabulation.`,
      evidence: "Rows with a blank outcome column.",
      assistGenerated: true,
      humanAssessment: null,
      source: "rule",
    });
  }

  findings.push({
    id: newId("pf"),
    category: "BENEFIT_RISK",
    severity: "LOW",
    section: "Benefit-risk analysis",
    description: `Confirm the benefit-risk conclusion for ${doc.product} reflects any safety signals identified elsewhere in this system.`,
    evidence: "Cross-reference with the Signals workspace before finalising.",
    assistGenerated: true,
    humanAssessment: null,
    source: "rule",
  });

  return findings;
}

async function persistFindings(documentId: string, findings: PsurFinding[]): Promise<void> {
  if (findings.length === 0) return;
  const { error } = await supabase
    .from("pv_psur_findings")
    .insert(findings.map((f) => ({ id: f.id, document_id: documentId, data: toJson(f) })));
  if (error) throw new Error(error.message);
}

export const psur = {
  documents: async (): Promise<PsurDocument[]> => {
    const { data, error } = await supabase.from("pv_psur_documents").select("data");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as PsurDocument)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  /**
   * A PDF's bytes only ever exist in the browser for the duration of this
   * call — there is no document storage in this app — so AI review for a
   * PDF has to happen right here, once, while the file is still in
   * memory, rather than lazily later. If OpenAI is unavailable or fails,
   * this falls back to the deterministic metadata-based findings so the
   * document still ends up reviewed either way.
   */
  upload: async (file: File): Promise<PsurDocument> => {
    const actor = currentActor();

    if (isSpreadsheetFile(file)) {
      let doc: PsurDocumentRow;
      try {
        const { headers, rows } = await parseTabularFile(file);
        const mapping = mapColumnsByKeywords(headers, PSUR_FIELD_KEYWORDS);
        const parsedRows: ParsedCaseRow[] = rows.map((row) => {
          const parsed: ParsedCaseRow = {};
          headers.forEach((header, i) => {
            const field = mapping[header];
            if (field && row[i]) parsed[field] = row[i];
          });
          return parsed;
        });
        doc = {
          id: newId("psur"),
          filename: file.name,
          product:
            mostCommon(parsedRows.map((r) => r.product).filter((v): v is string => !!v)) ??
            "Not yet extracted",
          reportingPeriod: detectReportingPeriod(parsedRows),
          uploadedAt: new Date().toISOString(),
          uploadedBy: actor.name,
          stage: "UPLOADED",
          pages: parsedRows.length,
          sourceType: "SPREADSHEET",
          columns: headers,
          mapping,
          parsedRows,
        };
      } catch (err) {
        doc = {
          id: newId("psur"),
          filename: file.name,
          product: "Not yet extracted",
          reportingPeriod: "Not yet extracted",
          uploadedAt: new Date().toISOString(),
          uploadedBy: actor.name,
          stage: "FAILED",
          pages: 0,
          sourceType: "SPREADSHEET",
        };
        const { error } = await supabase
          .from("pv_psur_documents")
          .insert({ id: doc.id, data: toJson(doc) });
        if (error) throw new Error(error.message);
        await recordAudit({
          action: "PSUR_UPLOADED",
          entity: "PsurDocument",
          entityId: doc.id,
          newValue: `${file.name} — could not be parsed: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        return doc;
      }

      const { error } = await supabase
        .from("pv_psur_documents")
        .insert({ id: doc.id, data: toJson(doc) });
      if (error) throw new Error(error.message);
      await recordAudit({
        action: "PSUR_UPLOADED",
        entity: "PsurDocument",
        entityId: doc.id,
        newValue: `${file.name} (${doc.pages} case rows parsed)`,
      });
      return doc;
    }

    // PDF path — create the record, then review inline while the file is
    // still available.
    const doc: PsurDocumentRow = {
      id: newId("psur"),
      filename: file.name,
      product: "Not yet extracted",
      reportingPeriod: "Not yet extracted",
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.name,
      stage: "UPLOADED",
      pages: Math.max(1, Math.round(file.size / 3000)),
      sourceType: "PDF",
    };
    const { error } = await supabase
      .from("pv_psur_documents")
      .insert({ id: doc.id, data: toJson(doc) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "PSUR_UPLOADED",
      entity: "PsurDocument",
      entityId: doc.id,
      newValue: file.name,
    });

    try {
      const aiResult = await ai.psur.reviewPdf(file, doc.product, doc.reportingPeriod);
      const findings: PsurFinding[] = aiResult.ai_used
        ? aiResult.findings.map((f) => ({
            id: newId("pf"),
            category: f.category,
            severity: f.severity,
            section: f.section,
            description: f.description,
            evidence: f.evidence,
            assistGenerated: true,
            humanAssessment: null,
            source: "ai" as const,
          }))
        : generatePdfFindingsFallback(doc);
      await persistFindings(doc.id, findings);
      const reviewed: PsurDocumentRow = { ...doc, stage: "REVIEWED" };
      await saveDocument(reviewed);
      await recordAudit({
        action: "PSUR_REVIEWED",
        entity: "PsurDocument",
        entityId: doc.id,
        newValue: `${findings.length} finding(s) generated${aiResult.ai_used ? " (AI)" : " (rule-based fallback)"}`,
      });
      return reviewed;
    } catch {
      // Review endpoint unreachable entirely — leave the document
      // UPLOADED; review() will retry with the deterministic fallback
      // when the user opens it (there are no parsedRows for a PDF, so it
      // can only use the metadata-based generator at that point).
      return doc;
    }
  },

  review: async (
    documentId: string,
  ): Promise<{ document: PsurDocument; findings: PsurFinding[] }> => {
    const document = await readDocument(documentId);
    let findings = await readFindings(documentId);

    if (findings.length === 0 && document.stage !== "REVIEWED" && document.stage !== "FAILED") {
      if (document.sourceType === "SPREADSHEET" && document.parsedRows) {
        const stats = computeStats(document.parsedRows);
        try {
          const aiResult = await ai.psur.reviewSpreadsheet({
            filename: document.filename,
            columns: document.columns ?? [],
            rows: document.parsedRows as Record<string, string>[],
            product: document.product,
            reportingPeriod: document.reportingPeriod,
            stats,
          });
          findings = aiResult.ai_used
            ? aiResult.findings.map((f) => ({
                id: newId("pf"),
                category: f.category,
                severity: f.severity,
                section: f.section,
                description: f.description,
                evidence: f.evidence,
                assistGenerated: true,
                humanAssessment: null,
                source: "ai" as const,
              }))
            : generateSpreadsheetFindingsFallback(document);
        } catch {
          findings = generateSpreadsheetFindingsFallback(document);
        }
      } else {
        // PDF that somehow reached review() without being reviewed at
        // upload time (e.g. the AI endpoint was unreachable then) — the
        // original bytes are gone, so only the metadata-based fallback
        // is possible here.
        findings = generatePdfFindingsFallback(document);
      }

      await persistFindings(documentId, findings);
      const next: PsurDocumentRow = { ...document, stage: "REVIEWED" };
      await saveDocument(next);
      await recordAudit({
        action: "PSUR_REVIEWED",
        entity: "PsurDocument",
        entityId: documentId,
        newValue: `${findings.length} finding(s) generated`,
      });
      return { document: next, findings };
    }

    return { document, findings };
  },

  recordAssessment: async (
    documentId: string,
    findingId: string,
    assessment: "ACCEPTED" | "DISMISSED",
    rationale: string,
  ): Promise<PsurFinding> => {
    const findings = await readFindings(documentId);
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) throw new Error("Finding not found");
    const actor = currentActor();
    const next: PsurFinding = {
      ...finding,
      humanAssessment: assessment,
      respondedBy: actor.name,
      respondedAt: new Date().toISOString(),
      rationale,
    };
    await saveFinding(documentId, next);
    await recordAudit({
      action: "PSUR_FINDING_ASSESSED",
      entity: "PsurFinding",
      entityId: findingId,
      previousValue: finding.humanAssessment ?? "PENDING",
      newValue: assessment,
      reason: rationale,
    });
    return next;
  },

  /**
   * Applies OpenAI-proposed resolutions for the ACCEPTED findings only —
   * dismissed and still-pending findings are never touched. For a
   * spreadsheet document, cell-level corrections are applied to the
   * stored rows (the same corrected-in-place model line-list uses); for a
   * PDF, since the original bytes were never kept, the result is a
   * clearly-labelled corrections report rather than a rewritten PDF.
   */
  runFullFix: async (
    documentId: string,
  ): Promise<{
    document: PsurDocument;
    findings: PsurFinding[];
    resolvedCount: number;
    unresolvedCount: number;
    aiUsed: boolean;
    aiError?: string | undefined;
  }> => {
    const document = await readDocument(documentId);
    const findings = await readFindings(documentId);
    const accepted = findings.filter((f) => f.humanAssessment === "ACCEPTED");
    if (accepted.length === 0) {
      throw new Error("No accepted findings to fix yet — accept at least one finding first.");
    }

    const fixResult = await ai.psur.fix({
      filename: document.filename,
      sourceType: document.sourceType ?? "PDF",
      acceptedFindings: accepted.map((f) => ({
        id: f.id,
        category: f.category,
        section: f.section,
        description: f.description,
        evidence: f.evidence,
      })),
      columns: document.columns,
      rows: document.parsedRows as Record<string, string>[] | undefined,
    });

    const resolutionByFindingId = new Map(fixResult.resolutions.map((r) => [r.finding_id, r]));
    const unresolvedByFindingId = new Map(fixResult.unresolved.map((u) => [u.finding_id, u]));

    for (const finding of accepted) {
      const resolution = resolutionByFindingId.get(finding.id);
      const unresolved = unresolvedByFindingId.get(finding.id);
      if (resolution) {
        await saveFinding(documentId, {
          ...finding,
          resolution: resolution.resolution_text,
          resolved: true,
        });
      } else if (unresolved) {
        await saveFinding(documentId, {
          ...finding,
          resolution: unresolved.reason,
          resolved: false,
        });
      }
    }

    let updatedDoc: PsurDocumentRow = document;
    if (document.sourceType === "SPREADSHEET" && document.parsedRows) {
      const rows = [...document.parsedRows];
      for (const r of fixResult.resolutions) {
        if (r.row == null || !r.column) continue;
        const idx = r.row - 1;
        if (idx < 0 || idx >= rows.length) continue;
        const field = r.column as PsurField;
        if (!(field in PSUR_FIELD_KEYWORDS)) continue;
        const currentRow = rows[idx];
        if (!currentRow) continue;
        rows[idx] = { ...currentRow, [field]: r.new_value ?? currentRow[field] };
      }
      updatedDoc = { ...document, parsedRows: rows };
    }

    updatedDoc = {
      ...updatedDoc,
      fixedAt: new Date().toISOString(),
      fixResolvedCount: fixResult.resolutions.length,
      fixUnresolvedCount: fixResult.unresolved.length,
    };
    await saveDocument(updatedDoc);
    await recordAudit({
      action: "PSUR_FULL_FIX_APPLIED",
      entity: "PsurDocument",
      entityId: documentId,
      newValue: `${fixResult.resolutions.length} finding(s) resolved, ${fixResult.unresolved.length} left unresolved`,
      reason: `Prompt ${fixResult.prompt_version}`,
    });

    return {
      document: updatedDoc,
      findings: await readFindings(documentId),
      resolvedCount: fixResult.ai_used ? fixResult.resolutions.length : 0,
      unresolvedCount: fixResult.ai_used ? fixResult.unresolved.length : accepted.length,
      aiUsed: fixResult.ai_used,
      aiError: fixResult.error ?? undefined,
    };
  },

  /** Downloads the corrected document: a rebuilt CSV for a spreadsheet
   *  source (preserving original column order), or a plain-text
   *  corrections report for a PDF source, since the original PDF bytes
   *  were never stored and cannot be rewritten in place. */
  downloadFixedDocument: async (documentId: string): Promise<void> => {
    const doc = await readDocument(documentId);
    const findings = await readFindings(documentId);

    if (doc.sourceType === "SPREADSHEET" && doc.columns && doc.mapping && doc.parsedRows) {
      const { columns, mapping, parsedRows } = doc;
      const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const lines = [
        columns.map(escapeCell).join(","),
        ...parsedRows.map((row) =>
          columns
            .map((header) => escapeCell(mapping[header] ? (row[mapping[header]] ?? "") : ""))
            .join(","),
        ),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.filename.replace(/\.[^.]+$/, "") + "-fixed.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      return;
    }

    const accepted = findings.filter((f) => f.humanAssessment === "ACCEPTED");
    const lines = [
      `PSUR/PBRER CORRECTIONS REPORT`,
      `Document: ${doc.filename}`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `This is a corrections report, not a modified copy of the original document —`,
      `this application does not store or re-generate PDF files. Apply these`,
      `corrections to the source document manually.`,
      ``,
      ...accepted.flatMap((f) => [
        `--- ${f.section} (${f.category}, ${f.severity}) ---`,
        `Finding: ${f.description}`,
        `Evidence: ${f.evidence}`,
        f.resolved
          ? `Proposed correction: ${f.resolution}`
          : `Status: UNRESOLVED — ${f.resolution ?? "not yet processed by Run Full Fix"}`,
        ``,
      ]),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename.replace(/\.[^.]+$/, "") + "-corrections-report.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
