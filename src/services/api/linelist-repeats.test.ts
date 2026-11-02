import { describe, expect, it } from "vitest";
import { contentKeyOf, repeatsOf, type UploadRef } from "./linelist-repeats";

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
