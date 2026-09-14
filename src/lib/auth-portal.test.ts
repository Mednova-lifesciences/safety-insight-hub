import { describe, expect, it } from "vitest";
import {
  ADMIN_SIGN_IN_PATH,
  DEMO_CREDENTIALS,
  STAFF_ROLES,
  STAFF_SIGN_IN_PATH,
  isRoleAllowedOnPortal,
  landingPathForRole,
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

  it("ADMIN is not a staff role — this is the whole point of the split", () => {
    expect(STAFF_ROLES).not.toContain("ADMIN");
    expect(portalForRole("ADMIN")).toBe("admin");
  });

  it("every non-admin role is a staff role, so nobody is left without a door", () => {
    const covered = new Set<Role>([...STAFF_ROLES, "ADMIN"]);
    for (const role of ALL_ROLES) expect(covered.has(role)).toBe(true);
  });

  it("sends each role back to the page it signed in on", () => {
    expect(signInPathForRole("ADMIN")).toBe(ADMIN_SIGN_IN_PATH);
    for (const role of STAFF_ROLES) expect(signInPathForRole(role)).toBe(STAFF_SIGN_IN_PATH);
  });

  it("administrators land on settings, staff on the dashboard", () => {
    expect(landingPathForRole("ADMIN")).toBe("/settings");
    for (const role of STAFF_ROLES) expect(landingPathForRole(role)).toBe("/dashboard");
  });

  it("tells someone at the wrong door which one they want", () => {
    expect(wrongPortalMessage("ADMIN")).toMatch(/administrator/i);
    expect(wrongPortalMessage("PV_COORDINATOR")).toMatch(/staff/i);
  });

  it("keeps a demo account for every role, including the one that moved", () => {
    for (const role of ALL_ROLES) {
      expect(DEMO_CREDENTIALS[role].email).toMatch(/@demo\./);
      expect(DEMO_CREDENTIALS[role].password).toBeTruthy();
    }
  });

  it("the separation is about routing, not privilege — ADMIN keeps its permissions", () => {
    // A previous change to admin visibility took working pages away from
    // administrators (see app-shell.tsx's note on the Processing group).
    // Splitting the sign-in must not repeat that.
    expect(ROLE_PERMISSIONS.ADMIN).toContain("linelist.process");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("psur.review");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("e2b.generate");
  });
});
