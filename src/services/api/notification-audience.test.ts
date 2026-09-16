import { describe, expect, it } from "vitest";
import { isForRole } from "./notifications";
import type { Notification, Role } from "@/types/pv";

function note(audience?: Role[]): Notification {
  return {
    id: "n1",
    type: "PSUR_AWAITING_PEER_REVIEW",
    title: "t",
    body: "b",
    at: "2026-09-16T00:00:00Z",
    read: false,
    ...(audience ? { audience } : {}),
  };
}

describe("who a notification is for", () => {
  it("one with no audience still reaches everyone", () => {
    // Every notification behaved this way before audiences existed, and the
    // case-handling ones still do. Adding the field must not silently mute
    // the notifications that predate it.
    for (const r of ["FIELD_ASSOCIATE", "PV_MANAGER", "PEER_REVIEWER"] as Role[]) {
      expect(isForRole(note(), r)).toBe(true);
    }
    expect(isForRole(note(), null)).toBe(true);
  });

  it("an empty audience is treated as everyone, not as nobody", () => {
    // An empty list is far more likely to be a caller's mistake than a
    // deliberate "tell no one", and a notification nobody receives is
    // indistinguishable from one that was never sent.
    expect(isForRole(note([]), "EVALUATOR")).toBe(true);
  });

  it("an addressed one reaches only its audience", () => {
    const n = note(["PEER_REVIEWER"]);
    expect(isForRole(n, "PEER_REVIEWER")).toBe(true);
    expect(isForRole(n, "EVALUATOR")).toBe(false);
    expect(isForRole(n, "REVIEW_OFFICER")).toBe(false);
    expect(isForRole(n, "PV_MANAGER")).toBe(false);
  });

  it("reaches every role it names", () => {
    const n = note(["EVALUATOR", "PEER_REVIEWER"]);
    expect(isForRole(n, "EVALUATOR")).toBe(true);
    expect(isForRole(n, "PEER_REVIEWER")).toBe(true);
    expect(isForRole(n, "REVIEW_OFFICER")).toBe(false);
  });

  it("an addressed one reaches nobody who has no role", () => {
    expect(isForRole(note(["EVALUATOR"]), null)).toBe(false);
  });
});
