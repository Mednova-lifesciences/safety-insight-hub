import type { PsurDraft } from "./drafts";
import type { DraftFacts, LineListingRow } from "./facts";
import { INPUTS, SECTIONS, type DraftSectionId, type InputKey, type SectionDef } from "./template";
import { addDaysIso } from "@/services/api/regulatory-clock";

/**
 * What each section of the draft says, as blocks tagged with where they came
 * from. The workspace preview and the Word export both render these blocks,
 * so what a reviewer accepts is exactly what prints.
 *
 *   RECORDS      fixed wording filled with facts from the safety database
 *   AUTHOR       the author's own text, printed as written
 *   PLACEHOLDER  a required input is empty — printed highlighted, blocks the clean draft
 *   NA           the author's "not applicable" statement
 *   AID          help for the author (e.g. literature hits); working draft only
 *   FIXED        standard wording (headings, addressee, confidentiality, signature lines)
 *
 * Nothing here composes new claims: every sentence is either fixed wording,
 * a number or date taken from the facts, or the author's text.
 */

export type BlockOrigin = "RECORDS" | "AUTHOR" | "PLACEHOLDER" | "NA" | "AID" | "FIXED";

export type Block =
  | { kind: "subheading"; text: string; origin: BlockOrigin }
  | { kind: "para"; text: string; origin: BlockOrigin }
  | { kind: "field"; label: string; value: string; origin: BlockOrigin }
  | {
      kind: "table";
      caption: string;
      headers: string[];
      rows: string[][];
      origin: BlockOrigin;
      note?: string | undefined;
    };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 2026-08-31 → 31 August 2026 */
