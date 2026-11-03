/**
 * The PSUR a holder writes, in the NAFDAC PSUR Full Template structure:
 * cover letter, title page, executive summary, ICH E2C(R2) Sections 1–19,
 * Section 20 (response to previous NAFDAC queries) and Section 21
 * (appendices). The same structure the administrative screening checklist
 * (items 4 and 11) and the V4 evaluation form check for.
 *
 * Each section says where its content comes from:
 *   RECORDS  computed from the safety database only;
 *   MIXED    facts from the records plus what only the author knows;
 *   AUTHOR   only the author can supply it.
 * Nothing is ever filled by guessing: an empty author input prints as a
 * marked placeholder in the working draft and blocks the clean draft.
 */

export type DraftSectionId =
  | "COVER_LETTER"
  | "TITLE_PAGE"
  | "EXEC_SUMMARY"
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "S10"
  | "S11"
  | "S12"
  | "S13"
  | "S14"
  | "S15"
  | "S16"
  | "S17"
  | "S18"
  | "S19"
  | "S20"
  | "S21";

export type InputKey =
  | "mahName"
  | "mahAddress"
  | "activeSubstance"
  | "strengthsAndForms"
  | "nafdacRegNo"
  | "renewalNo"
  | "firstNigerianRegistration"
  | "indications"
  | "qppvName"
  | "qppvPhone"
  | "qppvEmail"
  | "deputyQppvName"
  | "deputyQppvPhone"
  | "deputyQppvEmail"
  | "worldwideStatus"
  | "safetyActions"
  | "rsiTypeVersion"
  | "rsiChanges"
  | "exposureNigeriaInterval"
  | "exposureNigeriaCumulative"
  | "exposureMethod"
  | "exposureGlobal"
  | "tabulationComment"
  | "clinicalTrials"
  | "nonInterventional"
  | "otherSources"
  | "nonClinical"
  | "literatureSummary"
  | "literatureStrategy"
  | "otherPeriodicReports"
  | "lackOfEfficacy"
  | "lateBreakingComment"
  | "signalEvaluation"
  | "riskMinimisation"
  | "benefitEvaluation"
  | "integratedBenefitRisk"
  | "conclusionsActions"
  | "previousQueries"
  | "rmpVersion";

export interface InputDef {
  key: InputKey;
  label: string;
  /** What belongs here, shown to the author and printed in the placeholder. */
  hint: string;
  multiline?: boolean;
  /** Needed for the clean draft (others may stay empty). */
  required: boolean;
}

export type SectionSource = "RECORDS" | "MIXED" | "AUTHOR";

export interface SectionDef {
  id: DraftSectionId;
  number?: string;
  title: string;
  source: SectionSource;
  /** What ICH E2C(R2) / NAFDAC expects in this section. */
  guidance: string;
  inputs: InputKey[];
  /** The author may mark it not applicable, with a reason. */
  naAllowed: boolean;
  /** A reason commonly given, offered as a starting point — never applied
   *  automatically. */
  naSuggestion?: string;
}

