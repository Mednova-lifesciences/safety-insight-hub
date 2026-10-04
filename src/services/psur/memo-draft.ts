import type {
  AssessmentMemoDraft,
  AssessmentSection,
  CiomsMatrix,
  EvidenceEntry,
  EvidenceSourceType,
  MemoCriterionId,
  PsurDocument,
  PsurOverallBenefitRiskOutcome,
  PsurSubmissionDetails,
  PsurV4SectionId,
} from "@/types/pv";
import {
  CRITERION_SECTIONS,
  MEMO_REFERENCE_PREFIX,
  type AssessmentMemoInput,
} from "./assessment-memo";
import { isAccepted, supersede } from "./evidence";

/**
 * The memo workspace's state transitions, kept pure so the screen holds no
 * rules of its own.
 *
 * Evidence stays append-only throughout (see evidence.ts): accepting or
 * rejecting stamps a candidate, and a correction is a new entry superseding
 * the old one. Nothing here deletes.
 */

/** The criteria an assessor gathers evidence for, in form order. */
export const EVIDENCE_CRITERIA: MemoCriterionId[] = [
  "RSI_CHANGES",
  "WORLDWIDE_ACTIONS",
  "PATIENT_EXPOSURE",
  "RELEVANT_STUDIES",
  "OVERALL_SAFETY_EVALUATION",
];

/** Which criteria the public-registry search answers. Criterion 9 is
 *  NAFDAC's own VigiFlow figure and is entered by hand (spec section 7). */
export const RESEARCHABLE_CRITERIA: MemoCriterionId[] = [
  "RSI_CHANGES",
  "WORLDWIDE_ACTIONS",
  "RELEVANT_STUDIES",
  "OVERALL_SAFETY_EVALUATION",
];

/**
 * The working section new evidence for a criterion is filed under.
 *
 * Each criterion gets a section no other criterion is projected from, so
 * an entry filed here cannot surface under a second criterion even before
 * its `criterion` tag is consulted. S5 feeds both 8 and 9, which is why
 * neither files there.
 */
const HOME_SECTION: Partial<Record<MemoCriterionId, PsurV4SectionId>> = {
  RSI_CHANGES: "S4_RSI",
  WORLDWIDE_ACTIONS: "S2_WORLDWIDE_STATUS",
  PATIENT_EXPOSURE: "S7_AGGREGATE_SAFETY_DATA",
  RELEVANT_STUDIES: "S6_LITERATURE",
  OVERALL_SAFETY_EVALUATION: "S8_SIGNAL_EVALUATION",
};

export function homeSection(id: MemoCriterionId): PsurV4SectionId {
  const section = HOME_SECTION[id];
  if (!section) throw new Error(`${id} is not an evidence criterion`);
  return section;
}

/** The source type a hand-entered entry for this criterion defaults to. */
export function defaultSourceType(id: MemoCriterionId): EvidenceSourceType {
  switch (id) {
    case "RSI_CHANGES":
      return "REFERENCE_SAFETY_INFORMATION";
    case "WORLDWIDE_ACTIONS":
      return "WORLDWIDE_REGULATORY_ACTIONS";
    case "PATIENT_EXPOSURE":
      return "VIGIFLOW_NIGERIA";
    case "RELEVANT_STUDIES":
      return "PUBLISHED_LITERATURE";
    default:
      return "OTHER";
  }
}

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

/** "17 September 2026" — how the supplied memo writes its date. */
export function formatMemoDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function submissionDetailsOf(doc: PsurDocument): PsurSubmissionDetails {
  const d = doc.administrativeScreening?.submissionDetails;
  return {
    productName: d?.productName || doc.product || "",
    activeSubstance: d?.activeSubstance || "",
    nafdacRegNo: d?.nafdacRegNo || "",
    mah: d?.mah || doc.mah || "",
    qppv: d?.qppv || "",
    qppvContact: d?.qppvContact || "",
    ibd: d?.ibd || "",
    firstNafdacRegistrationDate: d?.firstNafdacRegistrationDate || "",
    dlp: d?.dlp || "",
    intervalCovered: d?.intervalCovered || doc.reportingPeriod || "",
    dateReceived: d?.dateReceived || doc.uploadedAt || "",
  };
}

/** The substance to search registries for: the active substance when the
 *  screening read one, else the product name. */
export function searchSubstance(doc: PsurDocument): string {
  const d = submissionDetailsOf(doc);
  return (d.activeSubstance || d.productName).trim();
}

/**
 * A fresh draft, pre-filled only with what is known.
 *
 * The addressees and signature lines are the supplied memo's own, because
 * every memo of this kind goes the same way; each stays editable. The
 * reference number is left for the assessor (MEMO_REFERENCE_PREFIX).
 */
