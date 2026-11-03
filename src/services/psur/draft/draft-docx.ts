import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { PsurDraft } from "./drafts";
import {
  ABBREVIATIONS,
  intervalFrom,
  longDate,
  printsIn,
  sectionBlocks,
  type Block,
} from "./content";
import { SECTIONS, sectionHeading, type DraftSectionId } from "./template";
import { draftReadiness } from "./status";

export type DraftVersion = "working" | "clean";

const FONT = "Calibri";

interface RunOpts {
  bold?: boolean | undefined;
  italics?: boolean | undefined;
  highlight?: boolean | undefined;
  color?: string | undefined;
  size?: number | undefined;
}

function runs(text: string, opts: RunOpts = {}): TextRun[] {
  return text.split("\n").map(
    (line, i) =>
      new TextRun({
        text: line,
        font: FONT,
        ...(i > 0 ? { break: 1 } : {}),
        ...(opts.bold ? { bold: true } : {}),
        ...(opts.italics ? { italics: true } : {}),
        ...(opts.color ? { color: opts.color } : {}),
        ...(opts.size ? { size: opts.size } : {}),
        ...(opts.highlight ? { highlight: "yellow" as const } : {}),
      }),
  );
}

function originSuffix(b: Block, version: DraftVersion): TextRun[] {
  if (version === "clean") return [];
  const label =
    b.origin === "RECORDS"
      ? "from records"
      : b.origin === "AUTHOR"
        ? "author"
        : b.origin === "NA"
          ? "not applicable"
          : "";
  return label
    ? [new TextRun({ text: `  [${label}]`, color: "808080", size: 16, font: FONT })]
    : [];
}

function style(b: Block) {
  return {
    highlight: b.origin === "PLACEHOLDER",
    italics: b.origin === "NA" || b.origin === "AID",
    color: b.origin === "AID" ? "666666" : undefined,
  };
}

function cell(
  text: string,
  opts: {
    bold?: boolean | undefined;
    shade?: boolean | undefined;
    width?: number | undefined;
    highlight?: boolean | undefined;
  } = {},
) {
  return new TableCell({
    ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
    ...(opts.shade ? { shading: { type: ShadingType.CLEAR, fill: "EDEFF2", color: "auto" } } : {}),
    children: [
      new Paragraph({
        children: runs(text, { bold: opts.bold, size: 18, highlight: opts.highlight }),
      }),
    ],
  });
}

/** Turns blocks into document elements; consecutive fields become one table. */
function render(blocks: Block[], version: DraftVersion): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let fields: Extract<Block, { kind: "field" }>[] = [];
  const flush = () => {
    if (!fields.length) return;
    out.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: fields.map(
          (f) =>
            new TableRow({
              children: [
                cell(f.label, { bold: true, shade: true, width: 32 }),
                cell(
                  f.value +
                    (version === "working" && f.origin !== "FIXED" && f.origin !== "PLACEHOLDER"
                      ? `  [${f.origin === "RECORDS" ? "from records" : "author"}]`
                      : ""),
                  {
                    width: 68,
                    highlight: f.origin === "PLACEHOLDER",
                  },
                ),
              ],
            }),
        ),
      }),
      new Paragraph({ spacing: { after: 120 } }),
    );
    fields = [];
  };
  for (const b of blocks.filter((x) => printsIn(x, version))) {
    if (b.kind === "field") {
      fields.push(b);
      continue;
    }
    flush();
    if (b.kind === "subheading") {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
          children: runs(b.text),
        }),
      );
    } else if (b.kind === "para") {
      out.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            ...(b.origin === "AID"
              ? [
                  new TextRun({
                    text: "Author aid (working draft only): ",
                    italics: true,
                    color: "666666",
                    font: FONT,
                  }),
                ]
              : []),
            ...runs(b.text, style(b)),
            ...originSuffix(b, version),
          ],
        }),
      );
    } else {
      out.push(
        new Paragraph({
          spacing: { before: 80, after: 60 },
          children: [
            ...runs(b.caption, { bold: true, size: 18, ...style(b) }),
            ...originSuffix(b, version),
          ],
        }),
        b.rows.length
          ? new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: b.headers.map((h) => cell(h, { bold: true, shade: true })),
                }),
                ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
              ],
            })
          : new Paragraph({ children: runs("No rows.", { italics: true, size: 18 }) }),
      );
      if (b.note)
        out.push(
          new Paragraph({
            spacing: { before: 40 },
            children: runs(b.note, { italics: true, size: 16, color: "666666" }),
          }),
        );
      out.push(new Paragraph({ spacing: { after: 120 } }));
    }
  }
  flush();
  return out;
}

const heading = (
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1,
) =>
  new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT })],
  });

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

export function buildDraftDocx(draft: PsurDraft, version: DraftVersion): Document {
  if (version === "clean" && !draftReadiness(draft).cleanAllowed)
    throw new Error("The clean draft needs every section reviewed or marked not applicable.");
  const blocks = (id: DraftSectionId) => render(sectionBlocks(draft, id), version);
  const interval = `${longDate(intervalFrom(draft))} to ${longDate(draft.dlp)}`;
  const body = SECTIONS.filter((s) => s.number);

  const children: (Paragraph | Table)[] = [
    ...(version === "working"
      ? [
          new Paragraph({
            spacing: { after: 200 },
            children: runs(
              "WORKING DRAFT — not for submission. Highlighted text must be completed by the author; bracketed tags show where each part comes from.",
              { bold: true, color: "B45309" },
            ),
          }),
        ]
      : []),
    heading("Cover letter"),
    ...blocks("COVER_LETTER"),
    pageBreak(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 200 },
      children: runs("PERIODIC SAFETY UPDATE REPORT (PSUR / PBRER)", { bold: true, size: 36 }),
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: runs(`${draft.productName} · ${interval}`, { size: 26 }),
    }),
    ...blocks("TITLE_PAGE"),
    pageBreak(),
    heading("Table of contents"),
    ...["Executive summary", ...body.map(sectionHeading)].map(
      (t) => new Paragraph({ spacing: { after: 40 }, children: runs(t) }),
    ),
    heading("List of abbreviations"),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: ABBREVIATIONS.map(
        ([a, d]) =>
          new TableRow({ children: [cell(a, { bold: true, width: 20 }), cell(d, { width: 80 })] }),
      ),
    }),
    pageBreak(),
    heading("Executive summary"),
    ...blocks("EXEC_SUMMARY"),
    pageBreak(),
    ...body.flatMap((s) => [heading(sectionHeading(s)), ...blocks(s.id)]),
  ];

  const footerText =
    version === "working"
      ? "Working draft — not for submission"
      : "Confidential — submitted to NAFDAC for regulatory purposes only";

  return new Document({
    creator: "MedNova PV Assist",
    title: `PSUR ${draft.productName} DLP ${draft.dlp}`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: runs(`PSUR — ${draft.productName} — DLP ${longDate(draft.dlp)}`, {
                  size: 16,
                  color: "666666",
                }),
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${footerText} · Page `,
                    size: 16,
                    color: "666666",
                    font: FONT,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: "666666",
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

export async function downloadDraftDocx(draft: PsurDraft, version: DraftVersion): Promise<void> {
  const blob = await Packer.toBlob(buildDraftDocx(draft, version));
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `PSUR-${draft.productName.replace(/[^a-z0-9]+/gi, "-")}-DLP-${draft.dlp}-${version}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