export const INPUTS: Record<InputKey, InputDef> = {
  mahName: {
    key: "mahName",
    label: "Marketing authorisation holder",
    hint: "Legal name of the holder as on the NAFDAC certificate.",
    required: true,
  },
  mahAddress: {
    key: "mahAddress",
    label: "Holder address",
    hint: "Registered address of the holder in Nigeria.",
    multiline: true,
    required: true,
  },
  activeSubstance: {
    key: "activeSubstance",
    label: "Active substance",
    hint: "INN of the active substance. One PSUR per active substance.",
    required: true,
  },
  strengthsAndForms: {
    key: "strengthsAndForms",
    label: "Strengths and dosage forms",
    hint: "Every registered strength and dosage form covered, exactly as on the NAFDAC certificate.",
    required: true,
  },
  nafdacRegNo: {
    key: "nafdacRegNo",
    label: "NAFDAC registration number(s)",
    hint: "As on the certificate(s).",
    required: true,
  },
  renewalNo: {
    key: "renewalNo",
    label: "Renewal / application number",
    hint: "If this PSUR supports a renewal or application.",
    required: false,
  },
  firstNigerianRegistration: {
    key: "firstNigerianRegistration",
    label: "Date of first NAFDAC registration",
    hint: "YYYY-MM-DD. The interval is calculated from the IBD, not this date.",
    required: true,
  },
  indications: {
    key: "indications",
    label: "Approved indication(s)",
    hint: "As in the Nigerian SmPC.",
    multiline: true,
    required: true,
  },
  qppvName: {
    key: "qppvName",
    label: "QPPV name",
    hint: "Nigerian QPPV, as on NAFDAC's record.",
    required: true,
  },
  qppvPhone: {
    key: "qppvPhone",
    label: "QPPV telephone",
    hint: "As on NAFDAC's record.",
    required: true,
  },
  qppvEmail: {
    key: "qppvEmail",
    label: "QPPV e-mail",
    hint: "As on NAFDAC's record.",
    required: true,
  },
  deputyQppvName: {
    key: "deputyQppvName",
    label: "Deputy QPPV name",
    hint: "As on NAFDAC's record.",
    required: true,
  },
  deputyQppvPhone: {
    key: "deputyQppvPhone",
    label: "Deputy QPPV telephone",
    hint: "As on NAFDAC's record.",
    required: true,
  },
  deputyQppvEmail: {
    key: "deputyQppvEmail",
    label: "Deputy QPPV e-mail",
    hint: "As on NAFDAC's record.",
    required: true,
  },
  worldwideStatus: {
    key: "worldwideStatus",
    label: "Worldwide marketing approval status",
    hint: "Countries where the product is approved or marketed, with dates; or state that it is marketed in Nigeria only.",
    multiline: true,
    required: true,
  },
  safetyActions: {
    key: "safetyActions",
    label: "Actions taken for safety reasons in the interval",
    hint: "Any action by the holder or any regulator for safety reasons (suspension, withdrawal, variation, restriction, recall), or state that there were none.",
    multiline: true,
    required: true,
  },
  rsiTypeVersion: {
    key: "rsiTypeVersion",
    label: "Reference safety information: type, version and date",
    hint: "e.g. SmPC version 3.0, 14 January 2026 — the version in force at the start of the interval.",
    required: true,
  },
  rsiChanges: {
    key: "rsiChanges",
    label: "Changes to the reference safety information",
    hint: "Safety-related changes made during the interval and why, or state that there were none.",
    multiline: true,
    required: true,
  },
  exposureNigeriaInterval: {
    key: "exposureNigeriaInterval",
    label: "Nigerian exposure in the interval",
    hint: "Units sold / dispensed in Nigeria in the interval and the patient estimate derived from them. NAFDAC requires the Nigerian figure; global does not substitute.",
    required: true,
  },
  exposureNigeriaCumulative: {
    key: "exposureNigeriaCumulative",
    label: "Nigerian exposure, cumulative",
    hint: "Since first marketing in Nigeria.",
    required: true,
  },
  exposureMethod: {
    key: "exposureMethod",
    label: "How exposure was estimated",
    hint: "e.g. units sold ÷ units per course; DDD assumption; data source (sales system).",
    multiline: true,
    required: true,
  },
  exposureGlobal: {
    key: "exposureGlobal",
    label: "Global exposure (if marketed elsewhere)",
    hint: "Leave empty if marketed in Nigeria only.",
    required: false,
  },
  tabulationComment: {
    key: "tabulationComment",
    label: "Comment on the tabulations",
    hint: "Anything notable in the interval and cumulative tabulations.",
    multiline: true,
    required: false,
  },
  clinicalTrials: {
    key: "clinicalTrials",
    label: "Clinical trial findings",
    hint: "Significant safety findings from holder-sponsored trials in the interval.",
    multiline: true,
    required: true,
  },
  nonInterventional: {
    key: "nonInterventional",
    label: "Non-interventional study findings",
    hint: "Safety findings from non-interventional studies (e.g. PASS, registries).",
    multiline: true,
    required: true,
  },
  otherSources: {
    key: "otherSources",
    label: "Information from other clinical trials and sources",
    hint: "e.g. investigator-sponsored studies, patient support programmes.",
    multiline: true,
    required: true,
  },
  nonClinical: {
    key: "nonClinical",
    label: "Non-clinical data",
    hint: "New safety findings from non-clinical studies.",
    multiline: true,
    required: true,
  },
  literatureSummary: {
    key: "literatureSummary",
    label: "Literature — summary and product-specific assessment",
    hint: "Summarise relevant publications in your own words and end with a paragraph assessing their relevance to this product (screening item 13).",
    multiline: true,
    required: true,
  },
  literatureStrategy: {
    key: "literatureStrategy",
    label: "Literature search strategy",
    hint: "Databases, search terms and dates (Appendix IV).",
    multiline: true,
    required: true,
  },
  otherPeriodicReports: {
    key: "otherPeriodicReports",
    label: "Other periodic reports",
    hint: "Other periodic reports issued in the interval (e.g. by a licensing partner).",
    multiline: true,
    required: true,
  },
  lackOfEfficacy: {
    key: "lackOfEfficacy",
    label: "Lack of efficacy in controlled trials",
    hint: "Data from controlled trials indicating lack of efficacy.",
    multiline: true,
    required: true,
  },
  lateBreakingComment: {
    key: "lateBreakingComment",
    label: "Assessment of late-breaking information",
    hint: "Your assessment of anything received after the DLP that changes the picture.",
    multiline: true,
    required: false,
  },
  signalEvaluation: {
    key: "signalEvaluation",
    label: "Signal and risk evaluation",
    hint: "Your evaluation of each signal closed in the interval and of new information on known risks; characterise important risks.",
    multiline: true,
    required: true,
  },
  riskMinimisation: {
    key: "riskMinimisation",
    label: "Effectiveness of risk minimisation",
    hint: "If risk-minimisation measures exist, how effective they were; otherwise say none are in place.",
    multiline: true,
    required: false,
  },
  benefitEvaluation: {
    key: "benefitEvaluation",
    label: "Benefit evaluation",
    hint: "Baseline efficacy/effectiveness for the approved indications and any new information in the interval.",
    multiline: true,
    required: true,
  },
  integratedBenefitRisk: {
    key: "integratedBenefitRisk",
    label: "Integrated benefit-risk analysis",
    hint: "Weigh the benefits against the risks for the approved indications, drawing on the whole report (screening item 14).",
    multiline: true,
    required: true,
  },
  conclusionsActions: {
    key: "conclusionsActions",
    label: "Conclusions and actions",
    hint: "Overall benefit-risk conclusion, new risks, and any actions proposed (e.g. SmPC update).",
    multiline: true,
    required: true,
  },
  previousQueries: {
    key: "previousQueries",
    label: "Response to previous NAFDAC queries and commitments",
    hint: "Each query or commitment from the last NAFDAC assessment and how it is addressed; or state this is the first submission.",
    multiline: true,
    required: true,
  },
  rmpVersion: {
    key: "rmpVersion",
    label: "RMP version",
    hint: "If the product has a risk management plan, its version and date.",
    required: false,
  },
};