export function defaultMemoDraft(doc: PsurDocument, today: Date = new Date()): AssessmentMemoDraft {
  const d = submissionDetailsOf(doc);
  return {
    referenceSuffix: "",
    memoDate: formatMemoDate(today),
    to: "D (Drug R&R)",
    from: "D (PV)",
    signatory: "",
    signatoryTitle: "Director (PV)",
    locationAddress: "CHQ Abuja",
    productNameAndStrength: d.productName,
    therapeuticCategory: "",
    // The screening often reads the MAH with its address; the forwarding
    // sentence wants the company name alone.
    mahName: d.mah.split(",")[0]!.trim(),
    answers: {},
    overallSafetyEnumeration: "",
    bandConfirmed: "",
    // Starts from the Evaluator's own Section 12 decision — a person's
    // decision, not the rubric's proposal — so the two documents agree
    // unless someone deliberately changes one.
    verdictConfirmed: verdictFromSection12(doc) ?? "",
    analysisOfMatrix:
      "Following an expert in-house review of the safety and efficacy profile of the above " +
      "medicinal product, we have established the following:",
    conclusion: "",
  };
}

/** A matrix with every score at zero and no reactions yet. */
export function emptyCiomsMatrix(): CiomsMatrix {
  const zero = { seriousness: 0, duration: 0, incidence: 0 };
  return { epidemiologyOfDisease: { ...zero }, effectivenessOfProduct: { ...zero }, adrs: [] };
}

/** What the memo builder needs, read off the document and its draft. */
export function memoInputFromDocument(
  doc: PsurDocument,
  draft: AssessmentMemoDraft,
): AssessmentMemoInput {
  return {
    referenceNumber: MEMO_REFERENCE_PREFIX + draft.referenceSuffix.trim(),
    memoDate: draft.memoDate,
    to: draft.to,
    from: draft.from,
    signatory: draft.signatory,
    signatoryTitle: draft.signatoryTitle,
    locationAddress: draft.locationAddress,
    mahName: draft.mahName,
    productNameAndStrength: draft.productNameAndStrength,
    therapeuticCategory: draft.therapeuticCategory,
    details: submissionDetailsOf(doc),
    sections: doc.assessmentSections ?? [],
    matrix: doc.ciomsMatrix ?? emptyCiomsMatrix(),
    confirmedBandLabel: draft.bandConfirmed,
    confirmedVerdict: draft.verdictConfirmed,
    analysisOfMatrix: draft.analysisOfMatrix,
    conclusion: draft.conclusion,
    answers: draft.answers,
    overallSafetyEnumeration: draft.overallSafetyEnumeration,
  };
}

/** What blocks generating the memo, in the assessor's words. Empty when
 *  nothing does. Warnings are separate: they inform, they do not block. */
/**
 * The memo's wording for each Section 12 outcome.
 *
 * The supplied NAFDAC memo concludes "Positive Benefit-Risk Balance", so a
 * favourable outcome is worded that way; the others follow the same form.
 * The outcome itself is recorded once, in Section 12 — this only words it.
 */
export const OUTCOME_VERDICT: Record<PsurOverallBenefitRiskOutcome, string> = {
  FAVOURABLE: "Positive Benefit-Risk Balance",
  FAVOURABLE_WITH_CONDITIONS: "Positive Benefit-Risk Balance, subject to conditions",
  UNCERTAIN_REQUIRES_FOLLOWUP: "Benefit-Risk Balance uncertain, requiring follow-up",
  UNFAVOURABLE: "Negative Benefit-Risk Balance",
};

/** The memo verdict implied by the Section 12 decision, if one was made. */
export function verdictFromSection12(doc: PsurDocument): string | undefined {
  const outcome = doc.regulatoryDecision?.overallOutcome;
  return outcome ? OUTCOME_VERDICT[outcome] : undefined;
}

/**
 * Things worth knowing before generating that do not block it.
 *
 * A memo verdict that differs from Section 12 is allowed — the assessor may
 * have a reason — but it would put two different benefit-risk conclusions
 * on the record for one report, so it is said out loud.
 */
export function memoWarnings(doc: PsurDocument, draft: AssessmentMemoDraft): string[] {
  const out: string[] = [];
  const fromSection12 = verdictFromSection12(doc);
  const verdict = draft.verdictConfirmed.trim();
  if (fromSection12 && verdict && verdict !== fromSection12) {
    out.push(
      `The memo's verdict ("${verdict}") differs from the Section 12 outcome ` +
        `("${fromSection12}"). Make them agree, or be sure the difference is intended.`,
    );
  }
  if (!doc.regulatoryDecision?.overallOutcome) {
    out.push("Section 12 has no overall benefit-risk outcome recorded yet.");
  }
  return out;
}

