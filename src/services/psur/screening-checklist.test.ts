import { describe, expect, it } from "vitest";
import {
  SCREENING_CHECKS,
  SUBMISSION_WINDOW_DAYS,
  assessTimeliness,
  checksInGroup,
  emptyChecks,
  intervalMonths,
  isValidationItem,
  normalizeChecks,
  recommendOutcome,
  screeningCheck,
} from "./screening-checklist";
import type { PsurScreeningCheckId, PsurScreeningCheckItem } from "@/types/pv";

function check(
  id: PsurScreeningCheckId,
  status: PsurScreeningCheckItem["status"],
): PsurScreeningCheckItem {
  return { id, status, deficiency: "", assistGenerated: false };
}

/** A full pass, which individual tests then spoil one item at a time. */
function allYes(): PsurScreeningCheckItem[] {
  return SCREENING_CHECKS.map((c) => check(c.id, "YES"));
}

describe("the checklist matches the NAFDAC form", () => {
  it("has 16 checks numbered 1 to 16 with no gaps or duplicates", () => {
    // The outcome cites these numbers on the compliance directive, so a
    // renumbering would silently change what a directive refers to.
    expect(SCREENING_CHECKS).toHaveLength(16);
    expect(SCREENING_CHECKS.map((c) => c.number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it("groups them 4 / 4 / 8, as the form does", () => {
    expect(checksInGroup("SUBMISSION_PACKAGE")).toHaveLength(4);
    expect(checksInGroup("DATES_AND_TIMELINESS")).toHaveLength(4);
    expect(checksInGroup("REPORT_CONTENT_PRESENT")).toHaveLength(8);
  });

  it("treats exactly items 1-8 as validation deficiencies", () => {
    // "Any No in items 1–8 = validation deficiency" is the form's own rule
    // and the hinge the whole outcome turns on.
    for (const c of SCREENING_CHECKS) {
      expect(isValidationItem(c.id), `item ${c.number}`).toBe(c.number <= 8);
    }
  });

  it("names an external record for every check the document cannot answer", () => {
    // These four ask whether something MATCHES a NAFDAC record or follows
    // on from a previous submission. Nothing in the PDF can settle them,
    // so each must tell the officer where to look instead.
    const external = SCREENING_CHECKS.filter((c) => c.requiresExternalRecord);
    expect(external.map((c) => c.number)).toEqual([2, 3, 7, 16]);
    for (const c of external) expect(c.requiresExternalRecord).toBeTruthy();
  });

  it("computes only item 8", () => {
    expect(SCREENING_CHECKS.filter((c) => c.computed).map((c) => c.number)).toEqual([8]);
  });
});

describe("a blank checklist", () => {
  it("starts every row as unanswered, never as a pass", () => {
    // Defaulting to YES would mean an untouched form reads as a clean
    // submission.
    const blank = emptyChecks();
    expect(blank).toHaveLength(16);
    expect(blank.every((c) => c.status === "NOT_ASSESSABLE")).toBe(true);
  });

  it("restores missing rows in order when a stored checklist is short", () => {
    const stored = [check("COVER_LETTER_COMPLETE", "YES")];
    const normalized = normalizeChecks(stored);
    expect(normalized).toHaveLength(16);
    expect(normalized[0]!.status).toBe("YES");
    expect(normalized[1]!.status).toBe("NOT_ASSESSABLE");
    expect(normalized.map((c) => screeningCheck(c.id).number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });
});

describe("intervalMonths", () => {
  it.each([
    ["01 Jul 2025 – 30 Jun 2026", 11],
    ["2025-07-01 to 2026-06-30", 11],
    ["01 Jan 2024 - 31 Dec 2025", 23],
  ])("reads %s as about %i months", (input, expected) => {
    expect(intervalMonths(input)).toBe(expected);
  });

  it("returns null rather than guessing when it cannot read two dates", () => {
    // Guessing picks the wrong submission window, which either excuses a
    // late report or accuses a punctual one.
    expect(intervalMonths("")).toBeNull();
    expect(intervalMonths("annual")).toBeNull();
    expect(intervalMonths("sometime last year")).toBeNull();
  });
});

describe("item 8 — timeliness", () => {
  it("passes a report inside the 70-day window for a 12-month interval", () => {
    const result = assessTimeliness({
      dlp: "2026-06-30",
      dateReceived: "2026-08-13",
      intervalCovered: "01 Jul 2025 – 30 Jun 2026",
    });
    expect(result.status).toBe("YES");
    expect(result.daysToReceipt).toBe(44);
    expect(result.allowedDays).toBe(SUBMISSION_WINDOW_DAYS.INTERVAL_UP_TO_12_MONTHS);
  });

  it("fails a report past the window and says how many days late", () => {
    const result = assessTimeliness({
      dlp: "2026-01-01",
      dateReceived: "2026-04-01",
      intervalCovered: "01 Jan 2025 – 31 Dec 2025",
    });
    expect(result.status).toBe("NO");
    expect(result.daysToReceipt).toBe(90);
    expect(result.daysLate).toBe(20);
    expect(result.note).toContain("20 day(s) beyond");
  });

  it("allows 90 days when the interval is longer than 12 months", () => {
    // The same 85 days that would fail a 12-month interval passes here.
    const long = assessTimeliness({
      dlp: "2026-01-01",
      dateReceived: "2026-03-27",
      intervalCovered: "01 Jan 2024 – 31 Dec 2025",
    });
    expect(long.status).toBe("YES");
    expect(long.allowedDays).toBe(SUBMISSION_WINDOW_DAYS.INTERVAL_OVER_12_MONTHS);

    const short = assessTimeliness({
      dlp: "2026-01-01",
      dateReceived: "2026-03-27",
      intervalCovered: "01 Jan 2025 – 31 Dec 2025",
    });
    expect(short.status).toBe("NO");
  });

  it("cannot tell without a DLP, and says which date is missing", () => {
    const r = assessTimeliness({ dlp: "", dateReceived: "2026-08-13", intervalCovered: "" });
    expect(r.status).toBe("NOT_ASSESSABLE");
    expect(r.daysToReceipt).toBeUndefined();
    expect(r.note).toMatch(/Data Lock Point/i);
  });

  it("cannot tell which window applies when the interval is unreadable", () => {
    // Still reports the day count, which is a real fact, but refuses the
    // verdict, which is not knowable.
    const r = assessTimeliness({
      dlp: "2026-01-01",
      dateReceived: "2026-03-01",
      intervalCovered: "annual",
    });
    expect(r.status).toBe("NOT_ASSESSABLE");
    expect(r.daysToReceipt).toBe(59);
    expect(r.note).toMatch(/70-day or 90-day/);
  });

  it("flags a receipt date before the DLP as wrong rather than as very early", () => {
    const r = assessTimeliness({
      dlp: "2026-06-30",
      dateReceived: "2026-06-01",
      intervalCovered: "01 Jul 2025 – 30 Jun 2026",
    });
    expect(r.status).toBe("NO");
    expect(r.note).toMatch(/BEFORE the stated Data Lock Point/);
  });
});

describe("the outcome the answers imply", () => {
  it("accepts a clean submission", () => {
    const r = recommendOutcome(allYes());
    expect(r.decision).toBe("ACCEPTED_FOR_ASSESSMENT");
    expect(r.citedItems).toEqual([]);
  });

  it("a single No in items 1-8 forces a directive, however clean the rest", () => {
    const checks = allYes().map((c) =>
      c.id === "DLP_AND_INTERVAL_CONSISTENT" ? check(c.id, "NO") : c,
    );
    const r = recommendOutcome(checks);
    expect(r.decision).toBe("COMPLIANCE_DIRECTIVE");
    expect(r.citedItems).toEqual([6]);
    expect(r.reason).toMatch(/validation deficiency/);
  });

  it("a No in items 9-16 is cited but described as a presence check", () => {
    const checks = allYes().map((c) => (c.id === "APPENDIX_RSI_ATTACHED" ? check(c.id, "NO") : c));
    const r = recommendOutcome(checks);
    expect(r.decision).toBe("COMPLIANCE_DIRECTIVE");
    expect(r.citedItems).toEqual([15]);
    expect(r.reason).toMatch(/presence checks/);
  });

  it("cites every failed item, in form order", () => {
    const checks = allYes().map((c) => {
      if (c.id === "APPENDIX_RSI_ATTACHED") return check(c.id, "NO");
      if (c.id === "COVER_LETTER_COMPLETE") return check(c.id, "NO");
      return c;
    });
    expect(recommendOutcome(checks).citedItems).toEqual([1, 15]);
  });

  it("N/A is not a failure", () => {
    const checks = allYes().map((c) =>
      c.id === "APPENDIX_RSI_ATTACHED" ? check(c.id, "NOT_APPLICABLE") : c,
    );
    expect(recommendOutcome(checks).decision).toBe("ACCEPTED_FOR_ASSESSMENT");
  });

  it("unanswered items block a clean acceptance without counting as failures", () => {
    // The distinction that matters: "nobody checked" is not "it failed",
    // but it is also not a pass the officer can lean on.
    const checks = allYes().map((c) =>
      c.id === "QPPV_DETAILS_STATED" ? check(c.id, "NOT_ASSESSABLE") : c,
    );
    const r = recommendOutcome(checks);
    expect(r.decision).toBe("ACCEPTED_FOR_ASSESSMENT");
    expect(r.citedItems).toEqual([]);
    expect(r.unresolvedItems).toEqual([2]);
    expect(r.reason).toMatch(/could not be answered/);
  });

  it("a blank checklist recommends acceptance of nothing", () => {
    const r = recommendOutcome(emptyChecks());
    expect(r.unresolvedItems).toHaveLength(16);
    expect(r.reason).toMatch(/could not be answered/);
  });
});
