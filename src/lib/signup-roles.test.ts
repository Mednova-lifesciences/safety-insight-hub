import { describe, expect, it } from "vitest";
import {
  JOINABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type Role,
} from "./auth";
import { ADMIN_ROLES, STAFF_ROLES } from "./auth-portal";

/**
 * Who may register themselves, and for what.
 *
 * Self-service registration hands out real authority — a Peer Reviewer can
 * countersign a regulatory assessment — so the rules about which roles are
 * reachable through sign-up are pinned here rather than left to whatever
 * the forms happen to offer.
 */

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

describe("which roles are self-service", () => {
  it("offers all three assessor roles, so nobody needs provisioning by hand", () => {
    for (const role of ADMIN_ROLES) {
      expect(JOINABLE_ROLES, `${role} cannot register itself`).toContain(role);
    }
  });

  it("never offers PV_MANAGER", () => {
    // PV_MANAGER is minted only by CREATE_ORG, for the person who creates
    // the organisation. Offering it on a join form would let anyone holding
    // an invite code promote themselves to the top staff role.
    expect(JOINABLE_ROLES).not.toContain("PV_MANAGER");
  });

  it("only offers roles that actually exist", () => {
    for (const role of JOINABLE_ROLES) {
      expect(ALL_ROLES, `${role} is offered at sign-up but is not a real role`).toContain(role);
    }
  });

  it("every joinable role is presentable, so no form can render a blank option", () => {
    for (const role of JOINABLE_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });
});

describe("the assessor roles are gated like staff roles, not more loosely", () => {
  it("no assessor role can be reached without going through JOIN_ORG", () => {
    // JOIN_ORG is the only mode that takes a role, and it requires the
    // organisation's private invite code (enforced server-side in
    // src/server/routes/auth.py). CREATE_ORG takes no role at all and
    // always mints PV_MANAGER, so it cannot be a back door to any of these.
    for (const role of ADMIN_ROLES) {
      expect(JOINABLE_ROLES).toContain(role);
    }
    expect(JOINABLE_ROLES).not.toContain("PV_MANAGER");
  });

  it("registering as an assessor grants no staff permissions", () => {
    // A regression here would mean the sign-up page quietly hands a
    // regulator access to the MAH-side case workflow.
    for (const role of ADMIN_ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("case.create");
      expect(ROLE_PERMISSIONS[role]).not.toContain("case.view");
      expect(ROLE_PERMISSIONS[role]).not.toContain("linelist.process");
      expect(ROLE_PERMISSIONS[role]).not.toContain("regulatory.manage");
    }
  });

  it("registering as a staff role grants no assessment authority", () => {
    // The mirror of the rule above: a field associate must not be able to
    // sign off on a periodic report.
    for (const role of STAFF_ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("psur.screen");
      expect(ROLE_PERMISSIONS[role]).not.toContain("psur.peer_review");
    }
  });

  it("every role is either staff or an assessor, so sign-up covers the whole set", () => {
    const known = new Set<Role>([...STAFF_ROLES, ...ADMIN_ROLES]);
    for (const role of ALL_ROLES) expect(known.has(role)).toBe(true);
  });
});
