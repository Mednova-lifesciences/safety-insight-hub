import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
    getStoredToken: () => "token",
  };
});

const { ApiError } = await import("./client");
const { auth: apiAuth } = await import("./auth");

const profile = { user_id: "u1", email: "a@b.c", role: "REVIEW_OFFICER" };

describe("restoring a session on page load", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiRequest.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("retries a temporary server error instead of signing the person out", async () => {
    apiRequest
      .mockRejectedValueOnce(new ApiError(503, "GET /api/auth/me failed (503)"))
      .mockResolvedValueOnce(profile);
    const result = apiAuth.getCurrentUser();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(profile);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("signs out straight away when the token is really rejected", async () => {
    apiRequest.mockRejectedValue(new ApiError(401, "GET /api/auth/me failed (401)"));
    await expect(apiAuth.getCurrentUser()).resolves.toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("reports the server as unreachable, not as signed out, if it stays down", async () => {
    apiRequest.mockRejectedValue(new ApiError(503, "GET /api/auth/me failed (503)"));
    const result = apiAuth.getCurrentUser();
    const settled = result.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await settled).toBeInstanceOf(ApiError);
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });
});
