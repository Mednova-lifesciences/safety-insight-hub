import type { PsurDraft } from "./drafts";
import { sectionBlocks } from "./content";
import { INPUTS, SECTIONS, type DraftSectionId, type InputKey, type SectionDef } from "./template";

/**
 * Where each section stands, and whether the clean draft may be exported.
 *
 *   NOT_APPLICABLE    the author marked it so, with a reason
 *   NEEDS_AUTHOR      a required input is empty (prints as a placeholder)
 *   NEEDS_DATA        a records-based section with no data refresh yet
 *   READY_TO_REVIEW   complete, not yet accepted by a person
 *   REVIEWED          accepted by a person as it will print
 */
export type SectionStatus =
  "NOT_APPLICABLE" | "NEEDS_AUTHOR" | "NEEDS_DATA" | "READY_TO_REVIEW" | "REVIEWED";

export const STATUS_LABELS: Record<SectionStatus, string> = {
  NOT_APPLICABLE: "Not applicable",
  NEEDS_AUTHOR: "Needs author",
  NEEDS_DATA: "Refresh data",
  READY_TO_REVIEW: "Ready to review",
  REVIEWED: "Reviewed",
};

const filled = (v: string | undefined) => !!v && v.trim().length > 0;

export function missingInputs(draft: PsurDraft, s: SectionDef): InputKey[] {
  return s.inputs.filter((k) => INPUTS[k].required && !filled(draft.inputs[k]));
}

export function sectionStatus(draft: PsurDraft, s: SectionDef): SectionStatus {
  const state = draft.sections[s.id];
  if (s.naAllowed && state?.notApplicable?.reason.trim()) return "NOT_APPLICABLE";
  if (missingInputs(draft, s).length > 0) return "NEEDS_AUTHOR";
  if (s.source !== "AUTHOR" && !draft.facts) return "NEEDS_DATA";
  // Judged on what will print, so a section that borrows another's input
  // (the executive summary) is incomplete while that input is empty.
  if (sectionBlocks(draft, s.id).some((b) => b.origin === "PLACEHOLDER")) return "NEEDS_AUTHOR";
  return state?.reviewed ? "REVIEWED" : "READY_TO_REVIEW";
}

export interface Readiness {
  statuses: Record<DraftSectionId, SectionStatus>;
  done: number;
  total: number;
  /** Every section reviewed or justified as not applicable. */
  cleanAllowed: boolean;
  blocking: DraftSectionId[];
}

export function draftReadiness(draft: PsurDraft): Readiness {
  const statuses = Object.fromEntries(
    SECTIONS.map((s) => [s.id, sectionStatus(draft, s)]),
  ) as Record<DraftSectionId, SectionStatus>;
  const blocking = SECTIONS.filter(
    (s) => statuses[s.id] !== "REVIEWED" && statuses[s.id] !== "NOT_APPLICABLE",
  ).map((s) => s.id);
  return {
    statuses,
    done: SECTIONS.length - blocking.length,
    total: SECTIONS.length,
    cleanAllowed: blocking.length === 0,
    blocking,
  };
}
