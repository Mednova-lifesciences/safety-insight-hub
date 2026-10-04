import type {
  EvidenceEntry,
  PsurDocument,
  PsurFinding,
  PsurScreeningCheckId,
  PsurScreeningCheckStatus,
  PsurSectionStatus,
  PsurSpecialPopulationArea,
  PsurUncertaintyCategory,
  PsurV4SectionId,
} from "@/types/pv";
import { renderableEvidence } from "./evidence";
import {
  OVERALL_OUTCOME_LABEL,
  RISK_MINIMISATION_ACTION_LABEL,
  UNCERTAINTY_CATEGORY_LABEL,
  EVIDENCE_QUALITY_LABEL,
} from "./labels";
import { longDate, NOT_ASSESSED, NOT_STATED } from "./assessment-memo";
import { submissionDetailsOf } from "./memo-draft";
import { assessTimeliness, normalizeChecks } from "./screening-checklist";
import { buildAuthoritativeSectionCoverage } from "./section-consistency";
import { fieldForEvidence, type V4FieldId } from "./v4-fields";

/**
 * The NAFDAC PSUR/PBRER Evaluation Form (V4), filled in from the review.
 *
 * The report follows the template's own structure — its headings, fields,
 * tables and tick boxes, in its order — so a reader sees the familiar form.
 * Research is written into the field it answers, with a numbered citation,
 * and every source is listed under Section 13 "References".
 *
 * Nothing is invented to fill a gap. A field nobody answered says so:
 * "Not stated in the submission" where the field is read off the PSUR,
 * "Not assessed" where it is NAFDAC's own assessment.
 */

export type V4Block =
  | { kind: "subheading"; text: string }
  | { kind: "instruction"; text: string }
  | { kind: "field"; label: string; value: string }
  | {
      kind: "table";
      header: string[];
      rows: string[][];
      firstColumnBold?: boolean;
      /** Column widths in percent; equal when omitted. */
      widths?: number[];
      /** "rows": ruled by rows only, as the template's exposure and ADR
       *  tables are. Full grid otherwise. */
      style?: "grid" | "rows";
    }
  | { kind: "ticks"; options: { label: string; checked: boolean }[] }
  | { kind: "list"; title: string; items: string[] };

export interface V4Section {
  number: number | null;
  title: string;
  blocks: V4Block[];
}

export interface V4ReportModel {
  title: string;
  agency: string;
  subtitle: string;
  product: string;
  generatedLabel: string;
  sections: V4Section[];
  /** Numbered in order of first citation. Printed under Section 13. */
  references: string[];
}

const STATUS_LABEL: Record<PsurSectionStatus, string> = {
  ADEQUATELY_ADDRESSED: "Adequately addressed",
  PRESENT_BUT_INCOMPLETE: "Present but incomplete",
  MISSING: "Missing",
  NOT_APPLICABLE: "Not applicable",
  ASSESSOR_PENDING: "Not yet assessed",
};

const CHECK_LABEL: Record<PsurScreeningCheckStatus, string> = {
  YES: "Yes",
  NO: "No",
  NOT_APPLICABLE: "N/A",
  NOT_ASSESSABLE: "Cannot tell from the document",
};

const POPULATION_ROWS: { area: PsurSpecialPopulationArea; label: string }[] = [
  { area: "PREGNANCY_LACTATION", label: "Pregnancy & lactation" },
  { area: "PAEDIATRIC", label: "Paediatric population" },
  { area: "GERIATRIC", label: "Geriatric population" },
  { area: "HEPATIC_IMPAIRMENT", label: "Hepatic impairment" },
  { area: "RENAL_IMPAIRMENT", label: "Renal impairment" },
  {
    area: "OVERDOSE_MISUSE_ABUSE_MEDICATION_ERROR",
    label: "Overdose / misuse / abuse potential/medication error",
  },
  { area: "OFF_LABEL_USE", label: "Off-label use" },
  { area: "OTHER_MISSING_INFORMATION", label: "Other missing information" },
];

const UNCERTAINTY_ROWS: PsurUncertaintyCategory[] = [
  "DATA_LIMITATIONS_UNDERREPORTING",
  "LIMITED_NIGERIAN_EXPOSURE",
  "MISSING_SUBPOPULATION_DATA",
  "SHORT_FOLLOWUP_DURATION",
  "STUDY_DESIGN_LIMITATIONS",
  "LIMITED_GENERALISABILITY",
];

