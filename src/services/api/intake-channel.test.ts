import { describe, expect, it } from "vitest";
import {
  BRANCH_MAX_LENGTH,
  CHANNEL_NOT_RECORDED,
  cleanBranch,
  describeIntake,
  distinctBranches,
  matchesBranchFilter,
  matchesChannelFilter,
  parseIntakeChannel,
  resolveIntake,
} from "./intake-channel";
import { buildCaseDetail, type NewIcsrPayload } from "./cases";

const payload = (extra: Partial<NewIcsrPayload> = {}): NewIcsrPayload => ({
  reporter: { name: "A. Pharmacist" },
  patient: { identifier: "P1" },
  product: { reportedName: "Modia Paracetamol" },
  reaction: { reportedTerm: "Rash" },
  narrative: "",
  reportedSeriousness: "NON_SERIOUS",
  seriousnessCriteria: [],
  ...extra,
});

describe("parseIntakeChannel", () => {
  it("accepts known channels only", () => {
    expect(parseIntakeChannel("ECOMMERCE")).toBe("ECOMMERCE");
    expect(parseIntakeChannel("ecommerce")).toBeUndefined();
    expect(parseIntakeChannel("FAX")).toBeUndefined();
    expect(parseIntakeChannel(3)).toBeUndefined();
  });
});

describe("cleanBranch", () => {
  it("trims, collapses whitespace and strips control characters", () => {
    expect(cleanBranch("  Lekki\n  Phase\t1 ")).toBe("Lekki Phase 1");
    expect(cleanBranch("Ikeja\u0000Mall")).toBe("Ikeja Mall");
  });
  it("caps the length", () => {
    expect(cleanBranch("x".repeat(500))).toHaveLength(BRANCH_MAX_LENGTH);
  });
  it("returns undefined for empty or non-string values", () => {
    expect(cleanBranch("   ")).toBeUndefined();
    expect(cleanBranch(undefined)).toBeUndefined();
    expect(cleanBranch(["Lekki"])).toBeUndefined();
  });
});

describe("resolveIntake", () => {
  it("keeps a branch only for the branch channel", () => {
    expect(resolveIntake("BRANCH", "Lekki")).toEqual({ intakeChannel: "BRANCH", branch: "Lekki" });
    expect(resolveIntake("PHONE", "Lekki")).toEqual({ intakeChannel: "PHONE" });
  });
  it("treats a branch with no channel as the branch channel", () => {
    expect(resolveIntake(undefined, "Lekki")).toEqual({ intakeChannel: "BRANCH", branch: "Lekki" });
  });
  it("records nothing when neither is given or the channel is unknown", () => {
    expect(resolveIntake(undefined, undefined)).toEqual({});
    expect(resolveIntake("FAX", "")).toEqual({});
  });
});

describe("buildCaseDetail", () => {
  it("stores the channel and branch on the case", () => {
    const c = buildCaseDetail("MN-1", payload({ intakeChannel: "BRANCH", branch: " Lekki " }), "x");
    expect(c.intakeChannel).toBe("BRANCH");
    expect(c.branch).toBe("Lekki");
  });
  it("leaves both absent when not given, as on older cases", () => {
    const c = buildCaseDetail("MN-1", payload(), "x");
    expect(c).not.toHaveProperty("intakeChannel");
    expect(c).not.toHaveProperty("branch");
  });
});

describe("describeIntake", () => {
  it("names the branch for branch reports", () => {
    expect(describeIntake({ intakeChannel: "BRANCH", branch: "Lekki" })).toBe(
      "Branch / store — Lekki",
    );
    expect(describeIntake({ intakeChannel: "ECOMMERCE" })).toBe("E-commerce");
    expect(describeIntake({})).toBe("Not recorded");
  });
});

describe("filters", () => {
  it("matches channels, including cases with none recorded", () => {
    expect(matchesChannelFilter({ intakeChannel: "PHONE" }, "all")).toBe(true);
    expect(matchesChannelFilter({ intakeChannel: "PHONE" }, "PHONE")).toBe(true);
    expect(matchesChannelFilter({ intakeChannel: "PHONE" }, "EMAIL")).toBe(false);
    expect(matchesChannelFilter({}, CHANNEL_NOT_RECORDED)).toBe(true);
    expect(matchesChannelFilter({ intakeChannel: "PHONE" }, CHANNEL_NOT_RECORDED)).toBe(false);
  });
  it("matches branches case-insensitively", () => {
    expect(matchesBranchFilter({ branch: "Lekki" }, "lekki")).toBe(true);
    expect(matchesBranchFilter({}, "Lekki")).toBe(false);
    expect(matchesBranchFilter({}, "all")).toBe(true);
  });
  it("lists each branch once, first spelling wins, sorted", () => {
    expect(
      distinctBranches([{ branch: "Lekki" }, { branch: "lekki" }, {}, { branch: "Ikeja" }]),
    ).toEqual(["Ikeja", "Lekki"]);
  });
});
