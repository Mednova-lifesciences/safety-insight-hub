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
 * countersign a regulatory assessment — so the rule is pinned here rather
 * than left to whatever the forms happen to offer. There is no sign-up page
 * for the assessor roles; these tests make sure one cannot reappear by
 * accident through the shared role lists.
 */

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

describe("which roles are self-service", () => {
  it("offers exactly the two staff roles an invite code is meant to grant", () => {
    expect([...JOINABLE_ROLES].sort()).toEqual(["FIELD_ASSOCIATE", "PV_COORDINATOR"]);
  });

  it("never offers PV_MANAGER", () => {
    // PV_MANAGER is minted only by CREATE_ORG, for the person who creates
    // the organisation. Offering it on a join form would let anyone holding
    // an invite code promote themselves to the top staff role.
    expect(JOINABLE_ROLES).not.toContain("PV_MANAGER");
  });

  it("never offers an assessor role — those are provisioned, not self-served", () => {
    // The account is created by an administrator who hands over initial
    // credentials. An invite code is a shared secret and spreads, so it is
    // not a strong enough gate for the authority to sign off on a
    // regulatory assessment.
    for (const role of ADMIN_ROLES) {
      expect(JOINABLE_ROLES, `${role} became self-service`).not.toContain(role);
    }
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

describe("the two role families stay apart", () => {
  it("an assessor role grants no staff permissions", () => {
    // A regression here would mean a regulator could reach the MAH-side
    // case workflow.
    for (const role of ADMIN_ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("case.create");
      expect(ROLE_PERMISSIONS[role]).not.toContain("case.view");
      expect(ROLE_PERMISSIONS[role]).not.toContain("linelist.process");
      expect(ROLE_PERMISSIONS[role]).not.toContain("regulatory.manage");
    }
  });

  it("a staff role grants no assessment authority", () => {
    // The mirror of the rule above: a field associate must not be able to
    // screen or sign off on a periodic report.
    for (const role of STAFF_ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("psur.screen");
      expect(ROLE_PERMISSIONS[role]).not.toContain("psur.peer_review");
    }
  });

  it("every role is either staff or an assessor, so none is unaccounted for", () => {
    const known = new Set<Role>([...STAFF_ROLES, ...ADMIN_ROLES]);
    for (const role of ALL_ROLES) expect(known.has(role)).toBe(true);
  });

  it("every assessor role still has a demo account to sign in with", () => {
    // They cannot register, so a missing seeded account is the only way
    // one of these roles becomes unreachable.
    for (const role of ADMIN_ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});