export function memoBlockers(
  draft: AssessmentMemoDraft,
  matrix: CiomsMatrix | undefined,
): string[] {
  const out: string[] = [];
  if (!draft.referenceSuffix.trim()) out.push("Enter the memo reference number.");
  if (!draft.productNameAndStrength.trim()) out.push("Enter the product name and strength.");
  if (!draft.signatory.trim()) out.push("Enter the signatory.");
  if (!matrix) out.push("Score the ICH/CIOMS matrix.");
  else if (matrix.adrs.length === 0) out.push("Add at least one adverse reaction to the matrix.");
  if (!draft.bandConfirmed.trim()) out.push("Confirm the efficacy band.");
  if (!draft.verdictConfirmed.trim()) out.push("Confirm the benefit-risk verdict.");
  if (!draft.conclusion.trim()) out.push("Write the conclusion.");
  return out;
}

export type EvidenceStatus = "ACCEPTED" | "CANDIDATE" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";

export function evidenceStatus(e: EvidenceEntry, all: EvidenceEntry[]): EvidenceStatus {
  if (all.some((other) => other.supersedes === e.id)) return "SUPERSEDED";
  if (e.withdrawnBy) return "WITHDRAWN";
  if (e.rejectedBy) return "REJECTED";
  if (isAccepted(e)) return "ACCEPTED";
  return "CANDIDATE";
}

/** Every entry filed under the criterion's sections, with its status. */
export function evidenceForCriterion(
  sections: AssessmentSection[],
  id: MemoCriterionId,
): { entry: EvidenceEntry; status: EvidenceStatus }[] {
  const wanted = new Set(CRITERION_SECTIONS[id]);
  // Status is judged against everything in these sections, so a revision
  // filed under another criterion still marks its original superseded.
  const all = sections.filter((s) => wanted.has(s.section)).flatMap((s) => s.evidence);
  return all
    .filter((entry) => !entry.criterion || entry.criterion === id)
    .map((entry) => ({ entry, status: evidenceStatus(entry, all) }));
}

function sectionOf(sections: AssessmentSection[], id: PsurV4SectionId): AssessmentSection {
  return sections.find((s) => s.section === id) ?? { section: id, evidence: [] };
}

/** The section with one more entry appended. */
export function appendEvidence(
  sections: AssessmentSection[],
  entry: EvidenceEntry,
): AssessmentSection {
  const section = sectionOf(sections, entry.section);
  if (!entry.citation.trim()) throw new Error("Evidence needs a citation.");
  if (section.evidence.some((e) => e.id === entry.id)) return section;
  return { ...section, evidence: [...section.evidence, entry] };
}

function stamp(
  sections: AssessmentSection[],
  entryId: string,
  patch: (e: EvidenceEntry) => EvidenceEntry,
): AssessmentSection {
  const section = sections.find((s) => s.evidence.some((e) => e.id === entryId));
  if (!section) throw new Error("That evidence entry no longer exists.");
  return { ...section, evidence: section.evidence.map((e) => (e.id === entryId ? patch(e) : e)) };
}

/** Accepting is what turns a candidate into evidence the memo may print. */
export function acceptEvidence(
  sections: AssessmentSection[],
  entryId: string,
  by: string,
  at: string,
): AssessmentSection {
  return stamp(sections, entryId, (e) => {
    if (e.rejectedBy) throw new Error("A rejected entry cannot be accepted; add it again instead.");
    return isAccepted(e) ? e : { ...e, acceptedBy: by, acceptedAt: at };
  });
}

/** Rejecting keeps the candidate on record and out of the memo. */
export function rejectEvidence(
  sections: AssessmentSection[],
  entryId: string,
  by: string,
  at: string,
): AssessmentSection {
  return stamp(sections, entryId, (e) => {
    if (isAccepted(e))
      throw new Error("Accepted evidence is corrected by revising it, not rejected.");
    return e.rejectedBy ? e : { ...e, rejectedBy: by, rejectedAt: at };
  });
}

/**
 * An assessor's correction: a NEW entry, accepted by them, superseding the
 * old one. The old entry stays exactly as it was.
 */
export function reviseEvidence(
  sections: AssessmentSection[],
  previous: EvidenceEntry,
  change: { content: string; citation: string },
  id: string,
  by: string,
  at: string,
  /** The criterion the revision is made under; defaults to the original's. */
  criterion?: MemoCriterionId | undefined,
): AssessmentSection {
  const tag = criterion ?? previous.criterion;
  const next = supersede(previous, {
    id,
    ...(tag ? { criterion: tag } : {}),
    ...(previous.v4Field ? { v4Field: previous.v4Field } : {}),
    section: previous.section,
    sourceType: previous.sourceType,
    citation: change.citation,
    content: change.content,
    origin: "assessor",
    addedBy: by,
    addedAt: at,
    acceptedBy: by,
    acceptedAt: at,
  });
  return appendEvidence(sections, next);
}
