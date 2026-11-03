import { describe, expect, it } from "vitest";
import {
  branchActivity,
  branchLink,
  isMissingTable,
  monthKey,
  validateBranch,
  type Branch,
} from "./branches";
import { encodeQr, qrSvgPath } from "@/lib/qr-code";

const b = (name: string, extra: Partial<Branch> = {}): Branch => ({
  id: name,
  name,
  active: true,
  ...extra,
});

describe("monthKey", () => {
  it("walks back across years", () => {
    expect(monthKey("2026-11-03", 0)).toBe("2026-11");
    expect(monthKey("2026-11-03", 5)).toBe("2026-06");
    expect(monthKey("2026-02-10", 3)).toBe("2025-11");
  });
});

describe("branchActivity", () => {
  const today = "2026-11-03";
  const cases = [
    { branch: "Lekki", receivedDate: "2026-11-01" },
    { branch: "lekki ", receivedDate: "2026-10-20" },
    { branch: "Lekki", receivedDate: "2026-06-15" },
    { branch: "Lekki", receivedDate: "2025-01-01" },
    { branch: "Yaba (typed)", receivedDate: "2026-09-01" },
    { receivedDate: "2026-11-02" },
  ];

  it("counts reports per branch, by month and in the last 30 days", () => {
    const rows = branchActivity([b("Lekki"), b("Ikeja")], cases, today);
    const lekki = rows.find((r) => r.name === "Lekki")!;
    expect(lekki.last30Days).toBe(2);
    expect(lekki.total).toBe(4);
    expect(lekki.monthly).toEqual([1, 0, 0, 0, 1, 1]);
    expect(lekki.lastReport).toBe("2026-11-01");
  });

  it("flags active register branches with no report in 30 days", () => {
    const rows = branchActivity(
      [b("Lekki"), b("Ikeja"), b("Old", { active: false })],
      cases,
      today,
    );
    expect(rows.find((r) => r.name === "Ikeja")!.silent).toBe(true);
    expect(rows.find((r) => r.name === "Old")!.silent).toBe(false);
    expect(rows.find((r) => r.name === "Lekki")!.silent).toBe(false);
    expect(rows[0]!.silent).toBe(true);
  });

  it("lists branch names found on cases but missing from the register", () => {
    const rows = branchActivity([], cases, today);
    const typed = rows.find((r) => r.name === "Yaba (typed)")!;
    expect(typed.branch).toBeUndefined();
    expect(typed.silent).toBe(false);
    expect(rows.map((r) => r.name).sort()).toEqual(["Lekki", "Yaba (typed)"]);
  });
});

describe("validateBranch", () => {
  it("needs a unique name", () => {
    const input = { name: " lekki ", active: true };
    expect(validateBranch(input, [b("Lekki")])).toHaveLength(1);
    expect(validateBranch({ name: "  ", active: true }, [])).toHaveLength(1);
    expect(validateBranch(input, [b("Ikeja")])).toEqual([]);
  });
});

describe("branchLink", () => {
  it("encodes the branch name for the public link", () => {
    expect(branchLink("https://x.app", "medplus", "Lekki Phase 1 & 2")).toBe(
      "https://x.app/r/medplus?branch=Lekki%20Phase%201%20%26%202",
    );
  });
});

describe("isMissingTable", () => {
  it("recognises a missing table, and nothing else", () => {
    expect(isMissingTable({ code: "PGRST205", message: "" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ message: 'relation "pv_branches" does not exist' })).toBe(true);
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe("encodeQr", () => {
  it("picks the smallest version that fits and draws finder patterns", () => {
    expect(encodeQr("hi")).toHaveLength(21);
    const m = encodeQr("https://x.app/r/medplus?branch=Lekki%20Phase%201");
    expect(m.length).toBeGreaterThan(21);
    // finder pattern: dark ring, light ring, dark 3×3 core at the top-left
    expect(m[0]!.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(m[1]!.slice(0, 7)).toEqual([true, false, false, false, false, false, true]);
    expect(m[3]![3]).toBe(true);
  });
  it("renders an SVG path with a quiet zone", () => {
    const { path, size } = qrSvgPath(encodeQr("hi"));
    expect(size).toBe(29);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
