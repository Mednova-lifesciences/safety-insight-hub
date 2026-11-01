import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The IBD register is one row per organisation. Row-level security shows a
 * caller only their own organisation's rows, so this stand-in does the same:
 * `visible` is what the signed-in organisation can see, and an upsert onto a
 * row that exists but is not visible is refused, as the database refuses it.
 */
type Row = { id: string; org: string; data: Record<string, unknown>; created_at: string };
let rows: Row[] = [];
let org = "org-a";
const upserts: string[] = [];

function query() {
  const filters: Array<(r: Row) => boolean> = [];
  const visible = () => rows.filter((r) => r.org === org && filters.every((f) => f(r)));
  const q = {
    select: () => q,
    eq: (col: string, value: string) => {
      filters.push((r) =>
        col === "data->>kind"
          ? r.data["kind"] === value
          : (r as Record<string, unknown>)[col] === value,
      );
      return q;
    },
    order: () => q,
    limit: (n: number) =>
      Promise.resolve({
        data: visible()
          .slice(0, n)
          .map(({ id, data }) => ({ id, data })),
        error: null,
      }),
    upsert: (row: { id: string; data: Record<string, unknown> }) => {
      upserts.push(row.id);
      const existing = rows.find((r) => r.id === row.id);
      if (existing && existing.org !== org)
        return Promise.resolve({
          error: {
            message: 'new row violates row-level security policy for table "pv_psur_documents"',
          },
        });
      if (existing) existing.data = row.data;
      else rows.push({ ...row, org, created_at: new Date().toISOString() });
      return Promise.resolve({ error: null });
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => query() } }));
vi.mock("./db", async (actual) => ({
  ...(await actual<typeof import("./db")>()),
  recordAudit: vi.fn(async () => undefined),
  currentActor: () => ({ name: "Test Officer", role: "REVIEW_OFFICER" }),
}));

const { ibdRegister } = await import("./psur-ibd");

const entry = (activeSubstance: string) => ({
  activeSubstance,
  ibd: "2014-03-17",
  productNames: [],
  nafdacRegNos: [],
  source: "",
});

beforeEach(() => {
  // The first organisation ever to save owns the original fixed-id row.
  rows = [
    {
      id: "psur-ibd-register",
      org: "org-main",
      data: { kind: "PSUR_IBD_REGISTER", entries: [{ ...entry("Amoxicillin"), id: "ibd-1" }] },
      created_at: "2026-10-11T11:06:35Z",
    },
  ];
  upserts.length = 0;
});

describe("the IBD register is per organisation", () => {
  it("another organisation can save its first IBD (it used to be refused)", async () => {
    org = "org-a";
    expect(await ibdRegister.list()).toEqual([]);
    await ibdRegister.save(entry("Paracetamol"));
    expect(upserts[0]).not.toBe("psur-ibd-register");
    expect((await ibdRegister.list()).map((e) => e.activeSubstance)).toEqual(["Paracetamol"]);
  });

  it("later saves and removals go to that organisation's own row", async () => {
    org = "org-a";
    await ibdRegister.save(entry("Paracetamol"));
    const saved = await ibdRegister.save(entry("Ibuprofen"));
    await ibdRegister.remove(saved.id);
    expect(new Set(upserts).size).toBe(1);
    expect(rows.filter((r) => r.org === "org-a")).toHaveLength(1);
  });

  it("the organisation that owns the original row keeps using it", async () => {
    org = "org-main";
    await ibdRegister.save(entry("Ibuprofen"));
    expect(upserts).toEqual(["psur-ibd-register"]);
    expect((await ibdRegister.list()).map((e) => e.activeSubstance)).toEqual([
      "Amoxicillin",
      "Ibuprofen",
    ]);
  });

  it("organisations never see each other's register", async () => {
    org = "org-a";
    await ibdRegister.save(entry("Paracetamol"));
    org = "org-main";
    expect((await ibdRegister.list()).map((e) => e.activeSubstance)).toEqual(["Amoxicillin"]);
  });
});
