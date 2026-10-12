import { describe, expect, it } from "vitest";
import vectors from "./fix-guard-vectors.json";
import { acceptedAiCorrections, isDerivedValue } from "./linelist-ai-fix-guard";

/**
 * The shared guard cases. The backend (test_fix_guard_vectors.py) runs the
 * same file against src/server/ai/fix_guard.py, so the browser and the
 * server cannot disagree about what the AI may change.
 */
const MAPPING: Record<string, string> = {
  ID: "case_id",
  "Hospital No": "patient_id",
  Sex: "sex",
  Age: "age",
  "Vacc date": "vaccination_date",
  "Report date": "report_date",
  Remarks: "remarks",
};

describe("derived values (shared cases)", () => {
  it.each(vectors.derived.map((d) => [d.from, d.to, d.ok, d.why, d.row] as const))(
    "%s → %s is %s (%s)",
    (from, to, ok, _why, row) => {
      expect(isDerivedValue(from, to, row)).toBe(ok);
    },
  );
});

describe("AI answers (shared cases)", () => {
  it.each(vectors.corrections.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = acceptedAiCorrections(
      c.answer.map((a) => ({ row: 1, reason: "r", ...a })),
      c.asked.map((column) => ({ row: 1, column })),
      [c.row as Record<string, string>],
      MAPPING,
      "g",
      (c as { fill?: Record<string, number> }).fill ?? {},
    );
    expect(r.accepted.map((a) => a.column).sort()).toEqual([...c.applied].sort());
    expect(r.rejected.map((a) => a.column).sort()).toEqual([...c.refused].sort());
  });
});