export const SECTION_IDS: Record<number, PsurV4SectionId> = {
  1: "S1_PRODUCT_REGULATORY",
  2: "S2_WORLDWIDE_STATUS",
  3: "S3_THERAPEUTIC_CONTEXT",
  4: "S4_RSI",
  5: "S5_EXPOSURE_ACTIONS",
  6: "S6_LITERATURE",
  7: "S7_AGGREGATE_SAFETY_DATA",
  8: "S8_SIGNAL_EVALUATION",
  9: "S9_SPECIAL_POPULATIONS",
  10: "S10_BENEFIT_RISK",
  11: "S11_UNCERTAINTIES",
  12: "S12_REGULATORY_DECISION",
  13: "S13_CONCLUSION_SIGNOFF",
};

/** Printed under any assessment the evaluator has not reviewed. */
export const AI_DRAFT_NOTE =
  "Drafted by AI from the submission and not yet reviewed by the assessor.";

/** Joins sentences without doubling a full stop already at the end. */
function sentences(...parts: (string | undefined | null)[]): string {
  return parts
    .map((p) => (p ?? "").trim().replace(/\.+$/, ""))
    .filter(Boolean)
    .map((p) => `${p}.`)
    .join(" ");
}

function orNotStated(v: string | undefined | null): string {
  return v && v.trim() ? v.trim() : NOT_STATED;
}

function dateOnly(iso: string | undefined): string {
  return iso ? longDate(iso.slice(0, 10)) : "";
}

/**
 * Research grouped by the V4 field it answers. Only accepted, cited,
 * current entries — the same gate the memo uses (renderableEvidence) —
 * plus research that resolved a finding but was kept out of the memo,
 * which has no evidence entry yet still belongs in the field chosen.
 */
export function researchByField(
  doc: PsurDocument,
  findings: PsurFinding[],
): Map<V4FieldId, EvidenceEntry[]> {
  const byField = new Map<V4FieldId, EvidenceEntry[]>();
  for (const section of doc.assessmentSections ?? []) {
    for (const e of renderableEvidence(section.evidence)) {
      if (!e.content.trim()) continue;
      const field = fieldForEvidence(e);
      byField.set(field, [...(byField.get(field) ?? []), e]);
    }
  }
  for (const f of findings) {
    const r = f.researchResolution;
    if (f.humanAssessment !== "ACCEPTED" || !f.resolved || !r || r.evidenceId || !r.v4Field)
      continue;
    const pseudo = { content: r.content, citation: r.citation } as EvidenceEntry;
    byField.set(r.v4Field, [...(byField.get(r.v4Field) ?? []), pseudo]);
  }
  return byField;
}

/** The AI's (or rule's) assessment of a section, as the report words it. */
export function aiSectionAssessment(
  doc: PsurDocument,
  section: PsurV4SectionId,
): string | undefined {
  const c = buildAuthoritativeSectionCoverage(doc).find((x) => x.section === section);
  if (!c) return undefined;
  const why = c.status === "NOT_APPLICABLE" ? c.notApplicableJustification : undefined;
  return sentences(STATUS_LABEL[c.status], c.comment, why);
}

/**
 * The V4 form's Sections 2 and 7 tick boxes: the evaluator's own tick when
 * they set one, otherwise what the research implies.
 */
export function v4Ticks(
  doc: PsurDocument,
  findings: PsurFinding[],
): { s2Inconsistent: boolean; s7AdrTabulation: boolean; s7VigiflowChecked: boolean } {
  const byField = researchByField(doc, findings);
  const a = doc.v4SectionAnswers;
  return {
    s2Inconsistent: a?.s2Inconsistent ?? (byField.get("S2_INCONSISTENT")?.length ?? 0) > 0,
    s7AdrTabulation: a?.s7AdrTabulation ?? false,
    s7VigiflowChecked: a?.s7VigiflowChecked ?? (byField.get("S7_VIGIFLOW")?.length ?? 0) > 0,
  };
}

