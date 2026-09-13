import { describe, expect, it } from "vitest";
import {
  ApiNotConfiguredError,
  isNotConfigured,
  isSessionLapsed,
  SESSION_LAPSED_MESSAGE,
} from "./client";

/**
 * A real user opened the app and was shown:
 *
 *   Backend request failed
 *   permission denied for table pv_psur_documents
 *
 * The `authenticated` role holds full grants on that table and `anon` holds
 * none, so that message means exactly one thing: the request arrived with no
 * live session. It is not a permissions-configuration problem, and none of
 * it is actionable by the person reading it.
 */
describe("a lapsed session is recognised, not shown as a database error", () => {
  it.each([
    "permission denied for table pv_psur_documents",
    "permission denied for table pv_linelist_jobs",
    "permission denied for relation pv_cases",
    "permission denied for schema public",
  ])("recognises %s", (message) => {
    expect(isSessionLapsed(new Error(message))).toBe(true);
  });

  it("is case-insensitive, as Postgres wording varies by version", () => {
    expect(isSessionLapsed(new Error("PERMISSION DENIED FOR TABLE pv_cases"))).toBe(true);
  });

  it("does not mistake a genuine backend fault for a lapsed session", () => {
    for (const m of [
      "Failed to fetch",
      "duplicate key value violates unique constraint",
      "column pv_cases.foo does not exist",
      "Internal Server Error",
    ]) {
      expect(isSessionLapsed(new Error(m)), m).toBe(false);
    }
  });

  it("does not fire on a not-configured backend, which has its own message", () => {
    const notConfigured = new ApiNotConfiguredError("/api/psur/documents");
    expect(isNotConfigured(notConfigured)).toBe(true);
    expect(isSessionLapsed(notConfigured)).toBe(false);
  });

  it("ignores non-Error values rather than throwing on them", () => {
    for (const v of [null, undefined, "permission denied for table x", 42, {}]) {
      expect(isSessionLapsed(v)).toBe(false);
    }
  });

  it("the message shown names no table, role or grant", () => {
    expect(SESSION_LAPSED_MESSAGE).toMatch(/sign in again/i);
    expect(SESSION_LAPSED_MESSAGE).not.toMatch(/table|permission|grant|anon|postgres|pv_/i);
  });
});
