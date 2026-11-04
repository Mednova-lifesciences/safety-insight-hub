import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  daysBetween,
  isPastDue,
  matchesClockFilter,
  reportingClock,
  todayIso,
} from "./regulatory-clock";

const base = { receivedDate: "2026-11-01", workflowStep: "TRIAGE" as const };

describe("date helpers", () => {
  it("adds days across month ends", () => {
    expect(addDaysIso("2026-11-25", 15)).toBe("2026-12-10");
    expect(addDaysIso("not a date", 1)).toBeUndefined();
  });
  it("counts whole days", () => {
    expect(daysBetween("2026-11-01", "2026-11-16")).toBe(15);
    expect(daysBetween("2026-11-16", "2026-11-01")).toBe(-15);
  });
  it("formats today in local time", () => {
    expect(todayIso(new Date(2026, 10, 3, 23, 30))).toBe("2026-11-03");
  });
});

describe("reportingClock", () => {
  it("gives serious cases 15 days from receipt", () => {
    const c = reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-11-03");
    expect(c).toMatchObject({ windowDays: 15, deadline: "2026-11-16", daysLeft: 13 });
    expect(c.status).toBe("ON_TRACK");
    expect(c.label).toBe("Due in 13 days");
  });
  it("gives non-serious cases 90 days", () => {
    const c = reportingClock({ ...base, seriousness: "NON_SERIOUS" }, "2026-11-03");
    expect(c.deadline).toBe("2027-01-30");
    expect(c.windowDays).toBe(90);
  });
  it("runs unassessed cases on the serious clock", () => {
    expect(reportingClock({ ...base, seriousness: "UNASSESSED" }, "2026-11-03").windowDays).toBe(
      15,
    );
  });
  it("is due soon within 3 days, and due today on the deadline", () => {
    expect(reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-11-13").status).toBe(
      "DUE_SOON",
    );
    const today = reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-11-16");
    expect(today).toMatchObject({ status: "DUE_SOON", label: "Due today" });
  });
  it("is overdue after the deadline", () => {
    const c = reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-11-17");
    expect(c).toMatchObject({ status: "OVERDUE", daysLeft: -1, label: "Overdue by 1 day" });
  });
  it("stops once the case is ready or closed", () => {
    for (const step of ["REGULATORY_READY", "CLOSED"] as const) {
      expect(
        reportingClock({ ...base, workflowStep: step, seriousness: "SERIOUS" }, "2027-01-01")
          .status,
      ).toBe("STOPPED");
    }
  });
  it("says so when there is no usable received date", () => {
    expect(reportingClock({ ...base, receivedDate: "", seriousness: "SERIOUS" }).status).toBe(
      "NO_DATE",
    );
  });
});

describe("isPastDue", () => {
  it("compares against today, not a fixed date", () => {
    expect(isPastDue({ dueDate: "2026-11-02", workflowStep: "TRIAGE" }, "2026-11-03")).toBe(true);
    expect(isPastDue({ dueDate: "2026-11-03", workflowStep: "TRIAGE" }, "2026-11-03")).toBe(false);
    expect(isPastDue({ dueDate: "2026-01-01", workflowStep: "CLOSED" }, "2026-11-03")).toBe(false);
  });
});

describe("matchesClockFilter", () => {
  const overdue = reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-12-01");
  const soon = reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-11-14");
  const fine = reportingClock({ ...base, seriousness: "SERIOUS" }, "2026-11-03");
  it("groups overdue and due-soon as needing attention", () => {
    expect(matchesClockFilter(overdue, "ATTENTION")).toBe(true);
    expect(matchesClockFilter(soon, "ATTENTION")).toBe(true);
    expect(matchesClockFilter(fine, "ATTENTION")).toBe(false);
    expect(matchesClockFilter(fine, "all")).toBe(true);
    expect(matchesClockFilter(overdue, "OVERDUE")).toBe(true);
  });
});