export function buildV4ReportModel(
  doc: PsurDocument,
  findings: PsurFinding[],
  now: Date = new Date(),
): V4ReportModel {
  const details = submissionDetailsOf(doc);
  const references: string[] = [];
  const cite = (citation: string): number => {
    const c = citation.trim();
    const at = references.indexOf(c);
    if (at >= 0) return at + 1;
    references.push(c);
    return references.length;
  };

  const byField = researchByField(doc, findings);
  const research = (field: V4FieldId): string[] =>
    (byField.get(field) ?? []).map((e) => `${e.content.trim()} [${cite(e.citation)}]`);
  /** A field's answer: what is already known, then the research on it. */
  const answer = (field: V4FieldId, known: string[] = [], empty = NOT_ASSESSED): string => {
    const parts = [...known.map((k) => k.trim()).filter(Boolean), ...research(field)];
    return parts.length > 0 ? parts.join("\n") : empty;
  };
  /** A FURTHER field prints only when something was filed there. */
  const further = (field: V4FieldId): V4Block[] => {
    const r = research(field);
    return r.length > 0
      ? [{ kind: "field", label: "Further assessment", value: r.join("\n") }]
      : [];
  };

  const coverage = new Map(buildAuthoritativeSectionCoverage(doc).map((c) => [c.section, c]));
  const accepted = findings.filter((f) => f.humanAssessment === "ACCEPTED");
  /** The reviewer's assessment of a section and the deficiencies found in
   *  it — the "reasoned assessment" the template's instructions ask for. */
  const answers = doc.v4SectionAnswers;
  const ticks = v4Ticks(doc, findings);
  const reviewerAssessment = (n: number): V4Block[] => {
    const id = SECTION_IDS[n]!;
    const c = coverage.get(id);
    const reviewed = answers?.assessments?.[id];
    const out: V4Block[] = [];
    if (reviewed?.text.trim()) {
      out.push({
        kind: "field",
        label: "Reviewer's assessment of this section",
        value: reviewed.text.trim(),
      });
    } else if (c) {
      // Never let the AI's reading pass as the evaluator's own judgement.
      out.push({
        kind: "field",
        label: "Reviewer's assessment of this section",
        value: aiSectionAssessment(doc, id) ?? "",
      });
      if (c.source !== "assessor") out.push({ kind: "instruction", text: AI_DRAFT_NOTE });
    }
    const here = accepted.filter((f) => f.v4Section === id);
    if (here.length > 0) {
      out.push({
        kind: "list",
        title: "Deficiencies identified",
        items: here.map((f) => {
          const base = `${f.severity.charAt(0)}${f.severity.slice(1).toLowerCase()} — ${f.description.trim()}`;
          if (!f.resolved) return `${base} Outstanding.`;
          const r = f.researchResolution;
          if (r && (r.evidenceId || r.v4Field))
            return `${base} Resolved by NAFDAC during this assessment (see above).`;
          if (r)
            return `${base} Resolved by NAFDAC during this assessment: ${r.content} [${cite(r.citation)}]`;
          return `${base} Resolved during this assessment.`;
        }),
      });
    }
    return out;
  };

  const sections: V4Section[] = [];

  // ---- Administrative Completeness Check ----
  const checks = new Map(
    normalizeChecks(doc.administrativeScreening?.checks ?? []).map((c) => [c.id, c]),
  );
  const adminRow = (label: string, id: PsurScreeningCheckId): string[] => {
    if (id === "RECEIVED_WITHIN_TIMEFRAME") {
      const t = assessTimeliness(details);
      return [label, CHECK_LABEL[t.status], t.note ?? ""];
    }
    const c = checks.get(id);
    return [label, c ? CHECK_LABEL[c.status] : "", c?.deficiency?.trim() ?? ""];
  };
  sections.push({
    number: null,
    title: "Administrative Completeness Check",
    blocks: [
      {
        kind: "instruction",
        text: "Complete before starting the scientific review. A deficient submission should be returned to the MAH before detailed assessment begins.",
      },
      {
        kind: "table",
        header: ["Check", "Yes / No / N/A", "Comment"],
        widths: [40, 15, 45],
        rows: [
          adminRow(
            "Does the submission follow the NAFDAC/ICH E2C(R2) recommended template",
            "PDF_OPENS_AND_FOLLOWS_TEMPLATE",
          ),
          adminRow(
            "Is the reporting interval / Data Lock Point (DLP) correctly stated/calculated",
            "DLP_AND_INTERVAL_CONSISTENT",
          ),
          adminRow(
            "Are all mandatory ICH E2C(R2) sections present, or is their absence explicitly justified?",
            "SECTIONS_PRESENT_OR_JUSTIFIED",
          ),
          adminRow(
            "Was the submission received within the required regulatory timeframe?",
            "RECEIVED_WITHIN_TIMEFRAME",
          ),
        ],
      },
    ],
  });

  // ---- 1 ----
  const reviewDate = doc.signOff?.evaluatorSignedAt
    ? dateOnly(doc.signOff.evaluatorSignedAt)
    : `${longDate(now.toISOString().slice(0, 10))} (review in progress)`;
  sections.push({
    number: 1,
    title: "Product & Regulatory Information",
    blocks: [
      {
        kind: "table",
        header: [],
        firstColumnBold: true,
        widths: [42, 58],
        rows: [
          ["Date of Review", reviewDate],
          ["Name of Product / Strength / Dosage Form", orNotStated(details.productName)],
          ["Marketing Authorisation Holder (MAH)", orNotStated(details.mah)],
          ["NAFDAC Registration Number", orNotStated(details.nafdacRegNo)],
          ["Reporting Period", orNotStated(details.intervalCovered)],
          ["International Birth Date (IBD)", orNotStated(details.ibd)],
          ["Nigerian Birth Date (NBD)", orNotStated(details.firstNafdacRegistrationDate)],
          ["Therapeutic Indication(s)", orNotStated(doc.memoDraft?.therapeuticCategory)],
        ],
      },
      ...further("S1_FURTHER"),
      ...reviewerAssessment(1),
    ],
  });

  // ---- 2 ----
  sections.push({
    number: 2,
    title: "Worldwide Regulatory & Marketing Status",
    blocks: [
      {
        kind: "field",
        label:
          "Summarise regulatory actions taken by any authority or the MAH for safety reasons this interval, worldwide (approvals, refusals, suspensions, withdrawals, variations)",
        value: answer("S2_ACTIONS"),
      },
      {
        kind: "ticks",
        options: [
          {
            label:
              "Any action inconsistent with, or not yet reflected in, NAFDAC's current position on this product?",
            checked: ticks.s2Inconsistent,
          },
        ],
      },
      {
        kind: "field",
        label: "If yes, explain",
        // Blank when nothing is inconsistent, as the template leaves it.
        value: answer(
          "S2_INCONSISTENT",
          [answers?.s2Explanation ?? ""],
          ticks.s2Inconsistent ? NOT_ASSESSED : "",
        ),
      },
      ...further("S2_FURTHER"),
      ...reviewerAssessment(2),
    ],
  });

  // ---- 3 ----
  sections.push({
    number: 3,
    title: "Therapeutic Context",
    blocks: [
      {
        kind: "field",
        label: "Incidence and prevalence of disease",
        value: answer("S3_INCIDENCE"),
      },
      {
        kind: "field",
        label: "Disease duration (acute / chronic / progressive)",
        value: answer("S3_DURATION"),
      },
      {
        kind: "field",
        label: "Mortality and severity of the disease",
        value: answer("S3_MORTALITY"),
      },
      { kind: "table", header: ["Disease", "Mortality", "Severity"], rows: [["", "", ""]] },
      { kind: "field", label: "Current treatment options", value: answer("S3_TREATMENTS") },
      {
        kind: "field",
        label: "Quality-of-life impact of the disease/condition given current treatment options",
        value: answer("S3_QOL"),
      },
      ...further("S3_FURTHER"),
      ...reviewerAssessment(3),
    ],
  });

  // ---- 4 ----
  const rsiAnswer = doc.memoDraft?.answers?.RSI_CHANGES;
  sections.push({
    number: 4,
    title: "Reference Safety Information (RSI)",
    blocks: [
      {
        kind: "field",
        label: "RSI type (SmPC / CDS / CCDS) and version number",
        value: answer("S4_TYPE_VERSION"),
      },
      {
        kind: "field",
        label: "Changes made to the RSI during this reporting interval",
        value: answer("S4_CHANGES", rsiAnswer ? [rsiAnswer + "."] : []),
      },
      { kind: "field", label: "Rationale for the changes (if any)", value: answer("S4_RATIONALE") },
      ...further("S4_FURTHER"),
      ...reviewerAssessment(4),
    ],
  });

  // ---- 5 ----
  const nc = doc.nigerianContext;
  sections.push({
    number: 5,
    title: "Exposure & Actions Taken for Safety Reasons",
    blocks: [
      {
        kind: "table",
        header: ["", "Reporting Interval", "Cumulative"],
        style: "rows",
        firstColumnBold: true,
        widths: [30, 35, 35],
        rows: [
          ["Global exposure", "", ""],
          ["Nigerian exposure", nc?.nigerianExposureEvidence?.trim() ?? "", ""],
          ["Another relevant region (if applicable)", "", ""],
        ],
      },
      {
        kind: "field",
        label:
          "Provide patient years, number of patients, prescriptions, units sold, and defined daily doses, if available",
        value: answer("S5_EXPOSURE"),
      },
      {
        kind: "field",
        label: "Actions taken for safety reasons during the reporting interval",
        value: answer("S5_ACTIONS"),
      },
      ...further("S5_FURTHER"),
      ...reviewerAssessment(5),
    ],
  });

  // ---- 6 ----
  sections.push({
    number: 6,
    title: "Literature",
    blocks: [
      {
        kind: "field",
        label:
          "Briefly highlight studies containing relevant safety information (company-sponsored and published studies)",
        value: answer(
          "S6_STUDIES",
          doc.memoDraft?.answers?.RELEVANT_STUDIES
            ? [doc.memoDraft.answers.RELEVANT_STUDIES + "."]
            : [],
        ),
      },
      ...further("S6_FURTHER"),
      ...reviewerAssessment(6),
    ],
  });

  // ---- 7 ----
  const vigiflow = research("S7_VIGIFLOW");
  sections.push({
    number: 7,
    title: "Aggregate Safety Data Summary",
    blocks: [
      {
        kind: "ticks",
        options: [
          {
            label:
              "Attach or reproduce the MAH's summary tabulation of ADRs and identify any SOCs requiring specific regulatory assessment (add more rows to table below as required)",
            checked: ticks.s7AdrTabulation,
          },
        ],
      },
      {
        kind: "table",
        header: [
          "SOC / Event",
          "Reporting interval",
          "Cumulative",
          "Nigerian cases",
          "Reviewer assessment",
        ],
        rows: [["", "", "", "", ""]],
        style: "rows",
      },
      {
        kind: "field",
        label: "Note any differences between Nigeria-specific and global data, if relevant",
        value: answer("S7_DIFFERENCES"),
      },
      {
        kind: "ticks",
        options: [
          {
            label:
              "Check VigiFlow for the Nigerian component of the product's safety data. Document the number of ICSRs received during the reporting interval and cumulatively, including the number of serious cases. Where relevant, compare the VigiFlow data with the Nigerian cases reported by the MAH and document any discrepancies.",
            checked: ticks.s7VigiflowChecked,
          },
        ],
      },
      {
        kind: "field",
        label: "VigiFlow findings",
        value: vigiflow.length > 0 ? vigiflow.join("\n") : NOT_ASSESSED,
      },
      ...further("S7_FURTHER"),
      ...reviewerAssessment(7),
    ],
  });

  // ---- 8 ----
  sections.push({
    number: 8,
    title: "Signal Evaluation Log",
    blocks: [
      {
        kind: "instruction",
        text: "List every signal that was new, ongoing, or closed during this reporting interval. This section should not be left blank; state 'No signals under evaluation this interval' if genuinely applicable.",
      },
      {
        kind: "table",
        header: [
          "Signal / Term",
          "Source",
          "Status (New/Ongoing/Closed)",
          "Method of Evaluation",
          "Outcome",
          "Date Closed",
          "Regulatory action",
        ],
        rows: [["", "", "", "", "", "", ""]],
      },
      {
        kind: "field",
        label: "Signals new, ongoing or closed during this reporting interval",
        value: answer("S8_SIGNALS"),
      },
      ...further("S8_FURTHER"),
      ...reviewerAssessment(8),
    ],
  });

  // ---- 9 ----
  const pops = new Map((doc.specialPopulations ?? []).map((p) => [p.area, p]));
  sections.push({
    number: 9,
    title: "Special Populations, Special Situations & Missing Information",
    blocks: [
      {
        kind: "table",
        header: ["Population / Category", "Data Adequacy", "Comments"],
        firstColumnBold: true,
        widths: [30, 20, 50],
        rows: POPULATION_ROWS.map(({ area, label }) => {
          const p = pops.get(area);
          return [
            label,
            p ? STATUS_LABEL[p.status] : "",
            p
              ? [p.comment?.trim(), p.notApplicableJustification?.trim()].filter(Boolean).join(" ")
              : "",
          ];
        }),
      },
      ...further("S9_FURTHER"),
    ],
  });

  // ---- 10 ----
  const br = doc.benefitRisk;
  const riskRows = (kind: "IDENTIFIED" | "POTENTIAL") =>
    (br?.keyRisks ?? [])
      .filter((r) => r.kind === kind)
      .map((r) => [
        r.risk,
        r.severity,
        [r.frequency, r.frequencyDataSource ? `(${r.frequencyDataSource})` : ""]
          .filter(Boolean)
          .join(" "),
        r.reversibility,
        r.duration,
        r.preventabilityRiskManagement,
        r.comment,
      ]);
  const blankRows = (n: number, w: number) => Array.from({ length: n }, () => Array(w).fill(""));
  const riskHeader = (what: string) => [
    what,
    "Severity",
    "Frequency",
    "Reversibility",
    "Duration",
    "Preventability/Risk Management",
    "Comment",
  ];
  const identified = riskRows("IDENTIFIED");
  const potential = riskRows("POTENTIAL");
  const benefits = (br?.keyBenefits ?? []).map((b) => [
    b.benefit,
    b.evidenceSource,
    b.magnitude,
    EVIDENCE_QUALITY_LABEL[b.evidenceQuality] ?? b.evidenceQuality,
  ]);
  const missing = (br?.missingInformation ?? []).map((m) => [
    m.missingInformation,
    m.riskMinimisationImplication,
  ]);
  const dims: { key: string; label: string }[] = [
    { key: "CONDITION_UNMET_NEED", label: "Analysis of Condition / Unmet Medical Need" },
    { key: "CURRENT_TREATMENT_OPTIONS", label: "Current Treatment Options" },
    { key: "BENEFIT", label: "Benefit" },
    { key: "RISK", label: "Risk" },
    { key: "RISK_MANAGEMENT", label: "Risk Management" },
  ];
  const effects = new Map(
    (br?.integratedEffectsTable ?? []).map((r) => [r.dimension as string, r]),
  );
  const rme = br?.riskMinimisationEffectiveness?.outcome;
  sections.push({
    number: 10,
    title: "Benefit-Risk Assessment",
    blocks: [
      ...(br?.assistGenerated
        ? [
            {
              kind: "instruction" as const,
              text: AI_DRAFT_NOTE,
            },
          ]
        : []),
      { kind: "subheading", text: "10.1 Key Benefits" },
      {
        kind: "table",
        header: [
          "Key Benefit",
          "Evidence Source",
          "Magnitude",
          "Evidence Quality (High/Moderate/Low/Very Low)",
        ],
        rows: benefits.length > 0 ? benefits : blankRows(3, 4),
      },
      { kind: "subheading", text: "10.2 Key Risks" },
      { kind: "instruction", text: "Important identified risks:" },
      {
        kind: "table",
        header: riskHeader("Important Identified Risk"),
        rows: identified.length > 0 ? identified : blankRows(3, 7),
      },
      { kind: "instruction", text: "Important potential risks:" },
      {
        kind: "table",
        header: riskHeader("Important Potential Risk"),
        rows: potential.length > 0 ? potential : blankRows(3, 7),
      },
      {
        kind: "instruction",
        text: "Frequency: state the available frequency estimate using an appropriate denominator or category, where applicable, and indicate the data source e.g RSI, SmPC, PSUR document, etc.",
      },
      ...(byField.has("S10_KEY_RISKS")
        ? [
            {
              kind: "field" as const,
              label: "Key risks — further evidence",
              value: research("S10_KEY_RISKS").join("\n"),
            },
          ]
        : []),
      { kind: "instruction", text: "Missing information:" },
      {
        kind: "table",
        header: ["Missing Information", "Risk-Minimisation Implication"],
        widths: [45, 55],
        rows: missing.length > 0 ? missing : blankRows(3, 2),
      },
      { kind: "subheading", text: "10.3 Integrated Benefit-Risk Effects Table" },
      {
        kind: "table",
        header: ["Dimension", "Evidence & Uncertainty", "Reviewer Conclusion"],
        firstColumnBold: true,
        widths: [24, 38, 38],
        rows: dims.map((d) => {
          const r = effects.get(d.key);
          return [d.label, r?.evidenceAndUncertainty ?? "", r?.reviewerConclusion ?? ""];
        }),
      },
      {
        kind: "subheading",
        text: "10.4 Patient / Healthcare-Professional Perspective (If available)",
      },
      {
        kind: "field",
        label:
          "Where available, summarise patient- or HCP-reported views on the acceptability of the risks relative to the benefits",
        value: br?.patientHcpPerspective?.available
          ? br.patientHcpPerspective.summary
          : "Not available",
      },
      {
        kind: "subheading",
        text: "10.5 Risk Minimisation Measures — Effectiveness This Interval (If applicable)",
      },
      {
        kind: "ticks",
        options: [
          { label: "Not applicable", checked: rme === "NOT_APPLICABLE" },
          { label: "Effective", checked: rme === "EFFECTIVE" },
          { label: "Partially effective", checked: rme === "PARTIALLY_EFFECTIVE" },
          { label: "Not effective", checked: rme === "NOT_EFFECTIVE" },
          { label: "Not assessable — insufficient data", checked: rme === "NOT_ASSESSABLE" },
        ],
      },
      { kind: "field", label: "Comment", value: br?.riskMinimisationEffectiveness?.comment ?? "" },
      ...further("S10_FURTHER"),
    ],
  });

  // ---- 11 ----
  const us = doc.uncertainties ?? [];
  const present = new Set(us.map((u) => u.category));
  const impactRank = { LOW: 1, MODERATE: 2, HIGH: 3 } as const;
  const worstImpact = us.reduce<"LOW" | "MODERATE" | "HIGH" | undefined>(
    (w, u) => (!w || impactRank[u.impactOnConclusion] > impactRank[w] ? u.impactOnConclusion : w),
    undefined,
  );
  const addressedRank = { YES: 1, PARTIALLY: 2, NO: 3 } as const;
  const worstAddressed = us.reduce<"YES" | "PARTIALLY" | "NO" | undefined>(
    (w, u) => (!w || addressedRank[u.addressedByMah] > addressedRank[w] ? u.addressedByMah : w),
    undefined,
  );
  const others = us.filter((u) => u.category === "OTHER");
  sections.push({
    number: 11,
    title: "Uncertainties Affecting the Benefit-Risk Assessment",
    blocks: [
      ...(doc.uncertaintiesNoneConfirmed
        ? [
            {
              kind: "instruction" as const,
              text: `The assessor confirmed that no uncertainties apply this interval (${doc.uncertaintiesNoneConfirmed.by}): ${doc.uncertaintiesNoneConfirmed.rationale}`,
            },
          ]
        : []),
      {
        kind: "ticks",
        options: [
          ...UNCERTAINTY_ROWS.map((c) => ({
            label: UNCERTAINTY_CATEGORY_LABEL[c],
            checked: present.has(c),
          })),
          {
            label: `Potential impact of the uncertainty on the benefit–risk conclusion: ${
              worstImpact
                ? worstImpact.charAt(0) + worstImpact.slice(1).toLowerCase()
                : "Low / Moderate / High"
            }`,
            checked: !!worstImpact,
          },
          {
            label: `Other (specify)${others.length > 0 ? `: ${others.map((o) => o.description).join("; ")}` : ""}`,
            checked: others.length > 0,
          },
        ],
      },
      { kind: "instruction", text: "Was the uncertainty satisfactorily addressed by the MAH?" },
      {
        kind: "ticks",
        options: [
          { label: "Yes", checked: worstAddressed === "YES" },
          { label: "Partially", checked: worstAddressed === "PARTIALLY" },
          { label: "No", checked: worstAddressed === "NO" },
        ],
      },
      {
        kind: "field",
        label: "Rationale (mandatory — tie your answer to the specific uncertainties ticked above)",
        value:
          us.length > 0
            ? us
                .map(
                  (u) =>
                    `${UNCERTAINTY_CATEGORY_LABEL[u.category]}: ${sentences(u.description, u.rationale)}`,
                )
                .join("\n")
            : NOT_ASSESSED,
      },
      {
        kind: "field",
        label: "Evaluator's comments (critically assess the MAH's benefit-risk profile)",
        value: answer("S11_COMMENTS", doc.evaluatorComments ? [doc.evaluatorComments] : []),
      },
      ...further("S11_FURTHER"),
    ],
  });

  // ---- 12 ----
  const rd = doc.regulatoryDecision;
  const actions = new Set(rd?.actions ?? []);
  sections.push({
    number: 12,
    title: "Regulatory Decision & Recommended Actions",
    blocks: [
      { kind: "instruction", text: "Risk Minimisation Considerations (tick all that apply)" },
      {
        kind: "ticks",
        options: (
          Object.keys(
            RISK_MINIMISATION_ACTION_LABEL,
          ) as (keyof typeof RISK_MINIMISATION_ACTION_LABEL)[]
        ).map((a) => ({ label: RISK_MINIMISATION_ACTION_LABEL[a], checked: actions.has(a) })),
      },
      { kind: "instruction", text: "Overall Benefit-Risk Outcome (tick one)" },
      {
        kind: "ticks",
        options: (Object.keys(OVERALL_OUTCOME_LABEL) as (keyof typeof OVERALL_OUTCOME_LABEL)[]).map(
          (o) => ({
            label: OVERALL_OUTCOME_LABEL[o],
            checked: rd?.overallOutcome === o,
          }),
        ),
      },
      {
        kind: "field",
        label: "Regulatory action recommended and basis for recommendation above",
        value: rd?.basis?.trim() || NOT_ASSESSED,
      },
      {
        kind: "field",
        label: "Specific safety/benefit–risk finding supporting the recommendation",
        value: rd?.supportingFinding?.trim() || NOT_ASSESSED,
      },
      { kind: "field", label: "Next PSUR/PBRER due date", value: dateOnly(rd?.nextPsurDueDate) },
      {
        kind: "field",
        label: "Follow-up information required/follow-up deadline",
        value: sentences(
          rd?.followUpRequired,
          rd?.mahResponseDeadline ? `Deadline: ${dateOnly(rd.mahResponseDeadline)}` : "",
        ),
      },
      ...further("S12_FURTHER"),
    ],
  });

  // ---- 13 ----
  // Every citation is numbered by now; Section 13 lists them.
  const extra = further("S13_FURTHER");
  const so = doc.signOff;
  const conf = so?.reviewerConfidence;
  sections.push({
    number: 13,
    title: "Conclusion, Sign-off & Document Control",
    blocks: [
      {
        kind: "field",
        label:
          "Conclusion (state the overall benefit-risk conclusion for the product, referencing the outcome selected in Section 12 and the key drivers identified in Section 10)",
        value: so?.conclusion?.trim() || NOT_ASSESSED,
      },
      { kind: "instruction", text: "Reviewer confidence in this conclusion:" },
      {
        kind: "ticks",
        options: [
          {
            label: "High : robust literature review, exposure and safety data",
            checked: conf === "HIGH",
          },
          { label: "Medium: some important uncertainties", checked: conf === "MEDIUM" },
          {
            label: "Low: substantial missing information/limited or no exposure",
            checked: conf === "LOW",
          },
        ],
      },
      ...extra,
      {
        kind: "list",
        title: "References",
        items: [
          ...references.map((r, i) => `[${i + 1}] ${r}`),
          ...(so?.references?.trim() ? so.references.trim().split("\n").filter(Boolean) : []),
        ],
      },
      {
        kind: "field",
        label: "Evaluator's name and signature",
        value: so?.evaluatorName?.trim() ?? "",
      },
      { kind: "field", label: "Date", value: dateOnly(so?.evaluatorSignedAt) },
      {
        kind: "field",
        label: "Peer reviewed by (name and signature)",
        value: so?.peerReviewerName?.trim() ?? "",
      },
      { kind: "field", label: "Date", value: dateOnly(so?.peerReviewedAt) },
    ],
  });

  return {
    title: "PSUR/PBRER EVALUATION FORM",
    agency: "National Agency for Food and Drug Administration and Control (NAFDAC)",
    subtitle:
      "Pharmacovigilance Directorate — Structured Benefit-Risk Assessment Template (V4, Draft)",
    product: orNotStated(details.productName),
    generatedLabel: longDate(now.toISOString().slice(0, 10)),
    sections,
    references,
  };
}
