import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("@/services/api/client", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

const { meddra29Provider } = await import("./coding-provider");

beforeEach(() => apiRequest.mockReset());

describe("MedDRA look-ups made together", () => {
  it("send one request for a term many rows share, however many ask at once", async () => {
    apiRequest.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return {
        source_value: "Crying",
        status: "MAPPED",
        term: { code: "10011469", term: "Crying", preferred_term: "Crying" },
      };
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => meddra29Provider.resolveReaction("Crying")),
    );
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === "MAPPED" && r.code === "10011469")).toBe(true);
  });

  it("remember a preferred term by code, but ask again after a failed request", async () => {
    apiRequest.mockRejectedValueOnce(new Error("offline"));
    expect(await meddra29Provider.resolvePreferredTerm!("10000001")).toBeNull();
    apiRequest.mockResolvedValue({
      status: "MAPPED",
      term: { code: "10000002", preferred_term: "Pyrexia" },
    });
    expect(await meddra29Provider.resolvePreferredTerm!("10000001")).toEqual({
      preferredTerm: "Pyrexia",
      code: "10000002",
    });
    await meddra29Provider.resolvePreferredTerm!("10000001");
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
