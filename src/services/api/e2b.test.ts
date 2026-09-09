import { describe, expect, it } from "vitest";
import { toE2bMessageDate } from "./e2b";

describe("toE2bMessageDate", () => {
  it("never produces the old malformed shape (stray 'T', truncated digits)", () => {
    const out = toE2bMessageDate("2026-09-09T16:27:53.738Z");
    expect(out).not.toMatch(/T/);
    expect(out).toMatch(/^\d{14}$/);
  });

  it("produces exactly 14 pure digits: YYYYMMDDHHMMSS in UTC", () => {
    const out = toE2bMessageDate("2026-01-05T03:04:05.000Z");
    expect(out).toBe("20260105030405");
  });

  it("zero-pads every field correctly at the boundaries", () => {
    expect(toE2bMessageDate("2026-12-31T23:59:59.999Z")).toBe("20261231235959");
    expect(toE2bMessageDate("2026-01-01T00:00:00.000Z")).toBe("20260101000000");
  });
});