export function longDate(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const intervalFrom = (d: Pick<PsurDraft, "periodStart">) =>
  addDaysIso(d.periodStart, 1) ?? d.periodStart;

export const placeholderText = (key: InputKey) =>
  `[TO BE COMPLETED BY AUTHOR — ${INPUTS[key].label}: ${INPUTS[key].hint}]`;

const has = (v: string | undefined): v is string => !!v && v.trim().length > 0;

/** The author's text for an input, or a placeholder block. Optional inputs
 *  that are empty produce nothing. */
function input(draft: PsurDraft, key: InputKey, label?: string): Block[] {
  const v = draft.inputs[key];
  if (has(v)) {
    return label
      ? [{ kind: "field", label, value: v.trim(), origin: "AUTHOR" }]
      : [{ kind: "para", text: v.trim(), origin: "AUTHOR" }];
  }
  if (!INPUTS[key].required) return [];
  return label
    ? [{ kind: "field", label, value: placeholderText(key), origin: "PLACEHOLDER" }]
    : [{ kind: "para", text: placeholderText(key), origin: "PLACEHOLDER" }];
}

const value = (draft: PsurDraft, key: InputKey) => {
  const v = draft.inputs[key];
  return has(v) ? v.trim() : undefined;
};

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function noFacts(): Block[] {
  return [
    {
      kind: "para",
      text: "[DATA NOT YET TAKEN FROM THE RECORDS — refresh the data in the draft workspace.]",
      origin: "PLACEHOLDER",
    },
  ];
}

function sourceNote(f: DraftFacts): string {
  return `Source: ${f.source}; data extracted ${longDate(f.takenAt)}.`;
}

function safetyDataSentence(d: PsurDraft, f: DraftFacts): string {
  const i = f.interval;
  const c = f.cumulative;
  const fatal = i.fatal ? ` (${n(i.fatal, "with a fatal outcome", "with a fatal outcome")})` : "";
  return (
    `During the reporting interval (${longDate(intervalFrom(d))} to ${longDate(d.dlp)}), ` +
    `${n(i.total, "individual case safety report (ICSR)", "individual case safety reports (ICSRs)")} ` +
    `concerning ${d.productName} ${i.total === 1 ? "was" : "were"} recorded, ` +
    `of which ${i.serious} ${i.serious === 1 ? "was" : "were"} serious${fatal}, ` +
    `${i.nonSerious} non-serious and ${i.unassessed} not yet assessed for seriousness; ` +
    `${i.nigerian} ${i.nigerian === 1 ? "was" : "were"} reported from Nigeria. ` +
    `Cumulatively to the data lock point, ${n(c.total, "ICSR has", "ICSRs have")} been recorded ` +
    `(${c.serious} serious, ${c.nigerian} from Nigeria).`
  );
}

const SIGNAL_STATE: Record<string, string> = {
  POTENTIAL: "New",
  UNDER_REVIEW: "Ongoing",
  MONITOR: "Ongoing (monitoring)",
  CONFIRMED: "Closed — confirmed",
  REFUTED: "Closed — refuted",
};

function signalsSentence(d: PsurDraft, f: DraftFacts): string {
  if (f.signals.length === 0 && f.clusters.length === 0)
    return `No signals concerning ${d.productName} are recorded in the signal management system, and no batch or branch clusters of serious cases were identified in the reporting interval.`;
  const parts: string[] = [];
  if (f.signals.length)
    parts.push(`${n(f.signals.length, "signal is", "signals are")} recorded for ${d.productName}`);
  if (f.clusters.length)
    parts.push(
      `${n(f.clusters.length, "batch or branch cluster", "batch or branch clusters")} of serious cases ${f.clusters.length === 1 ? "was" : "were"} identified in the interval`,
    );
  return `${parts.join("; ")} (see Sections 15 and 16).`;
}

function lineTable(rows: LineListingRow[], caption: string): Block {
  return {
    kind: "table",
    caption,
    origin: "RECORDS",
    headers: [
      "Case ID",
      "Received",
      "Sex / age",
      "Reaction",
      "Onset",
      "Seriousness",
      "Criteria",
      "Outcome",
      "Batch",
      "Source",
    ],
    rows: rows.map((r) => [
      r.caseId,
      r.receivedDate,
      [r.sex?.toLowerCase(), r.age].filter(Boolean).join(" / ") || "—",
      r.coded ? r.reaction : `${r.reaction} (not yet coded)`,
      r.onsetDate ?? "—",
      r.seriousness.replace("_", "-").toLowerCase(),
      r.criteria.join("; ") || "—",
      r.outcome.replaceAll("_", " ").toLowerCase(),
      r.batch ?? "—",
      r.source,
    ]),
  };
}

/** SOCs alphabetically (ICH order is per SOC); unresolved, then uncoded, last. */
function socRank(r: { soc?: string | undefined; coded: boolean }): string {
  return r.soc ? `0${r.soc}` : r.coded ? "1" : "2";
}

function naOr(draft: PsurDraft, s: SectionDef, key: InputKey): Block[] {
  const reason = draft.sections[s.id]?.notApplicable?.reason;
  if (s.naAllowed && has(reason)) return [{ kind: "para", text: reason.trim(), origin: "NA" }];
  return input(draft, key);
}

export function sectionBlocks(draft: PsurDraft, id: DraftSectionId): Block[] {
  const f = draft.facts;
  const s = SECTIONS.find((x) => x.id === id)!;
  const reg = value(draft, "nafdacRegNo") ?? f?.registration?.registrationNumber;
  const mah = value(draft, "mahName");
  const from = longDate(intervalFrom(draft));
  const dlp = longDate(draft.dlp);

  switch (id) {
    case "COVER_LETTER":
      return [
        ...input(draft, "mahName", "From"),
        ...input(draft, "mahAddress", "Address"),
        {
          kind: "field",
          label: "To",
          value:
            "The Director, Pharmacovigilance Directorate, National Agency for Food and Drug Administration and Control (NAFDAC)",
          origin: "FIXED",
        },
        {
          kind: "field",
          label: "Subject",
          value: `Periodic Safety Update Report (PSUR/PBRER) for ${draft.productName}${reg ? ` — NAFDAC Reg. No. ${reg}` : ""} — reporting interval ${from} to ${dlp}`,
          origin: "RECORDS",
        },
        ...input(draft, "strengthsAndForms", "Strength(s) / dosage form(s)"),
        ...(reg ? [] : input(draft, "nafdacRegNo", "NAFDAC Reg. No.")),
        ...input(draft, "renewalNo", "Renewal / application no."),
        {
          kind: "para",
          text: `Please find enclosed the Periodic Safety Update Report for ${draft.productName} covering the reporting interval ${from} to ${dlp} (data lock point ${dlp}), prepared in accordance with the NAFDAC PSUR template and ICH E2C(R2).`,
          origin: "FIXED",
        },
        ...input(draft, "qppvName", "QPPV"),
        ...input(draft, "qppvPhone", "Telephone"),
        ...input(draft, "qppvEmail", "E-mail"),
        {
          kind: "field",
          label: "Signature and date",
          value: "______________________",
          origin: "FIXED",
        },
      ];

    case "TITLE_PAGE":
      return [
        { kind: "field", label: "Product", value: draft.productName, origin: "RECORDS" },
        ...input(draft, "activeSubstance", "Active substance"),
        ...input(draft, "strengthsAndForms", "Strength(s) / dosage form(s)"),
        reg
          ? {
              kind: "field",
              label: "NAFDAC Reg. No.",
              value: reg,
              origin: has(draft.inputs.nafdacRegNo) ? "AUTHOR" : "RECORDS",
            }
          : input(draft, "nafdacRegNo", "NAFDAC Reg. No.")[0]!,
        draft.ibd
          ? {
              kind: "field",
              label: "International birth date (IBD)",
              value: longDate(draft.ibd),
              origin: "RECORDS",
            }
          : {
              kind: "field",
              label: "International birth date (IBD)",
              value: "[TO BE COMPLETED — set the IBD on the PSUR calendar schedule.]",
              origin: "PLACEHOLDER",
            },
        ...input(draft, "firstNigerianRegistration", "Date of first NAFDAC registration"),
        {
          kind: "field",
          label: "Reporting interval",
          value: `${from} to ${dlp}`,
          origin: "RECORDS",
        },
        { kind: "field", label: "Data lock point", value: dlp, origin: "RECORDS" },
        ...input(draft, "mahName", "Marketing authorisation holder"),
        ...input(draft, "mahAddress", "Holder address"),
        ...input(draft, "qppvName", "Nigerian QPPV"),
        ...input(draft, "qppvPhone", "QPPV telephone"),
        ...input(draft, "qppvEmail", "QPPV e-mail"),
        ...input(draft, "deputyQppvName", "Deputy QPPV"),
        ...input(draft, "deputyQppvPhone", "Deputy QPPV telephone"),
        ...input(draft, "deputyQppvEmail", "Deputy QPPV e-mail"),
        {
          kind: "para",
          text: `Confidential. This report contains confidential information of ${mah ?? "the marketing authorisation holder"} and is submitted to NAFDAC for regulatory purposes only.`,
          origin: "FIXED",
        },
        {
          kind: "field",
          label: "QPPV signature and date",
          value: "______________________",
          origin: "FIXED",
        },
      ];

    case "EXEC_SUMMARY":
      return [
        { kind: "subheading", text: "Introduction", origin: "FIXED" },
        {
          kind: "para",
          text: `This report covers ${draft.productName} for the ${draft.intervalMonths}-month interval ${from} to ${dlp}.`,
          origin: "RECORDS",
        },
        { kind: "subheading", text: "Marketing authorisation status", origin: "FIXED" },
        ...input(draft, "worldwideStatus"),
        { kind: "subheading", text: "Estimated exposure", origin: "FIXED" },
        ...input(draft, "exposureNigeriaInterval", "Nigeria, reporting interval"),
        ...input(draft, "exposureNigeriaCumulative", "Nigeria, cumulative"),
        { kind: "subheading", text: "Safety data received", origin: "FIXED" },
        ...(f
          ? [
              {
                kind: "para" as const,
                text: safetyDataSentence(draft, f),
                origin: "RECORDS" as const,
              },
            ]
          : noFacts()),
        { kind: "subheading", text: "Signals and risks", origin: "FIXED" },
        ...(f
          ? [{ kind: "para" as const, text: signalsSentence(draft, f), origin: "RECORDS" as const }]
          : noFacts()),
        {
          kind: "subheading",
          text: "Changes to the reference safety information",
          origin: "FIXED",
        },
        ...input(draft, "rsiChanges"),
        { kind: "subheading", text: "Conclusions", origin: "FIXED" },
        ...input(draft, "conclusionsActions"),
      ];

    case "S1":
      return [
        {
          kind: "para",
          text: `This Periodic Safety Update Report (PSUR) for ${draft.productName}${value(draft, "activeSubstance") ? ` (${value(draft, "activeSubstance")})` : ""} covers the ${draft.intervalMonths}-month reporting interval ${from} to ${dlp}. It presents the safety information received by the marketing authorisation holder during the interval and cumulatively, and evaluates the benefit-risk balance of the product in its approved indication(s).`,
          origin: "RECORDS",
        },
        ...input(draft, "indications", "Approved indication(s)"),
      ];

    case "S2":
      return input(draft, "worldwideStatus");
    case "S3":
      return input(draft, "safetyActions");
    case "S4":
      return [
        ...input(draft, "rsiTypeVersion", "Reference safety information"),
        ...input(draft, "rsiChanges"),
      ];

    case "S5":
      return [
        ...input(draft, "exposureNigeriaInterval", "Nigerian exposure, reporting interval"),
        ...input(draft, "exposureNigeriaCumulative", "Nigerian exposure, cumulative"),
        ...input(draft, "exposureGlobal", "Global exposure"),
        ...input(draft, "exposureMethod", "Method of estimation"),
      ];

    case "S6": {
      if (!f) return noFacts();
      const blocks: Block[] = [
        { kind: "para", text: safetyDataSentence(draft, f), origin: "RECORDS" },
        f.reactions.some((r) => r.soc)
          ? {
              kind: "table",
              caption: `Summary tabulation of adverse reactions for ${draft.productName} by MedDRA system organ class: reporting interval and cumulative to ${dlp}`,
              origin: "RECORDS",
              headers: [
                "System organ class",
                "Preferred term",
                "Interval (serious)",
                "Cumulative (serious)",
              ],
              rows: [...f.reactions]
                .sort((a, b) => socRank(a).localeCompare(socRank(b)))
                .map((r) => [
                  r.soc ?? (r.coded ? "SOC not resolved" : "Not yet coded"),
                  r.coded ? r.term : `${r.term} (as reported)`,
                  `${r.interval} (${r.intervalSerious})`,
                  `${r.cumulative} (${r.cumulativeSerious})`,
                ]),
              note: sourceNote(f),
            }
          : {
              kind: "table",
              caption: `Summary tabulation of adverse reactions for ${draft.productName}: reporting interval and cumulative to ${dlp}`,
              origin: "RECORDS",
              headers: [
                "Reaction (MedDRA term where coded)",
                "Interval (serious)",
                "Cumulative (serious)",
              ],
              rows: f.reactions.map((r) => [
                r.coded ? r.term : `${r.term} (not yet coded)`,
                `${r.interval} (${r.intervalSerious})`,
                `${r.cumulative} (${r.cumulativeSerious})`,
              ]),
              note: sourceNote(f),
            },
      ];
      if (f.uncodedInInterval > 0)
        blocks.push({
          kind: "para",
          text: `${n(f.uncodedInInterval, "case", "cases")} in the interval had not been coded to MedDRA at the time of extraction and ${f.uncodedInInterval === 1 ? "is" : "are"} tabulated by the reported term.`,
          origin: "RECORDS",
        });
      return [...blocks, ...input(draft, "tabulationComment", "Comment")];
    }

    case "S7":
      return naOr(draft, s, "clinicalTrials");
    case "S8":
      return naOr(draft, s, "nonInterventional");
    case "S9":
      return naOr(draft, s, "otherSources");
    case "S10":
      return naOr(draft, s, "nonClinical");
    case "S12":
      return naOr(draft, s, "otherPeriodicReports");
    case "S13":
      return naOr(draft, s, "lackOfEfficacy");

    case "S11": {
      const aid: Block[] =
        f && f.literature.length
          ? [
              {
                kind: "table",
                caption:
                  "Literature screening hits recorded for this product (for the author's assessment — not printed in the clean draft)",
                origin: "AID",
                headers: ["Publication", "Headline", "Date", "Risk"],
                rows: f.literature.map((l) => [
                  l.publication,
                  l.headline,
                  l.date,
                  l.risk.toLowerCase(),
                ]),
              },
            ]
          : [];
      return [
        ...input(draft, "literatureSummary"),
        {
          kind: "para",
          text: "The literature search strategy and references are given in Appendix IV.",
          origin: "FIXED",
        },
        ...aid,
      ];
    }

    case "S14": {
      if (!f) return noFacts();
      const late = f.lateBreaking;
      const head: Block =
        late.length === 0
          ? {
              kind: "para",
              text: `No ICSRs concerning ${draft.productName} were recorded between the data lock point (${dlp}) and ${longDate(f.takenAt)}.`,
              origin: "RECORDS",
            }
          : {
              kind: "para",
              text: `${n(late.length, "ICSR concerning", "ICSRs concerning")} ${draft.productName} ${late.length === 1 ? "was" : "were"} recorded between the data lock point (${dlp}) and ${longDate(f.takenAt)}, of which ${late.filter((r) => r.seriousness === "SERIOUS").length} serious.`,
              origin: "RECORDS",
            };
      return [
        head,
        ...(late.length ? [lineTable(late, "Cases received after the data lock point")] : []),
        ...input(draft, "lateBreakingComment", "Assessment"),
      ];
    }

    case "S15": {
      if (!f) return noFacts();
      const blocks: Block[] = [
        { kind: "para", text: signalsSentence(draft, f), origin: "RECORDS" },
      ];
      if (f.signals.length)
        blocks.push({
          kind: "table",
          caption: `Signals recorded for ${draft.productName}`,
          origin: "RECORDS",
          headers: [
            "Product (as recorded)",
            "Reaction",
            "Source",
            "Status",
            "Detection method",
            "Period",
            "Cases",
            "Decision rationale",
          ],
          rows: f.signals.map((x) => [
            x.product,
            x.reaction,
            x.origin,
            SIGNAL_STATE[x.status] ?? x.status,
            x.method,
            x.detectionPeriod,
            String(x.caseCount),
            x.rationale ?? "—",
          ]),
          note: sourceNote(f),
        });
      if (f.clusters.length)
        blocks.push({
          kind: "table",
          caption:
            "Batch and branch clusters of serious cases in the interval (two or more within 30 days)",
          origin: "RECORDS",
          headers: ["Type", "Batch / branch", "Cases", "From", "To"],
          rows: f.clusters.map((c) => [
            c.kind === "BATCH" ? "Batch" : "Branch",
            c.label,
            String(c.cases),
            c.from,
            c.to,
          ]),
        });
      return blocks;
    }

    case "S16":
      return [
        {
          kind: "subheading",
          text: "Signal evaluation and characterisation of risks",
          origin: "FIXED",
        },
        ...input(draft, "signalEvaluation"),
        { kind: "subheading", text: "Effectiveness of risk minimisation", origin: "FIXED" },
        ...(has(draft.inputs.riskMinimisation)
          ? input(draft, "riskMinimisation")
          : [
              {
                kind: "para" as const,
                text: placeholderText("riskMinimisation"),
                origin: "AID" as const,
              },
            ]),
      ];
    case "S17":
      return input(draft, "benefitEvaluation");
    case "S18":
      return input(draft, "integratedBenefitRisk");
    case "S19":
      return input(draft, "conclusionsActions");
    case "S20":
      return input(draft, "previousQueries");

    case "S21": {
      const s7na = draft.sections.S7?.notApplicable?.reason;
      return [
        { kind: "subheading", text: "Appendix I — Reference Safety Information", origin: "FIXED" },
        ...(has(draft.inputs.rsiTypeVersion)
          ? [
              {
                kind: "para" as const,
                text: `${draft.inputs.rsiTypeVersion!.trim()} — attached.`,
                origin: "AUTHOR" as const,
              },
            ]
          : input(draft, "rsiTypeVersion")),
        ...input(draft, "rmpVersion", "Risk management plan"),
        {
          kind: "subheading",
          text: "Appendix II — Cumulative Summary Tabulation from Clinical Trials",
          origin: "FIXED",
        },
        has(s7na)
          ? { kind: "para", text: "Not applicable (see Section 7).", origin: "NA" }
          : {
              kind: "para",
              text: "[TO BE ATTACHED BY AUTHOR — cumulative tabulation of serious adverse events from clinical trials.]",
              origin: "PLACEHOLDER",
            },
        {
          kind: "subheading",
          text: "Appendix III — Line Listing of ICSRs in the Reporting Interval",
          origin: "FIXED",
        },
        ...(f
          ? f.lineListing.length
            ? [
                lineTable(
                  f.lineListing,
                  `ICSRs concerning ${draft.productName} recorded ${from} to ${dlp}`,
                ),
              ]
            : [
                {
                  kind: "para" as const,
                  text: `Nil statement: no ICSRs concerning ${draft.productName} were recorded during the reporting interval ${from} to ${dlp}.`,
                  origin: "RECORDS" as const,
                },
              ]
          : noFacts()),
        {
          kind: "subheading",
          text: "Appendix IV — Literature Search Strategy and References",
          origin: "FIXED",
        },
        ...input(draft, "literatureStrategy"),
        {
          kind: "subheading",
          text: "Appendix V — Tabulated Summary of Signals",
          origin: "FIXED",
        },
        f
          ? {
              kind: "para",
              text: f.signals.length
                ? `The ${n(f.signals.length, "signal", "signals")} recorded for ${draft.productName} ${f.signals.length === 1 ? "is" : "are"} tabulated in Section 15.`
                : `No signals were recorded for ${draft.productName} up to ${longDate(f.takenAt)}.`,
              origin: "RECORDS",
            }
          : noFacts()[0]!,
        {
          kind: "subheading",
          text: "Appendix VI — Sources of Safety Information",
          origin: "FIXED",
        },
        ...(f
          ? [
              {
                kind: "para" as const,
                text: [
                  f.byChannel.length
                    ? `Individual case safety reports in the interval, by source: ${f.byChannel.map((c) => `${c.name} (${c.count})`).join("; ")}.`
                    : "No individual case safety reports were received in the interval.",
                  "Literature screening and signal detection on the holder's safety database.",
                ].join(" "),
                origin: "RECORDS" as const,
              },
            ]
          : noFacts()),
      ];
    }
  }
}

/** Whether a block prints in the given version of the draft. */
export function printsIn(block: Block, version: "working" | "clean"): boolean {
  return version === "working" || block.origin !== "AID";
}

export const ABBREVIATIONS: [string, string][] = [
  ["ADR", "Adverse drug reaction"],
  ["DLP", "Data lock point"],
  ["IBD", "International birth date"],
  ["ICH", "International Council for Harmonisation"],
  ["ICSR", "Individual case safety report"],
  ["MAH", "Marketing authorisation holder"],
  ["MedDRA", "Medical Dictionary for Regulatory Activities"],
  ["NAFDAC", "National Agency for Food and Drug Administration and Control"],
  ["PBRER", "Periodic benefit-risk evaluation report"],
  ["PSUR", "Periodic safety update report"],
  ["PT", "Preferred term"],
  ["QPPV", "Qualified person for pharmacovigilance"],
  ["RMP", "Risk management plan"],
  ["RSI", "Reference safety information"],
  ["SmPC", "Summary of product characteristics"],
];
