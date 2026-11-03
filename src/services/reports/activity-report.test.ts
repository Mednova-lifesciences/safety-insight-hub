import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import { buildActivityReport, monthPeriod, monthsIn, pct, quarterPeriod } from "./activity-report";
import { buildActivityReportDocx } from "./activity-report-docx";
import type { CaseSummary } from "@/types/pv";
import type { CatalogDrug } from "@/services/api/products";

const kase = (id: string, extra: Partial<CaseSummary> = {}): CaseSummary => ({
  id,
  patientIdentifier: "P",
  product: "Modia Paracetamol",
  reaction: "Rash",
  seriousness: "NON_SERIOUS",
  outcome: "RECOVERED",
  workflowStep: "TRIAGE",
  assignedTo: "x",
  receivedDate: "2026-10-10",
  dueDate: "2026-10-10",
  priority: "LOW",
  flags: [],
  source: "MANUAL",
  ...extra,
});

const catalog: CatalogDrug[] = [
  {
    id: "d1",
    name: "Modia Paracetamol",
    ownBrand: true,
    psur: { intervalMonths: 12, lastDlp: "2025-09-30" },
  },
  { id: "d2", name: "Brand X", holder: "Example Pharma" },
];

describe("periods", () => {
  it("builds month and quarter periods", () => {
    expect(monthPeriod("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
      label: "February 2026",
    });
    expect(quarterPeriod(2026, 4)).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
      label: "Q4 2026",
    });
    expect(monthsIn(quarterPeriod(2026, 4))).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
  it("formats shares", () => {
    expect(pct(1, 3)).toBe("33%");
    expect(pct(0, 0)).toBe("—");
  });
});

describe("buildActivityReport", () => {
  const cases = [
    kase("A", {
      seriousness: "SERIOUS",
      intakeChannel: "BRANCH",
      branch: "Lekki",
      receivedDate: "2026-10-02",
    }),
    kase("B", { intakeChannel: "BRANCH", branch: "lekki", receivedDate: "2026-10-20" }),
    kase("C", {
      intakeChannel: "ECOMMERCE",
      outcome: "FATAL",
      seriousness: "SERIOUS",
      receivedDate: "2026-10-31",
    }),
    kase("D", {
      product: "Brand X",
      receivedDate: "2026-10-15",
      holderForwards: [
        {
          id: "f",
          productName: "Brand X",
          holder: "Example Pharma",
          method: "EMAIL",
          sentOn: "2026-10-16",
          recordedBy: "x",
          recordedAt: "",
        },
      ],
    }),
    kase("E", { product: "Brand X", receivedDate: "2026-09-30" }),
    kase("F", { product: "Foreign Syrup", unlistedProduct: true, receivedDate: "2026-10-05" }),
  ];
  const r = buildActivityReport({
    period: monthPeriod("2026-10"),
    today: "2026-11-03",
    cases,
    catalog,
    registrations: [],
  });

  it("counts the period's reports", () => {
    expect(r.received).toBe(5);
    expect(r.serious).toBe(2);
    expect(r.fatal).toBe(1);
    expect(r.unlistedInPeriod).toBe(1);
  });
  it("groups by channel and branch, branches case-insensitively", () => {
    expect(r.byChannel.find((c) => c.name === "Not recorded")?.count).toBe(2);
    expect(r.byChannel.find((c) => c.name === "Branch / store")?.count).toBe(2);
    expect(r.byBranch).toEqual([{ name: "Lekki", count: 2 }]);
  });
  it("reports forwards made in the period and what is still to forward", () => {
    expect(r.forwardsInPeriod).toHaveLength(1);
    expect(r.awaitingForward).toBe(2); // E (third-party, any period) and F (unlisted)
  });
  it("uses today for the NAFDAC clock", () => {
    // A: serious, received 2 Oct → due 17 Oct → overdue on 3 Nov
    expect(r.overdueNow).toBeGreaterThanOrEqual(1);
  });
  it("includes the own-brand PSUR calendar", () => {
    expect(r.psur.map((e) => e.drug.name)).toEqual(["Modia Paracetamol"]);
  });

  it("builds a Word document", async () => {
    const buf = await Packer.toBuffer(buildActivityReportDocx(r, "MedPlus"));
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});
