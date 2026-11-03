import {
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
import { FORWARD_METHOD_LABELS } from "@/services/api/holder-forwarding";
import { pct, type ActivityReport, type Count } from "./activity-report";

const p = (text: string, opts: { bold?: boolean; italics?: boolean } = {}) =>
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, ...opts })] });

const h = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun(text)],
  });

function cell(text: string, bold = false, width?: number) {
  return new TableCell({
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

function table(header: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((t) => cell(t, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((t) => cell(t)) })),
    ],
  });
}

const countTable = (label: string, counts: Count[], total: number) =>
  counts.length === 0
    ? p("None.", { italics: true })
    : table(
        [label, "Reports", "Share"],
        counts.map((c) => [c.name, String(c.count), pct(c.count, total)]),
      );

export function buildActivityReportDocx(r: ActivityReport, organisation: string): Document {
  const title =
    r.byMonth.length > 1 ? "Quarterly safety report" : "Monthly pharmacovigilance activity report";
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun(`${title} — ${r.period.label}`)],
          }),
          p(`${organisation} · period ${r.period.from} to ${r.period.to} · prepared ${r.today}`, {
            italics: true,
          }),
          p(
            "Counts are taken from the safety database as it stood when this report was prepared. Deadline figures describe today, not the end of the period.",
          ),

          h("1. Reports received"),
          table(
            ["Measure", "Number"],
            [
              ["Reports received", String(r.received)],
              ["Serious", `${r.serious} (${pct(r.serious, r.received)})`],
              ["Non-serious", String(r.nonSerious)],
              ["Not yet assessed", String(r.unassessed)],
              ["Fatal outcome", String(r.fatal)],
              ["Product not in the catalog", String(r.unlistedInPeriod)],
              ["Ready for submission or closed", String(r.readyOrClosed)],
            ],
          ),
          ...(r.byMonth.length > 1
            ? [h("By month"), countTable("Month", r.byMonth, r.received)]
            : []),

          h("2. Where reports came from"),
          countTable("Channel", r.byChannel, r.received),
          h("By branch"),
          countTable("Branch", r.byBranch, r.received),

          h("3. Products and reactions"),
          countTable("Product", r.topProducts, r.received),
          new Paragraph({ spacing: { after: 120 } }),
          countTable("Reaction (as reported)", r.topReactions, r.received),

          h("4. NAFDAC reporting timeliness (today)"),
          table(
            ["Measure", "Number"],
            [
              ["Open cases past their NAFDAC deadline", String(r.overdueNow)],
              ["Open cases due within 3 days", String(r.dueSoonNow)],
            ],
          ),
          p(
            "Deadline: 15 calendar days from receipt for serious and unassessed cases, 90 for non-serious.",
            {
              italics: true,
            },
          ),

          h("5. Third-party product reports"),
          p(
            `${r.forwardsInPeriod.length} report(s) forwarded to marketing authorisation holders in the period; ${r.awaitingForward} case(s) still to forward.`,
          ),
          ...(r.forwardsInPeriod.length
            ? [
                table(
                  ["Product", "Holder", "Sent", "How"],
                  r.forwardsInPeriod.map((f) => [
                    f.productName,
                    f.holder,
                    f.sentOn,
                    FORWARD_METHOD_LABELS[f.method],
                  ]),
                ),
              ]
            : []),

          h("6. Own-brand PSURs"),
          r.psur.length === 0
            ? p("No own-brand products are recorded.", { italics: true })
            : table(
                ["Product", "Data lock point", "Deadline", "Status"],
                r.psur.map((e) => [e.drug.name, e.nextDlp ?? "—", e.deadline ?? "—", e.label]),
              ),

          h("7. Registrations and commitments"),
          r.registrationAlerts.length === 0
            ? p("No registration renewals or commitments due.", { italics: true })
            : table(
                ["Product", "Date", "Alert"],
                r.registrationAlerts.map((a) => [a.productName, a.date, a.title]),
              ),
        ],
      },
    ],
  });
}

export async function downloadActivityReport(r: ActivityReport, organisation: string) {
  const blob = await Packer.toBlob(buildActivityReportDocx(r, organisation));
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `pv-activity-report-${r.period.label.replace(/\s+/g, "-")}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
