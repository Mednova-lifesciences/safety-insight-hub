import type { PsurDeficiencyType, PsurFinding } from "@/types/pv";

/**
 * THE single answer to "who has to act on this finding — the MAH, or the
 * assessor?" — read by the Compliance Directive (which findings appear at
 * all), the Executive Summary (its MAH-action vs assessor-internal
 * counts), and the Review Findings panel's own badge, so all three can
 * never disagree.
 *
 * Root problem this file fixes: directive membership used to be decided by
 * `suggestedSource.type === "REQUEST_FROM_MAH"`. But `suggestedSource`
 * answers a completely different question — "where could an assessor go
 * LOOK for this evidence" (VigiFlow, published literature, the RSI, other
 * regulators' actions...). The two meanings were carried by one field, so
 * a genuinely MAH-only deficiency that happened to carry a research-y
 * source silently vanished from the MAH-facing directive. Concretely: a
 * MISSING_REQUIRED_SECTION for "6. Literature" with a PUBLISHED_LITERATURE
 * source was labelled "assessor can resolve internally" and produced a
 * directive reading "DEFICIENCIES REQUIRING MAH ACTION (0)" — even after
 * the assessor had explicitly ACCEPTED it. An assessor cannot write the
 * MAH's missing section for them; only the MAH can supply it.
 *
 * The two questions are now answered independently:
 *  - suggestedSource → where to look for the evidence (unchanged).
 *  - requiresMahAction → who must actually act (here).
 */

/**
 * Deficiency types that are claims about THE SUBMITTED DOCUMENT'S OWN
 * CONTENT — a section that isn't there, information that is incomplete,
 * an internal contradiction, an ambiguity, an unsupported claim. Nobody
 * but the document's author can resolve these: no amount of assessor
 * research fills in a section the MAH did not write, or explains a
 * contradiction only the MAH can account for. These are MAH-facing
 * regardless of which source was suggested for further reading.
 */
const MAH_ONLY_DEFICIENCY_TYPES = new Set<PsurDeficiencyType>([
  "MISSING_REQUIRED_SECTION",
  "MISSING_INFORMATION",
  "INCOMPLETE_INFORMATION",
  "INCONSISTENCY",
  "UNCLEAR_AMBIGUOUS_INFORMATION",
  "UNSUPPORTED_CLAIM",
]);

/**
 * The remaining deficiency types (INADEQUATE_EVIDENCE,
 * INSUFFICIENT_LOCAL_EVIDENCE, ADDITIONAL_LITERATURE_REQUIRED,
 * DATA_DISCREPANCY) are about EXTERNAL evidence an assessor may genuinely
 * be able to obtain themselves — checking VigiFlow's Nigerian component,
 * screening published literature, comparing other regulators' actions.
 * For those, the explicit REQUEST_FROM_MAH source stays the deciding
 * signal: it means the reviewer/model judged that this particular one has
 * to go back to the MAH.
 */
export function requiresMahAction(f: PsurFinding): boolean {
  // An assessor who has explicitly reassigned this finding outranks the
  // derivation entirely — the rules below are a defensible default, not a
  // judgement this tool is entitled to make over a human's objection.
  if (f.actionOwnerOverride) return f.actionOwnerOverride.owner === "MAH";
  // An explicit deficiencyType is the richer, deliberately-assigned
  // classification, so it decides on its own — both ways. Falling through
  // to the coarse `category` after it would misroute a finding that was
  // specifically typed as something an assessor can chase down.
  if (f.deficiencyType) {
    return (
      MAH_ONLY_DEFICIENCY_TYPES.has(f.deficiencyType) ||
      f.suggestedSource?.type === "REQUEST_FROM_MAH"
    );
  }
  // Backstop for findings stored before deficiencyType existed: a missing
  // section is MAH-only whatever else is known about it.
  if (f.category === "MISSING_SECTION") return true;
  return f.suggestedSource?.type === "REQUEST_FROM_MAH";
}

/** Short, human-readable ownership label — the same words everywhere the
 *  distinction is shown, so the page and the exported documents read
 *  identically. */
export function actionOwnerLabel(f: PsurFinding): string {
  return requiresMahAction(f) ? "Needs MAH response" : "Assessor can resolve internally";
}

/** What the rules WOULD have concluded, ignoring any assessor override —
 *  so the UI and the exported documents can show what was changed and by
 *  whom, rather than silently presenting a reassigned finding as though
 *  the system had classified it that way. */
export function derivedRequiresMahAction(f: PsurFinding): boolean {
  return requiresMahAction({ ...f, actionOwnerOverride: undefined });
}

/** True when an assessor's override actually contradicts the derivation —
 *  an override that merely agrees with the rules is not worth flagging. */
export function isActionOwnerOverridden(f: PsurFinding): boolean {
  return !!f.actionOwnerOverride && requiresMahAction(f) !== derivedRequiresMahAction(f);
}
