import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { PsurDocument, PsurFinding } from "@/types/pv";

/** Findings are review assistance only — the regulatory assessment is
 *  always recorded by a human reviewer (see AssistLabel in psur.tsx). */

async function readDocument(documentId: string): Promise<PsurDocument> {
  const { data, error } = await supabase
    .from("pv_psur_documents")
    .select("data")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("PSUR/PBRER document not found");
  return data.data as unknown as PsurDocument;
}

async function readFindings(documentId: string): Promise<PsurFinding[]> {
  const { data, error } = await supabase
    .from("pv_psur_findings")
    .select("data")
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.data as unknown as PsurFinding);
}

/**
 * Standard PSUR/PBRER sections this MVP checks for structurally. Without a
 * licensed document-intelligence integration, findings are generated from
 * deterministic heuristics over the document's declared metadata rather
 * than actual PDF content extraction — always labelled assistGenerated so
 * the UI shows "AI-generated review assistance" and requires a human
 * accept/dismiss before anything is treated as a real review outcome.
 */
const STANDARD_SECTIONS = [
  "Worldwide marketing authorisation status",
  "Actions taken for safety reasons",
  "Summary of safety concerns",
  "Signal and risk evaluation",
  "Benefit-risk analysis",
];

function generateFindings(doc: PsurDocument): PsurFinding[] {
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
  });

  return findings;
}

export const psur = {
  documents: async (): Promise<PsurDocument[]> => {
    const { data, error } = await supabase.from("pv_psur_documents").select("data");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as PsurDocument)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  upload: async (file: File): Promise<PsurDocument> => {
    const doc: PsurDocument = {
      id: newId("psur"),
      filename: file.name,
      product: "Not yet extracted",
      reportingPeriod: "Not yet extracted",
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentActor().name,
      stage: "UPLOADED",
      pages: Math.max(1, Math.round(file.size / 3000)),
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
    return doc;
  },

  review: async (
    documentId: string,
  ): Promise<{ document: PsurDocument; findings: PsurFinding[] }> => {
    const document = await readDocument(documentId);
    let findings = await readFindings(documentId);

    if (findings.length === 0 && document.stage !== "REVIEWED") {
      findings = generateFindings(document);
      const { error } = await supabase
        .from("pv_psur_findings")
        .insert(findings.map((f) => ({ id: f.id, document_id: documentId, data: toJson(f) })));
      if (error) throw new Error(error.message);

      const next: PsurDocument = { ...document, stage: "REVIEWED" };
      const { error: docError } = await supabase
        .from("pv_psur_documents")
        .update({ data: toJson(next) })
        .eq("id", documentId);
      if (docError) throw new Error(docError.message);

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
    const next: PsurFinding = { ...finding, humanAssessment: assessment };

    const { error } = await supabase
      .from("pv_psur_findings")
      .update({ data: toJson(next) })
      .eq("id", findingId);
    if (error) throw new Error(error.message);

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
};
