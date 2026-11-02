import { describe, expect, it } from "vitest";
import {
  contentKeyOf,
  olderVersionsOf,
  repeatsByKeys,
  repeatsOf,
  type UploadRef,
  type VersionCase,
} from "./linelist-repeats";

const up = (id: string, uploadedAt: string, contentKey?: string): UploadRef => ({
  id,
  filename: `${id}.xlsx`,
  uploadedAt,
  ...(contentKey ? { contentKey } : {}),
});

describe("repeat uploads of the same line list", () => {
  it("the first upload is counted; later identical ones repeat it", () => {
    const r = repeatsOf([
      up("c", "2026-11-03T10:00:00Z", "K"),
      up("a", "2026-11-01T10:00:00Z", "K"),
      up("b", "2026-11-02T10:00:00Z", "K"),
    ]);
    expect([...r.keys()].sort()).toEqual(["b", "c"]);
    expect(r.get("b")!.id).toBe("a");
    expect(r.get("c")!.id).toBe("a");
  });

  it("different content is never a repeat, and an unknown fingerprint never is", () => {
    const r = repeatsOf([
      up("a", "2026-11-01T10:00:00Z", "K1"),
      up("b", "2026-11-02T10:00:00Z", "K2"),
      up("c", "2026-11-03T10:00:00Z"),
      up("d", "2026-11-04T10:00:00Z"),
    ]);
    expect(r.size).toBe(0);
  });

  it("the same rows give the same fingerprint, whatever the file is called; any change gives another", async () => {
    const rows = [
      { "Case ID": "ON/AKS/26/001", Reaction: "5" },
      { "Case ID": "ON/AKS/26/002", Reaction: "5, 4" },
    ];
    const same = await contentKeyOf(rows.map((r) => ({ ...r })));
    expect(await contentKeyOf(rows)).toBe(same);
    const edited = [rows[0]!, { ...rows[1]!, Reaction: "5" }];
    expect(await contentKeyOf(edited)).not.toBe(same);
  });
});

describe("the content fingerprint", () => {
  it("does not depend on the order of a row's columns (the database reorders them)", async () => {
    const a = [{ "Case ID": "X1", Age: "9", Sex: "F" }];
    const b = [{ Sex: "F", Age: "9", "Case ID": "X1" }];
    expect(await contentKeyOf(a)).toBe(await contentKeyOf(b));
  });
});

describe("repeatsByKeys — what the signal screen and flags count once", () => {
  it("a job with the same upload fingerprint, or the same case rows, repeats the earlier one", () => {
    const r = repeatsByKeys([
      { id: "a", uploadedAt: "2026-09-01T00:00:00Z", keys: ["c:1", "r:X"] },
      { id: "b", uploadedAt: "2026-09-02T00:00:00Z", keys: [undefined, "r:X"] },
      { id: "c", uploadedAt: "2026-09-03T00:00:00Z", keys: ["c:1", "r:Y"] },
      { id: "d", uploadedAt: "2026-09-04T00:00:00Z", keys: [undefined, "r:Z"] },
      { id: "e", uploadedAt: "2026-09-05T00:00:00Z", keys: [undefined, undefined] },
    ]);
    expect(Object.fromEntries(r)).toEqual({ b: "a", c: "a" });
  });
});

describe("olderVersionsOf — a corrected or re-issued line list replaces the earlier one", () => {
  const cases = (prefix: string, n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => ({
      caseId: `${prefix} ${String(from + i).padStart(3, "0")}`,
      product: "MR/MV",
      vaccinationDate: `${(i % 28) + 1}/2/26`,
      sex: i % 2 ? "MALE" : "FEMALE",
      age: String(i % 9),
    }));
  const job = (id: string, day: number, c: VersionCase[]) => ({
    id,
    uploadedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`,
    cases: c,
  });

  it("nine edited versions of the same 231 cases: only the newest is counted", () => {
    const jobs = Array.from({ length: 9 }, (_, i) => {
      const c = cases("NIE ODS KAK 26", 231);
      c[i * 3]!.vaccinationDate = "edited"; // a few cells differ per version
      return job(`v${i}`, i + 1, c);
    });
    const r = olderVersionsOf(jobs);
    expect(r.size).toBe(8);
    expect([...new Set(r.values())]).toEqual(["v8"]);
  });

  it("a version with no case IDs is matched by product, vaccination date, sex and age", () => {
    const noIds = cases("X", 231).map(({ caseId: _c, ...rest }) => rest);
    const r = olderVersionsOf([job("old", 1, noIds), job("new", 2, cases("NIE", 231))]);
    expect(Object.fromEntries(r)).toEqual({ old: "new" });
  });

  it("a cumulative list (the old cases plus new ones) replaces the earlier list", () => {
    const r = olderVersionsOf([
      job("oct", 1, cases("ON", 200)),
      job("nov", 2, [...cases("ON", 200), ...cases("ON", 30, 201)]),
    ]);
    expect(Object.fromEntries(r)).toEqual({ oct: "nov" });
  });

  it("an LGA return sharing 4 cases with the state list stays a separate list", () => {
    const state = cases("ON", 25);
    const lga = [...state.slice(2, 6), ...cases("LGA", 4)];
    expect(olderVersionsOf([job("state", 1, state), job("lga", 2, lga)]).size).toBe(0);
  });

  it("the same details under different case IDs are different cases (left to the duplicates check)", () => {
    const a = cases("OG-4", 6);
    const b = cases("OG-8", 6);
    expect(olderVersionsOf([job("a", 1, a), job("b", 2, b)]).size).toBe(0);
  });

  it("different lists that both number their cases 1, 2, 3 … are not versions", () => {
    const a = cases("A", 10).map((c, i) => ({
      caseId: String(i + 1),
      product: "Penta",
      vaccinationDate: `${i + 1}/9/26`,
      sex: "F",
      age: "2",
    }));
    const b = cases("B", 10).map((c, i) => ({
      caseId: String(i + 1),
      product: "BCG",
      vaccinationDate: `${i + 1}/10/26`,
      sex: "M",
      age: "1",
    }));
    expect(olderVersionsOf([job("a", 1, a), job("b", 2, b)]).size).toBe(0);
  });
});
