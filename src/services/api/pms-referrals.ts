import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import {
  PATTERN_NOTES,
  QUALITY_SIGN_LABELS,
  type ClusterFlag,
  type ClusterPattern,
  type QualitySignFound,
} from "./linelist-clusters";

/**
 * Referrals of a batch or facility flag to NAFDAC post-market surveillance
 * (PMS) for laboratory testing. A referral records a possible quality
 * concern and asks for it to be tested; it is never a finding that a
 * product is substandard or falsified, and the note says so. Stored in
 * pv_pms_referrals (RLS: the organisation's administrators), audited.
 */

export interface PmsReferral {
  id: string;
  reference: string;
  flagKey: string;
  kind: ClusterFlag["kind"];
  label: string;
  products: string[];
  batches: string[];
  facilities: string[];
  from: string;
  to: string;
  pattern: ClusterPattern;
  patternNote: string;
  warningSigns: QualitySignFound[];
  cases: { jobId: string; filename: string; row: number; caseId?: string | undefined }[];
  reviewerNote: string;
  status: "REFERRED";
  referredBy: string;
  referredAt: string;
}

/** The referral record for one flag, as it stands now. Pure — for tests. */
export function referralFromFlag(
  flag: ClusterFlag,
  reviewerNote: string,
  actor: { name: string },
  now = new Date(),
): PmsReferral {
  return {
    id: newId("pms"),
    reference: `PMS-${now.getUTCFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    flagKey: flag.key,
    kind: flag.kind,
    label: flag.label,
    products: flag.products,
    batches: flag.batches,
    facilities: flag.facilities,
    from: flag.from,
    to: flag.to,
    pattern: flag.pattern,
    patternNote: PATTERN_NOTES[flag.pattern],
    warningSigns: flag.warningSigns,
    cases: flag.cases.map((c) => ({
      jobId: c.jobId,
      filename: c.filename,
      row: c.row,
      caseId: c.caseId,
    })),
    reviewerNote: reviewerNote.trim(),
    status: "REFERRED",
    referredBy: actor.name,
    referredAt: now.toISOString(),
  };
}

export const pmsReferrals = {
  /** Every referral of the organisation, by the flag it was raised from. */
  byFlag: async (): Promise<Map<string, PmsReferral>> => {
    const { data, error } = await supabase.from("pv_pms_referrals").select("data");
    if (error) throw new Error(error.message);
    const out = new Map<string, PmsReferral>();
    for (const r of data ?? []) {
      const ref = r.data as unknown as PmsReferral;
      out.set(ref.flagKey, ref);
    }
    return out;
  },

  refer: async (flag: ClusterFlag, reviewerNote: string): Promise<PmsReferral> => {
    if (reviewerNote.trim().length < 10)
      throw new Error("Add a note for post-market surveillance (at least 10 characters).");
    const referral = referralFromFlag(flag, reviewerNote, currentActor());
    const { error } = await supabase
      .from("pv_pms_referrals")
      .insert({ id: referral.id, data: toJson(referral) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "PMS_REFERRAL_CREATED",
      entity: "PmsReferral",
      entityId: referral.id,
      newValue: `${referral.reference}: ${referral.label} — ${referral.cases.length} case(s), ${referral.facilities.length} facility(ies)`,
      reason: referral.reviewerNote,
    });
    return referral;
  },

  /** Downloads the referral note (Word) and records that it was issued. */
  downloadNote: async (referral: PmsReferral): Promise<void> => {
    const blob = await Packer.toBlob(buildReferralDocx(referral));
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${referral.reference}-pms-referral.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
    await recordAudit({
      action: "PMS_REFERRAL_NOTE_DOWNLOADED",
      entity: "PmsReferral",
      entityId: referral.id,
      newValue: referral.reference,
    });
  },
};

const p = (text: string, bold = false) =>
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, bold })] });

function row(label: string, value: string): TableRow {
  const cell = (text: string, bold: boolean, width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    });
  return new TableRow({ children: [cell(label, true, 30), cell(value || "—", false, 70)] });
}

export function buildReferralDocx(r: PmsReferral): Document {
  const signs = r.warningSigns.length
    ? r.warningSigns.map((s) => `${QUALITY_SIGN_LABELS[s.sign]} (${s.cases.join(", ")})`)
    : ["None found in the cases"];
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Referral to Post-Market Surveillance")],
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `${r.reference} · possible quality concern for laboratory testing`,
                italics: true,
              }),
            ],
          }),
          p(
            "This note refers a pattern in adverse-event line lists for laboratory testing. It records a possible quality concern only. It is not a finding that the product is substandard or falsified.",
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
              insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
            },
            rows: [
              row("Flag", `${r.kind === "BATCH" ? "Batch" : "Facility"} — ${r.label}`),
              row("Product(s)", r.products.join(", ")),
              row("Batch(es)", r.batches.join(", ")),
              row("Facilities", r.facilities.join(", ")),
              row("Dates", `${r.from} to ${r.to}`),
              row("Serious cases", String(r.cases.length)),
              row("What the pattern suggests", r.patternNote),
              row("Quality warning signs", signs.join("; ")),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240 },
            children: [new TextRun("Cases")],
          }),
          ...r.cases.map((c) => p(`${c.caseId ?? "No case ID"} — ${c.filename}, row ${c.row}`)),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240 },
            children: [new TextRun("Reviewer's note")],
          }),
          p(r.reviewerNote),
          p(`Referred by ${r.referredBy} on ${r.referredAt.slice(0, 10)}.`),
          p(
            "Requested: sampling and laboratory testing of the batch(es) above, and a review of storage and handling at the facilities listed.",
          ),
        ],
      },
    ],
  });
}
