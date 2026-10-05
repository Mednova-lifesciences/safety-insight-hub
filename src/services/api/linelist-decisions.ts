import type {
  DropReason,
  LineListDecision,
  LineListDecisionKind,
  LineListIssue,
} from "@/types/pv";

/**
 * Case decisions on a line list: Keep (no entry), Drop, Step down.
 *
 * NAFDAC's bar for this tool is that it does the cleaning and people come
 * in only at the decision points — to accept, reject or step down cases.
 * These are those decision points, and every rule about what a decision
 * does lives here so the API, the XML and the screen cannot disagree.
 */

export const DROP_REASON_LABELS: Record<DropReason, string> = {
  DUPLICATE: "Duplicate",
  NOT_AN_AEFI: "Not an AEFI",
  INSUFFICIENT_INFORMATION: "Insufficient information",
  OTHER: "Other",
};

export interface DecisionInput {
  row: number;
  decision: LineListDecisionKind;
  reason?: DropReason;
  note?: string;
}

export function decisionFor(
  decisions: LineListDecision[] | undefined,
  row: number,
): LineListDecision | undefined {
  return decisions?.find((d) => d.row === row);
}

/** Both Drop and Step down take a case out of the XML and the counts. */
export function isExcluded(decisions: LineListDecision[] | undefined, row: number): boolean {
  return !!decisionFor(decisions, row);
}

/**
 * The decisions with this row's decision set — validated.
 *
 * A row that is not a case is refused rather than stored as a phantom
 * decision. A Drop needs a reason, and "Other" needs a note with actual
 * words in it: the audit trail is where someone will later ask why a case
 * never reached VigiFlow.
 */
export function withDecision(
  decisions: LineListDecision[] | undefined,
  input: DecisionInput,
  rowCount: number,
  by: string,
  at: string,
): LineListDecision[] {
  if (!Number.isInteger(input.row) || input.row < 1 || input.row > rowCount) {
    throw new Error(`Row ${input.row} is not a case in this line list.`);
  }
  const note = input.note?.trim() ?? "";
  if (input.decision === "DROP") {
    if (!input.reason) throw new Error("Choose a reason for dropping this case.");
    if (input.reason === "OTHER" && !note) {
      throw new Error('Add a note explaining the drop when the reason is "Other".');
    }
  }
  const next: LineListDecision = {
    row: input.row,
    decision: input.decision,
    ...(input.decision === "DROP" && input.reason ? { reason: input.reason } : {}),
    ...(note ? { note } : {}),
    by,
    at,
  };
  return [...(decisions ?? []).filter((d) => d.row !== input.row), next];
}

/** Back to Keep. */
export function withoutDecision(
  decisions: LineListDecision[] | undefined,
  row: number,
): LineListDecision[] {
  return (decisions ?? []).filter((d) => d.row !== row);
}

/**
 * Only what belongs to kept cases. A file-level item (row 0 or below) is
 * always kept: a wrong source form blocks the whole file, and dropping
 * cases does not make it go away.
 */
export function keptOnly<T extends { row: number }>(
  items: T[],
  decisions: LineListDecision[] | undefined,
): T[] {
  if (!decisions || decisions.length === 0) return items;
  return items.filter((i) => i.row < 1 || !isExcluded(decisions, i.row));
}

export function describeDecision(d: LineListDecision): string {
  const note = d.note ? `: ${d.note}` : "";
  if (d.decision === "STEP_DOWN") return `HELD — stepped down${note}`;
  const reason = d.reason ? DROP_REASON_LABELS[d.reason] : "No reason recorded";
  return `DROPPED — ${reason}${note}`;
}

export function decisionCounts(
  decisions: LineListDecision[] | undefined,
): { dropped: number; held: number } {
  const all = decisions ?? [];
  return {
    dropped: all.filter((d) => d.decision === "DROP").length,
    held: all.filter((d) => d.decision === "STEP_DOWN").length,
  };
}

/** One sentence for the E2B step, or "" when nothing is left out. */
export function describeExcluded(counts: { dropped: number; held: number }): string {
  if (counts.dropped === 0 && counts.held === 0) return "";
  return `${counts.dropped} dropped and ${counts.held} held case(s) will not be in the XML.`;
}

export type DecisionFilter = "ALL" | "KEPT" | "DROPPED" | "HELD";

/** The issues table's two groups: kept rows first, decided rows under the
 *  "not counted" divider. */
export function issuesForFilter(
  issues: LineListIssue[],
  decisions: LineListDecision[] | undefined,
  filter: DecisionFilter,
): { kept: LineListIssue[]; decided: LineListIssue[] } {
  const kept = keptOnly(issues, decisions);
  const decidedAs = (kind: LineListDecisionKind) =>
    issues.filter((i) => i.row >= 1 && decisionFor(decisions, i.row)?.decision === kind);
  switch (filter) {
    case "KEPT":
      return { kept, decided: [] };
    case "DROPPED":
      return { kept: [], decided: decidedAs("DROP") };
    case "HELD":
      return { kept: [], decided: decidedAs("STEP_DOWN") };
    default:
      return { kept, decided: issues.filter((i) => i.row >= 1 && isExcluded(decisions, i.row)) };
  }
}

/**
 * Decided cases with no open issue, for the filter in force.
 *
 * The issues table is built from issues, so a decided case whose issues
 * have all gone would otherwise disappear — and a held case that cannot be
 * seen cannot be returned to Keep.
 */
export function decidedRowsWithoutIssues(
  issues: LineListIssue[],
  decisions: LineListDecision[] | undefined,
  filter: DecisionFilter,
): number[] {
  if (filter === "KEPT") return [];
  const withIssues = new Set(issues.map((i) => i.row));
  return (decisions ?? [])
    .filter((d) => !withIssues.has(d.row))
    .filter(
      (d) =>
        filter === "ALL" ||
        (filter === "DROPPED" && d.decision === "DROP") ||
        (filter === "HELD" && d.decision === "STEP_DOWN"),
    )
    .map((d) => d.row)
    .sort((a, b) => a - b);
}

/**
 * Leaves decided cases out of mapped output, by row position.
 *
 * Called AFTER every row has been mapped. A case without its own ID gets
 * one generated from its row position (mapping.ts), so removing rows
 * before mapping would hand every later case a different ID on the next
 * export, and VigiFlow would see existing patients as new cases.
 *
 * Refuses when the cases do not line up one to one with the rows: then
 * "the case at position N" may not be row N's case, and excluding it would
 * drop the wrong patient.
 */
export function excludeDecidedCases<T>(
  cases: T[],
  decisions: LineListDecision[] | undefined,
  rowCount: number,
): { included: T[]; dropped: number; held: number } {
  if (cases.length !== rowCount) {
    throw new Error(
      `Expected one case per row (${rowCount} rows, ${cases.length} cases); refusing to guess which cases were decided.`,
    );
  }
  const included: T[] = [];
  let dropped = 0;
  let held = 0;
  cases.forEach((c, i) => {
    const d = decisionFor(decisions, i + 1);
    if (!d) included.push(c);
    else if (d.decision === "DROP") dropped++;
    else held++;
  });
  return { included, dropped, held };
}
