import type {
  AssessmentSection,
  EvidenceEntry,
  MemoCriterionId,
  PsurFinding,
  PsurV4SectionId,
} from "@/types/pv";
import {
  appendEvidence,
  defaultSourceType,
  homeSection,
  RESEARCHABLE_CRITERIA,
} from "./memo-draft";
import { supersede } from "./evidence";

/**
 * Resolving a review finding with the assessor's own research.
 *
 * NAFDAC's evaluators fill the gaps a submission leaves rather than sending
 * it back (confirmed 2026-09-30). This is where that happens for a finding:
 * the research is stored ONCE, as accepted memo evidence pointing back at
 * the finding, and the finding records that it was resolved and by whom. So
 * the memo prints it under its criterion, the MAH feedback letter lists the
 * finding as resolved by NAFDAC, and editing the research changes both.
 */

/**
 * The memo criterion a finding's research most naturally belongs under,
 * from the working section the finding is about. Undefined when no memo
 * criterion covers that section (product identity, special populations,
 * the decision and sign-off themselves) — the assessor chooses, or files
 * the research against the finding only.
 */
const SECTION_CRITERION: Partial<Record<PsurV4SectionId, MemoCriterionId>> = {
  S2_WORLDWIDE_STATUS: "WORLDWIDE_ACTIONS",
  S3_THERAPEUTIC_CONTEXT: "RELEVANT_STUDIES",
  S4_RSI: "RSI_CHANGES",
  S5_EXPOSURE_ACTIONS: "WORLDWIDE_ACTIONS",
  S6_LITERATURE: "RELEVANT_STUDIES",
  S7_AGGREGATE_SAFETY_DATA: "PATIENT_EXPOSURE",
  S8_SIGNAL_EVALUATION: "OVERALL_SAFETY_EVALUATION",
  S10_BENEFIT_RISK: "OVERALL_SAFETY_EVALUATION",
  S11_UNCERTAINTIES: "OVERALL_SAFETY_EVALUATION",
};

export function criterionForFinding(f: PsurFinding): MemoCriterionId | undefined {
  return f.v4Section ? SECTION_CRITERION[f.v4Section as PsurV4SectionId] : undefined;
}

/** The registry search to run for a finding. Criterion 9 (VigiFlow) and
 *  findings outside the memo have no registry of their own; published
 *  literature is the broadest fallback. */
export function searchCriterionFor(criterion: MemoCriterionId | undefined): MemoCriterionId {
  return criterion && RESEARCHABLE_CRITERIA.includes(criterion) ? criterion : "RELEVANT_STUDIES";
}

/** Only an accepted finding can be resolved: resolving says the gap was
 *  real and NAFDAC filled it, and a dismissed or unreviewed finding has
 *  not been judged real. */
export function canResolveWithResearch(f: PsurFinding): boolean {
  return f.humanAssessment === "ACCEPTED";
}

export interface ResearchInput {
  content: string;
  citation: string;
  /** Undefined files the research against the finding only. */
  criterion?: MemoCriterionId | undefined;
  /** "ai" when the text came from the registry search, even if edited. */
  origin: "ai" | "assessor";
}

/**
 * Takes accepted evidence back out of the memo, keeping it on record.
 * Used when the finding it resolved is reopened.
 */
export function withdrawEvidence(
  sections: AssessmentSection[],
  entryId: string,
  by: string,
  at: string,
): AssessmentSection {
  const section = sections.find((s) => s.evidence.some((e) => e.id === entryId));
  if (!section) throw new Error("That evidence entry no longer exists.");
  return {
    ...section,
    evidence: section.evidence.map((e) =>
      e.id === entryId && !e.withdrawnBy ? { ...e, withdrawnBy: by, withdrawnAt: at } : e,
    ),
  };
}

function liveEvidence(
  sections: AssessmentSection[],
  id: string | undefined,
): EvidenceEntry | undefined {
  if (!id) return undefined;
  const all = sections.flatMap((s) => s.evidence);
  const entry = all.find((e) => e.id === id);
  if (!entry || entry.withdrawnBy || all.some((e) => e.supersedes === id)) return undefined;
  return entry;
}

/**
 * The memo-side change for saving a finding's research: the sections to
 * write back, and the id of the evidence now carrying it.
 *
 * - First save: a new accepted entry under the criterion's home section.
 * - Edit under the same criterion: a revision superseding the previous
 *   entry, which stays on record.
 * - Moved to another criterion, or taken out of the memo: the previous
 *   entry is withdrawn (kept, never printed) and a new one filed if a
 *   criterion is still chosen.
 */
export function fileFindingResearch(
  sections: AssessmentSection[],
  finding: PsurFinding,
  input: ResearchInput,
  newEntryId: string,
  by: string,
  at: string,
): { sections: AssessmentSection[]; evidenceId: string | undefined } {
  if (!canResolveWithResearch(finding)) throw new Error("Accept the finding before resolving it.");
  if (!input.content.trim()) throw new Error("Write what the research found.");
  if (!input.citation.trim())
    throw new Error("Research needs a source: a URL, DOI or document reference.");

  let next = sections;
  const replace = (s: AssessmentSection) => {
    next = [...next.filter((x) => x.section !== s.section), s];
  };
  const previous = liveEvidence(sections, finding.researchResolution?.evidenceId);

  if (previous && input.criterion && previous.criterion === input.criterion) {
    const revised = supersede(previous, {
      id: newEntryId,
      section: previous.section,
      criterion: input.criterion,
      sourceType: previous.sourceType,
      citation: input.citation.trim(),
      content: input.content.trim(),
      origin: input.origin,
      addedBy: by,
      addedAt: at,
      acceptedBy: by,
      acceptedAt: at,
      findingId: finding.id,
    });
    replace(appendEvidence(next, revised));
    return { sections: next, evidenceId: newEntryId };
  }

  if (previous) replace(withdrawEvidence(next, previous.id, by, at));
  if (!input.criterion) return { sections: next, evidenceId: undefined };

  const entry: EvidenceEntry = {
    id: newEntryId,
    section: homeSection(input.criterion),
    criterion: input.criterion,
    sourceType: defaultSourceType(input.criterion),
    citation: input.citation.trim(),
    content: input.content.trim(),
    origin: input.origin,
    addedBy: by,
    addedAt: at,
    acceptedBy: by,
    acceptedAt: at,
    findingId: finding.id,
  };
  replace(appendEvidence(next, entry));
  return { sections: next, evidenceId: newEntryId };
}

/** The finding as resolved by this research. Stays in the findings list. */
export function resolvedFinding(
  finding: PsurFinding,
  input: ResearchInput,
  evidenceId: string | undefined,
  by: string,
  at: string,
): PsurFinding {
  return {
    ...finding,
    resolved: true,
    resolution: `${input.content.trim()} Source: ${input.citation.trim()}`,
    researchResolution: {
      by,
      at,
      content: input.content.trim(),
      citation: input.citation.trim(),
      ...(input.criterion ? { criterion: input.criterion } : {}),
      ...(evidenceId ? { evidenceId } : {}),
    },
  };
}

/** The finding reopened: no longer resolved, research no longer attached. */
export function reopenedFinding(finding: PsurFinding): PsurFinding {
  const { researchResolution: _r, resolution: _res, ...rest } = finding;
  return { ...rest, resolved: false };
}
