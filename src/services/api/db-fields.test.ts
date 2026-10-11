import { describe, expect, it } from "vitest";
import { fromDataFields, selectDataFields } from "./db";

describe("reading chosen fields of `data` for lists", () => {
  it("asks for each field by name, keeping its JSON type", () => {
    expect(selectDataFields(["id", "uploadedAt", "kind"])).toBe(
      "id:data->id,uploadedAt:data->uploadedAt,kind:data->kind",
    );
  });

  it("reads a row back as the stored object, leaving absent fields out", () => {
    const row = { id: "ll-1", rows: 12, mapping: { A: "patient" }, fixedAt: null, kind: null };
    expect(fromDataFields(row)).toEqual({ id: "ll-1", rows: 12, mapping: { A: "patient" } });
  });
});