export const SECTIONS: SectionDef[] = [
  {
    id: "COVER_LETTER",
    title: "Cover letter",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "On the holder's letterhead, signed by the QPPV: product name, strength(s)/dosage form(s), NAFDAC Reg. No., renewal/application no. and the reporting interval (screening item 1).",
    inputs: ["mahName", "mahAddress", "renewalNo"],
  },
  {
    id: "TITLE_PAGE",
    title: "Title page",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "Product, active substance, strengths, NAFDAC Reg. No., IBD and first NAFDAC registration date, DLP and interval, holder name and address, QPPV and deputy contacts, confidentiality statement, signed and dated by the Nigerian QPPV (screening items 2, 5, 9).",
    inputs: [
      "activeSubstance",
      "strengthsAndForms",
      "nafdacRegNo",
      "firstNigerianRegistration",
      "qppvName",
      "qppvPhone",
      "qppvEmail",
      "deputyQppvName",
      "deputyQppvPhone",
      "deputyQppvEmail",
    ],
  },
  {
    id: "EXEC_SUMMARY",
    title: "Executive summary",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "Introduction, marketing authorisation status, estimated exposure, safety data received, signals and risks, RSI changes and conclusions (screening item 10). Built from the sections below.",
    inputs: [],
  },
  {
    id: "S1",
    number: "1",
    title: "Introduction",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "Report number and interval, the product and its indications, and the scope of the report.",
    inputs: ["indications"],
  },
  {
    id: "S2",
    number: "2",
    title: "Worldwide Marketing Approval Status",
    source: "AUTHOR",
    naAllowed: false,
    guidance:
      "Brief overview: date of first approval, indications, and countries where the product is approved or marketed.",
    inputs: ["worldwideStatus"],
  },
  {
    id: "S3",
    number: "3",
    title: "Actions Taken in the Reporting Interval for Safety Reasons",
    source: "AUTHOR",
    naAllowed: false,
    guidance:
      "Significant actions related to safety taken by the holder or any regulator during the interval.",
    inputs: ["safetyActions"],
  },
  {
    id: "S4",
    number: "4",
    title: "Changes to Reference Safety Information",
    source: "AUTHOR",
    naAllowed: false,
    guidance:
      "The RSI in force at the start of the interval and significant changes made during it.",
    inputs: ["rsiTypeVersion", "rsiChanges"],
  },
  {
    id: "S5",
    number: "5",
    title: "Estimated Exposure and Use Patterns",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "Interval and cumulative patient exposure from marketing experience, with the method of estimation. NAFDAC requires Nigerian exposure; global figures do not substitute.",
    inputs: [
      "exposureNigeriaInterval",
      "exposureNigeriaCumulative",
      "exposureMethod",
      "exposureGlobal",
    ],
  },
  {
    id: "S6",
    number: "6",
    title: "Data in Summary Tabulations",
    source: "RECORDS",
    naAllowed: false,
    guidance:
      "Interval and cumulative summary tabulations of adverse reactions from post-marketing sources, by MedDRA SOC where coded, with Nigerian case counts.",
    inputs: ["tabulationComment"],
  },
  {
    id: "S7",
    number: "7",
    title: "Summaries of Significant Findings from Clinical Trials During the Reporting Interval",
    source: "AUTHOR",
    naAllowed: true,
    naSuggestion:
      "The holder sponsored no clinical trials with this product during the reporting interval.",
    guidance:
      "Completed and ongoing trials, long-term follow-up, other therapeutic use, fixed combinations.",
    inputs: ["clinicalTrials"],
  },
  {
    id: "S8",
    number: "8",
    title: "Findings from Non-Interventional Studies",
    source: "AUTHOR",
    naAllowed: true,
    naSuggestion:
      "No non-interventional studies with this product were conducted or sponsored by the holder during the reporting interval.",
    guidance: "Safety findings from non-interventional studies.",
    inputs: ["nonInterventional"],
  },
  {
    id: "S9",
    number: "9",
    title: "Information from Other Clinical Trials and Sources",
    source: "AUTHOR",
    naAllowed: true,
    naSuggestion:
      "No other clinical trials or sources with relevant safety information were identified during the reporting interval.",
    guidance: "Other trials and sources, e.g. patient support programmes.",
    inputs: ["otherSources"],
  },
  {
    id: "S10",
    number: "10",
    title: "Non-Clinical Data",
    source: "AUTHOR",
    naAllowed: true,
    naSuggestion: "No new non-clinical safety data were generated during the reporting interval.",
    guidance: "Major safety findings from non-clinical studies.",
    inputs: ["nonClinical"],
  },
  {
    id: "S11",
    number: "11",
    title: "Literature",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "New and significant safety findings from the literature, in the holder's own words, with a product-specific assessment (screening item 13). Literature screening hits for this product are listed for the author.",
    inputs: ["literatureSummary", "literatureStrategy"],
  },
  {
    id: "S12",
    number: "12",
    title: "Other Periodic Reports",
    source: "AUTHOR",
    naAllowed: true,
    naSuggestion:
      "No other periodic reports for this product were prepared during the reporting interval.",
    guidance: "Other periodic reports issued in the interval.",
    inputs: ["otherPeriodicReports"],
  },
  {
    id: "S13",
    number: "13",
    title: "Lack of Efficacy in Controlled Clinical Trials",
    source: "AUTHOR",
    naAllowed: true,
    naSuggestion:
      "No controlled clinical trials of this product were conducted during the reporting interval.",
    guidance: "Data from controlled trials indicating lack of efficacy.",
    inputs: ["lackOfEfficacy"],
  },
  {
    id: "S14",
    number: "14",
    title: "Late-Breaking Information",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "Important safety information received after the DLP but before the report was finalised. Cases received after the DLP are listed from the records.",
    inputs: ["lateBreakingComment"],
  },
  {
    id: "S15",
    number: "15",
    title: "Overview of Signals: New, Ongoing or Closed",
    source: "RECORDS",
    naAllowed: false,
    guidance:
      "Signals new, ongoing or closed in the interval, from the signal reviews and screens recorded in the system.",
    inputs: [],
  },
  {
    id: "S16",
    number: "16",
    title: "Signal and Risk Evaluation",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "Summary of safety concerns, signal evaluation, evaluation of risks and new information, characterisation of risks, effectiveness of risk minimisation.",
    inputs: ["signalEvaluation", "riskMinimisation"],
  },
  {
    id: "S17",
    number: "17",
    title: "Benefit Evaluation",
    source: "AUTHOR",
    naAllowed: false,
    guidance:
      "Important baseline efficacy/effectiveness information, newly identified information and characterisation of benefits.",
    inputs: ["benefitEvaluation"],
  },
  {
    id: "S18",
    number: "18",
    title: "Integrated Benefit-Risk Analysis for Approved Indications",
    source: "AUTHOR",
    naAllowed: false,
    guidance: "Benefit-risk context and evaluation, drawing on the whole report.",
    inputs: ["integratedBenefitRisk"],
  },
  {
    id: "S19",
    number: "19",
    title: "Conclusions and Actions",
    source: "AUTHOR",
    naAllowed: false,
    guidance: "Conclusions on the overall benefit-risk and any actions proposed.",
    inputs: ["conclusionsActions"],
  },
  {
    id: "S20",
    number: "20",
    title: "Response to Previous NAFDAC Queries and Commitments",
    source: "AUTHOR",
    naAllowed: false,
    guidance:
      "How each query or commitment from the previous NAFDAC assessment has been addressed, or a statement that this is the first submission (screening item 16).",
    inputs: ["previousQueries"],
  },
  {
    id: "S21",
    number: "21",
    title: "Appendices",
    source: "MIXED",
    naAllowed: false,
    guidance:
      "I Reference safety information (SmPC); II Clinical-trial tabulation (if any); III Line listing of serious adverse events / ICSRs or a nil statement (from the records); IV Literature search strategy and references.",
    inputs: ["rmpVersion"],
  },
];

export const SECTION_BY_ID: Record<DraftSectionId, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<DraftSectionId, SectionDef>;

export const sectionHeading = (s: SectionDef) => (s.number ? `${s.number}. ${s.title}` : s.title);
