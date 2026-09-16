import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  ADMIN_SIGN_IN_PATH,
  DEMO_CREDENTIALS,
  STAFF_ROLES,
  STAFF_SIGN_IN_PATH,
  isRoleAllowedOnPortal,
  portalForRole,
  signInPathForRole,
  wrongPortalMessage,
} from "./auth-portal";
import { ROLE_PERMISSIONS, type Role } from "./auth";

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

describe("auth-portal — administrators come in by their own door", () => {
  it("every role belongs to exactly one portal", () => {
    for (const role of ALL_ROLES) {
      const portal = portalForRole(role);
      expect(isRoleAllowedOnPortal(role, portal)).toBe(true);
      expect(isRoleAllowedOnPortal(role, portal === "admin" ? "staff" : "admin")).toBe(false);
    }
  });

  it("no assessor role is a staff role — this is the whole point of the split", () => {
    // All three of NAFDAC's assessor roles are administrators and share the
    // one administrator door. The separation asked for is staff vs
    // administrator, not one door per assessor.
    for (const role of ADMIN_ROLES) {
      expect(STAFF_ROLES).not.toContain(role);
      expect(portalForRole(role)).toBe("admin");
    }
    expect(ADMIN_ROLES).toEqual(["REVIEW_OFFICER", "EVALUATOR", "PEER_REVIEWER"]);
  });

  it("every role has a door, so nobody is left without one", () => {
    const covered = new Set<Role>([...STAFF_ROLES, ...ADMIN_ROLES]);
    for (const role of ALL_ROLES) expect(covered.has(role)).toBe(true);
  });

  it("sends each role back to the page it signed in on", () => {
    for (const role of ADMIN_ROLES) expect(signInPathForRole(role)).toBe(ADMIN_SIGN_IN_PATH);
    for (const role of STAFF_ROLES) expect(signInPathForRole(role)).toBe(STAFF_SIGN_IN_PATH);
  });

  it("tells someone at the wrong door which one they want", () => {
    for (const role of ADMIN_ROLES) expect(wrongPortalMessage(role)).toMatch(/administrator/i);
    expect(wrongPortalMessage("PV_COORDINATOR")).toMatch(/staff/i);
  });

  it("keeps a demo account for every role, including the one that moved", () => {
    for (const role of ALL_ROLES) {
      expect(DEMO_CREDENTIALS[role].email).toMatch(/@demo\./);
      expect(DEMO_CREDENTIALS[role].password).toBeTruthy();
    }
  });

  it("every administrator role keeps the processing tools", () => {
    // A previous change to admin visibility took working pages away from
    // administrators (see app-shell.tsx's note on the Processing group).
    // Splitting one admin role into three must not repeat that: line-list
    // processing and E2B(R3) preparation are not a step of the PSUR
    // assessment, so all three keep them.
    for (const role of ADMIN_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toContain("linelist.process");
      expect(ROLE_PERMISSIONS[role]).toContain("e2b.generate");
    }
  });

  it("only the two roles who review a report can open the review surface", () => {
    // The Review Officer screens; the scientific review is not their step,
    // and everything they need is on the screening page.
    expect(ROLE_PERMISSIONS.REVIEW_OFFICER).not.toContain("psur.review");
    expect(ROLE_PERMISSIONS.EVALUATOR).toContain("psur.review");
    expect(ROLE_PERMISSIONS.PEER_REVIEWER).toContain("psur.review");
  });

  it("no assessor role can perform another one's step", () => {
    // The whole reason for the split: one person must not be able to screen
    // a report, review it, and then countersign their own review.
    expect(ROLE_PERMISSIONS.REVIEW_OFFICER).toContain("psur.screen");
    expect(ROLE_PERMISSIONS.REVIEW_OFFICER).not.toContain("psur.evaluate");
    expect(ROLE_PERMISSIONS.REVIEW_OFFICER).not.toContain("psur.peer_review");

    expect(ROLE_PERMISSIONS.EVALUATOR).toContain("psur.evaluate");
    expect(ROLE_PERMISSIONS.EVALUATOR).not.toContain("psur.screen");
    expect(ROLE_PERMISSIONS.EVALUATOR).not.toContain("psur.peer_review");

    expect(ROLE_PERMISSIONS.PEER_REVIEWER).toContain("psur.peer_review");
    expect(ROLE_PERMISSIONS.PEER_REVIEWER).not.toContain("psur.screen");
    expect(ROLE_PERMISSIONS.PEER_REVIEWER).not.toContain("psur.evaluate");
  });

  it("keeps the assessor roles out of MAH-side CASE work", () => {
    // Processing tools are shared; case handling is not. A regulator has no
    // business creating or triaging an MAH's individual case reports.
    for (const role of ADMIN_ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("case.create");
      expect(ROLE_PERMISSIONS[role]).not.toContain("case.view");
      expect(ROLE_PERMISSIONS[role]).not.toContain("intake.manage");
    }
  });
});
