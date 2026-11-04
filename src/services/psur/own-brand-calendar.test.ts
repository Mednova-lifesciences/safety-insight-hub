import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  buildCalendar,
  calendarEntry,
  casesInPeriod,
  lineListingCsv,
  windowDaysFor,
} from "./own-brand-calendar";
import type { CatalogDrug } from "@/services/api/products";
import type { CaseSummary } from "@/types/pv";

const drug = (psur: CatalogDrug["psur"], extra: Partial<CatalogDrug> = {}): CatalogDrug => ({
  id: "d1",
  name: "Modia Paracetamol",
  ownBrand: true,
  psur,
  ...extra,
});

describe("addMonthsIso", () => {
  it("adds months and clamps to the month's last day", () => {
    expect(addMonthsIso("2026-01-15", 6)).toBe("2026-07-15");
    expect(addMonthsIso("2025-08-31", 6)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-30", 36)).toBe("2029-11-30");
    expect(addMonthsIso("2026-07-15", -6)).toBe("2026-01-15");
    expect(addMonthsIso("bad", 6)).toBeUndefined();
  });
});

describe("windowDaysFor", () => {
  it("uses 70 days up to 12 months and 90 beyond", () => {
    expect(windowDaysFor(6)).toBe(70);
    expect(windowDaysFor(12)).toBe(70);
    expect(windowDaysFor(36)).toBe(90);
  });
});

describe("calendarEntry", () => {
  it("is not set up without an interval or any date", () => {
    expect(calendarEntry(drug(undefined), "2026-11-03").status).toBe("NOT_SET_UP");
    expect(calendarEntry(drug({ intervalMonths: 6 }), "2026-11-03").status).toBe("NOT_SET_UP");
  });

  it("follows the last DLP by one interval", () => {
    const e = calendarEntry(drug({ intervalMonths: 6, lastDlp: "2026-06-30" }), "2026-11-03");
    expect(e).toMatchObject({
      periodStart: "2026-06-30",
      nextDlp: "2026-12-30",
      deadline: "2027-03-10",
      windowDays: 70,
      status: "UPCOMING",
      fromBirthDate: false,
    });
  });

  it("is in preparation once the data is locked, due soon within 30 days, then overdue", () => {
    const d = drug({ intervalMonths: 12, lastDlp: "2025-09-30" });
    // DLP 2026-09-30, deadline 2026-12-09
    expect(calendarEntry(d, "2026-10-15").status).toBe("IN_PREPARATION");
    expect(calendarEntry(d, "2026-11-20").status).toBe("DUE_SOON");
    const late = calendarEntry(d, "2026-12-12");
    expect(late.status).toBe("OVERDUE");
    expect(late.label).toBe("Overdue by 3 day(s)");
  });

  it("works from the birth date when no PSUR has been recorded", () => {
    const e = calendarEntry(drug({ intervalMonths: 6, ibd: "2024-03-01" }), "2026-11-03");
    // anniversaries: …2026-09-01 (deadline 2026-11-10, not passed) → that one
    expect(e).toMatchObject({ nextDlp: "2026-09-01", deadline: "2026-11-10", fromBirthDate: true });
    expect(e.status).toBe("DUE_SOON");
  });
});

describe("buildCalendar", () => {
  it("lists own brands only, most urgent first", () => {
    const catalog: CatalogDrug[] = [
      drug(undefined, { id: "a", name: "A not set up" }),
      drug({ intervalMonths: 12, lastDlp: "2025-06-30" }, { id: "b", name: "B overdue" }),
      { id: "c", name: "C third party", holder: "Other" },
      drug({ intervalMonths: 6, lastDlp: "2026-06-30" }, { id: "d", name: "D upcoming" }),
    ];
    expect(buildCalendar(catalog, "2026-11-03").map((e) => e.drug.id)).toEqual(["b", "d", "a"]);
  });
});

const kase = (id: string, receivedDate: string, extra: Partial<CaseSummary> = {}): CaseSummary => ({
  id,
  patientIdentifier: "P",
  product: "Modia Paracetamol",
  reaction: "Rash, itchy",
  seriousness: "NON_SERIOUS",
  outcome: "RECOVERED",
  workflowStep: "INTAKE",
  assignedTo: "x",
  receivedDate,
  dueDate: receivedDate,
  priority: "LOW",
  flags: [],
  source: "MANUAL",
  ...extra,
});

describe("casesInPeriod", () => {
  it("takes the product's cases received after the period start up to the DLP", () => {
    const rows = [
      kase("1", "2026-06-30"),
      kase("2", "2026-07-01"),
      kase("3", "2026-12-30"),
      kase("4", "2026-12-31"),
      kase("5", "2026-08-01", { product: "Other" }),
      kase("6", "2026-08-01", { product: "Renamed", productId: "d1" }),
      kase("7", "2026-08-01", { productId: "other-id" }),
    ];
    const got = casesInPeriod(rows, drug({}), "2026-06-30", "2026-12-30").map((c) => c.id);
    expect(got).toEqual(["2", "6", "3"]);
  });
});

describe("lineListingCsv", () => {
  it("quotes cells that contain commas", () => {
    const csv = lineListingCsv([kase("1", "2026-07-01")]);
    expect(csv.split("\n")[0]).toMatch(/^Case ID,Received,Product,Reaction/);
    expect(csv).toContain('"Rash, itchy"');
  });
});
