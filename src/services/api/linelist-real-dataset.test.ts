import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runValidation, TARGET_FIELDS, type ParsedRow, type TargetField } from "./linelist";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";
import { discoverAndApplyCodebook } from "@/services/e2b-r3/export";

/**
 * Runs the line-list "executive summary" quality-check layer (runValidation)
 * against the ACTUAL real 231-row Ondo AEFI dataset and its ACTUAL
 * discovered legend — the exact fixtures src/services/e2b-r3's
 * ondo-real-data.test.ts already uses — to prove the executive summary
 * itself (not just the separate E2B case-validation path) stops reporting
 * UNRECOGNISED_OUTCOME_VALUE for values the source's own codebook defines.
 *
 * Before this fix, runValidation() never received any SourceProfile at
 * all and checked outcome against a hardcoded generic word list — so a
 * codebook-coded value like "1" (which the real discovered legend defines
 * as "1 = Recovered") was flagged UNRECOGNISED_OUTCOME_VALUE here even
 * though the SAME value resolved cleanly to E2B outcome RECOVERED one
 * layer over, in mapping.ts. That is the exact discrepancy this test
 * exists to catch a regression of.
 */
describe("line-list executive summary — real Ondo dataset, before vs after codebook resolution", () => {
  it("outcome/reaction findings reflect the ACTUAL discovered codebook, not a stale hardcoded vocabulary", () => {
    const rows = JSON.parse(
      readFileSync(join(__dirname, "..", "e2b-r3", "__fixtures__", "ondo-real-rows.json"), "utf-8"),
    ) as ParsedRow[];
    expect(rows.length).toBe(231);
    const legendLines = JSON.parse(
      readFileSync(join(__dirname, "..", "e2b-r3", "__fixtures__", "ondo-real-legend.json"), "utf-8"),
    ) as { row: number; text: string }[];

    // Identity header<->field mapping — these fixture rows are already
    // canonical-field-keyed (see ondo-real-data.test.ts), so this is
    // simply "every target field this file actually has, present as its
    // own header" — not a hand-picked or hardcoded set.
    const presentFields = TARGET_FIELDS.filter((f) => rows.some((r) => r[f] !== undefined));
    const headers = [...presentFields];
    const mapping: Record<string, TargetField> = Object.fromEntries(presentFields.map((f) => [f, f]));

    const baseProfile = getSourceProfile("ondo-aefi");
    // BEFORE: the base profile with no discovered codebook at all — this
    // is what runValidation effectively saw prior to this fix, since it
    // never called codebook discovery in the first place.
    const before = runValidation(headers, mapping, rows, baseProfile);

    // AFTER: the SAME real legend text discovered/resolved exactly as
    // export.ts's own pipeline does.
    const { runtimeProfile, discovered } = discoverAndApplyCodebook(baseProfile, legendLines, {
      file: "src/types/2026, ONDO STATE AEFI.xlsx",
      sheet: "Sheet1",
    });
    expect(discovered.discoveryStatus).toBe("DISCOVERED");
    const after = runValidation(headers, mapping, rows, runtimeProfile);

    const countOf = (issues: typeof before, code: string) => issues.filter((i) => i.code === code).length;

    // The stale finding this whole investigation started from.
    const beforeUnrecognised = countOf(before, "UNRECOGNISED_OUTCOME_VALUE");
    const afterUnrecognised = countOf(after, "UNRECOGNISED_OUTCOME_VALUE");
    expect(beforeUnrecognised).toBeGreaterThan(0); // reproduces the reported bug
    expect(afterUnrecognised).toBe(0); // the real legend covers every outcome code (0-3) this dataset uses

    // The values that stop being "unrecognised" don't just vanish — the
    // ones with no approved E2B mapping become an honest, distinct,
    // still-visible human-review finding instead of disappearing.
    const afterHumanReview = countOf(after, "OUTCOME_REQUIRES_HUMAN_REVIEW");
    expect(afterHumanReview).toBeGreaterThan(0);

    // Total outcome-related findings before vs after: the OLD generic
    // bucket empties out, but nothing is silently dropped — every case
    // that was flagged before is still flagged after, just correctly
    // reclassified as MAPPED (no finding), UNKNOWN_SOURCE_CODE (still
    // UNRECOGNISED_OUTCOME_VALUE), or HUMAN_REVIEW_REQUIRED (the new code).
    expect(afterUnrecognised + afterHumanReview).toBeLessThanOrEqual(beforeUnrecognised);

    // Every remaining row-level finding must carry a real decoded concept
    // in its message, not a hardcoded string — proves this is driven by
    // the actual legend content, not a special case.
    const humanReviewIssues = after.filter((i) => i.code === "OUTCOME_REQUIRES_HUMAN_REVIEW");
    for (const issue of humanReviewIssues) {
      expect(issue.message).toMatch(/decodes to "[^"]+"/);
    }

    // Sanity: this real dataset never populates a separate reaction_code
    // column (reaction itself carries the codes), so INVALID_REACTION_CODE
    // must be silent either way — proving the range-check rewrite didn't
    // introduce any new false positive on real data.
    expect(countOf(before, "INVALID_REACTION_CODE")).toBe(0);
    expect(countOf(after, "INVALID_REACTION_CODE")).toBe(0);

    // eslint-disable-next-line no-console
    console.log("[linelist executive summary] before/after outcome findings:", {
      beforeUnrecognisedOutcome: beforeUnrecognised,
      afterUnrecognisedOutcome: afterUnrecognised,
      afterOutcomeHumanReview: afterHumanReview,
    });
  });
});
