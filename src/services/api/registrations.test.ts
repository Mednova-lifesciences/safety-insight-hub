import { describe, expect, it } from "vitest";
import {
  allAlerts,
  registrationAlerts,
  validateRegistration,
  type Registration,
} from "./registrations";

const reg = (extra: Partial<Registration> = {}): Registration => ({
  id: "r1",
  productName: "Modia Paracetamol",
  registrationNumber: "A4-1234",
  status: "ACTIVE",
  variations: [],
  commitments: [],
  ...extra,
});

const today = "2026-11-03";

describe("registrationAlerts — expiry", () => {
  it("is quiet more than 180 days out", () => {
    expect(registrationAlerts(reg({ expiryDate: "2027-06-01" }), today)).toEqual([]);
  });
  it("escalates at 180, 90 and 30 days, then expired", () => {
    const level = (expiryDate: string) => registrationAlerts(reg({ expiryDate }), today)[0]?.level;
    expect(level("2027-05-02")).toBe("NOTICE"); // 180 days
    expect(level("2027-02-01")).toBe("WARNING"); // 90
    expect(level("2026-12-03")).toBe("CRITICAL"); // 30
    expect(level("2026-11-03")).toBe("CRITICAL"); // today
    expect(level("2026-11-02")).toBe("EXPIRED");
  });
  it("stops once the renewal is filed, and for withdrawn registrations", () => {
    expect(
      registrationAlerts(
        reg({ expiryDate: "2026-12-01", renewalSubmittedOn: "2026-10-01" }),
        today,
      ),
    ).toEqual([]);
    expect(
      registrationAlerts(reg({ expiryDate: "2026-12-01", status: "WITHDRAWN" }), today),
    ).toEqual([]);
  });
  it("words the alert with the days left", () => {
    expect(registrationAlerts(reg({ expiryDate: "2026-11-13" }), today)[0]?.title).toBe(
      "Registration A4-1234 expires in 10 days — file the renewal",
    );
  });
});

describe("registrationAlerts — commitments", () => {
  it("alerts on open commitments due within 30 days or overdue", () => {
    const alerts = registrationAlerts(
      reg({
        commitments: [
          { id: "c1", description: "Stability data", dueDate: "2026-11-20", done: false },
          { id: "c2", description: "Label update", dueDate: "2026-10-01", done: false },
          { id: "c3", description: "Done one", dueDate: "2026-11-05", done: true },
          { id: "c4", description: "Far off", dueDate: "2027-03-01", done: false },
        ],
      }),
      today,
    );
    expect(alerts.map((a) => [a.key, a.level])).toEqual([
      ["r1:commitment:c1", "CRITICAL"],
      ["r1:commitment:c2", "EXPIRED"],
    ]);
  });
});

describe("allAlerts", () => {
  it("puts the most urgent first", () => {
    const alerts = allAlerts(
      [
        reg({ id: "a", expiryDate: "2027-04-01" }),
        reg({ id: "b", expiryDate: "2026-10-01" }),
        reg({ id: "c", expiryDate: "2026-11-20" }),
      ],
      today,
    );
    expect(alerts.map((a) => a.registrationId)).toEqual(["b", "c", "a"]);
  });
});

describe("validateRegistration", () => {
  it("needs a product, a number, and an expiry after issue", () => {
    const ok = reg({ issueDate: "2022-01-01", expiryDate: "2027-01-01" });
    expect(validateRegistration(ok)).toEqual([]);
    expect(validateRegistration({ ...ok, productName: " " })).toHaveLength(1);
    expect(validateRegistration({ ...ok, registrationNumber: "" })).toHaveLength(1);
    expect(validateRegistration({ ...ok, expiryDate: "2021-01-01" })).toHaveLength(1);
  });
});
