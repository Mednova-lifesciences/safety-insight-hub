import { describe, expect, it } from "vitest";
import type { ClusterCase, ClusterFlag } from "./linelist-clusters";
import { caseKeyOf, casesSinceDismissal, isDismissed, type FlagDismissal } from "./flag-dismissals";
import { sortFlagsNewestFirst } from "@/components/pv/linelist-cross-file-panels";

const c = (row: number, date = "2026-10-14"): ClusterCase => ({
  jobId: "ll-1",
  filename: "f.xlsx",
  row,
  serious: true,
  vaccinationDate: date,
  reactions: [],
});
const flag = (over: Partial<ClusterFlag> = {}): ClusterFlag => ({
  key: "BATCH|MR-7712",
  kind: "BATCH",
  label: "MR-7712",
  cases: [c(15), c(16), c(17)],
  from: "2026-10-14",
  to: "2026-10-16",
  facilities: ["A", "B", "C"],
  batches: ["MR-7712"],
  products: ["Measles-Rubella"],
  pattern: "PRODUCT_QUALITY",
  warningSigns: [],
  ...over,
});
const dismissal = (f: ClusterFlag, active = true): FlagDismissal => ({
  id: "flagdismiss-1",
  flagKey: f.key,
  label: f.label,
  caseKeys: f.cases.map(caseKeyOf),
  by: "TEST Evaluator",
  role: "EVALUATOR",
  at: "2026-11-01T10:00:00Z",
  active,
});

describe("a dismissed flag", () => {
  it("stays hidden while it holds the same cases", () => {
    const f = flag();
    expect(isDismissed(f, dismissal(f))).toBe(true);
  });

  it("comes back when a new case joins it, and says how many", () => {
    const before = flag();
    const after = flag({ cases: [...before.cases, c(30, "2026-10-20")], to: "2026-10-20" });
    expect(isDismissed(after, dismissal(before))).toBe(false);
    expect(casesSinceDismissal(after, dismissal(before))).toBe(1);
  });

  it("stays hidden if a case leaves it (dropped or held)", () => {
    const before = flag();
    const after = flag({ cases: before.cases.slice(0, 2) });
    expect(isDismissed(after, dismissal(before))).toBe(true);
  });

  it("is shown once restored, and with no dismissal at all", () => {
    const f = flag();
    expect(isDismissed(f, dismissal(f, false))).toBe(false);
    expect(isDismissed(f, undefined)).toBe(false);
  });
});

describe("flags are listed newest first", () => {
  it("by their latest case, then the more concerning pattern", () => {
    const old = flag({ key: "a", to: "2026-09-01" });
    const newer = flag({ key: "b", to: "2026-10-20", pattern: "ONE_BATCH_ONE_FACILITY" });
    const sameDayQuality = flag({ key: "c", to: "2026-10-20", pattern: "PRODUCT_QUALITY" });
    expect(sortFlagsNewestFirst([old, newer, sameDayQuality]).map((f) => f.key)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});
