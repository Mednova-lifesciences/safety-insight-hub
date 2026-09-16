import { describe, expect, it } from "vitest";
import { NAV } from "./app-shell";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth";

/**
 * The sidebar has hidden the Processing pages from the wrong people twice,
 * in opposite directions:
 *
 *  1. `hiddenForRoles: ["PV_MANAGER", "PV_COORDINATOR"]` — the two roles
 *     that hold linelist.process / e2b.generate / psur.review. The pages
 *     were reachable only by typing the URL.
 *  2. Then `hiddenForRoles: ["ADMIN"]`, copied from the case-handling
 *     groups without checking who actually runs processing. Every
 *     line-list job in the live database had been uploaded by an admin.
 *
 * Note what is NOT asserted here: "every entitled role can see every item".
 * Operations and Oversight deliberately hide the administrator roles from
 * items whose permissions they do not hold anyway — an administrator has a
 * different workspace, and that is a product decision, not a bug. The
 * invariant below is the weaker, genuinely universal one that both
 * mistakes broke.
 */

const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

const navItems = NAV.flatMap((group) =>
  group.items.map((item) => ({ group: group.label, ...item })),
);

type VisibilityShape = {
  label: string;
  permission?: (typeof navItems)[number]["permission"];
  hiddenForRoles?: Role[] | undefined;
};

function canSee(role: Role, item: VisibilityShape): boolean {
  const permitted = !item.permission || ROLE_PERMISSIONS[role].includes(item.permission);
  return permitted && !item.hiddenForRoles?.includes(role);
}

function entitledRoles(permission: string | undefined): Role[] {
  if (!permission) return ROLES;
  return ROLES.filter((r) => (ROLE_PERMISSIONS[r] as string[]).includes(permission));
}

describe("no page is left unreachable from the sidebar", () => {
  it.each(navItems)("$group → $label is visible to at least one role", (item) => {
    // A page hidden from every role that may open it is dead: live route,
    // live permission, no way in but a typed URL. That is exactly what
    // happened to all three Processing pages.
    const reachable = ROLES.filter((r) => canSee(r, item));
    expect(reachable.length, `${item.label} is in the nav but no role can see it`).toBeGreaterThan(
      0,
    );
  });

  it("every permissioned item is held by at least one role", () => {
    for (const item of navItems.filter((i) => i.permission)) {
      expect(
        entitledRoles(item.permission).length,
        `${item.label} requires ${item.permission}, which no role grants`,
      ).toBeGreaterThan(0);
    }
  });

  it("a role without the permission never sees the item", () => {
    for (const item of navItems.filter((i) => i.permission)) {
      for (const role of ROLES) {
        if (!(ROLE_PERMISSIONS[role] as string[]).includes(item.permission!)) {
          expect(canSee(role, item), `${item.label} leaked to ${role}`).toBe(false);
        }
      }
    }
  });
});

describe("the Processing pages", () => {
  const processing = NAV.find((g) => g.label === "Processing");

  it("still carries every workflow", () => {
    expect(processing).toBeDefined();
    expect(processing!.items.map((i) => i.to).sort()).toEqual([
      "/e2b",
      "/line-list",
      "/psur",
      "/screening",
    ]);
  });

  it("hides nobody — the permission alone governs", () => {
    // Processing is not role-shaped the way case handling is: anyone
    // granted these permissions is expected to use these pages. A
    // restriction, if one is ever wanted, belongs in ROLE_PERMISSIONS where
    // PermissionGate enforces it on the route too — not in a nav flag that
    // leaves the page live but invisible.
    for (const item of processing!.items) {
      expect(
        item.hiddenForRoles,
        `${item.label} reintroduced a nav-level role filter`,
      ).toBeUndefined();
    }
  });

  it("is visible to every role that can actually open the routes", () => {
    for (const item of processing!.items) {
      for (const role of entitledRoles(item.permission)) {
        expect(canSee(role, item), `${item.label} hidden from ${role}`).toBe(true);
      }
    }
  });

  it("reaches each assessor role for the step that role actually performs", () => {
    // The single ADMIN role this replaced held every processing permission,
    // so the old version of this test could assert that every Processing
    // item was visible to it. That is deliberately no longer true: the
    // three roles that replaced it each do one step and hold one subset.
    // Pinning who sees what is the point — an evaluator reaching the
    // officer's screening queue would be the bug.
    const seen = (role: Role) =>
      processing!.items
        .filter((i) => canSee(role, i))
        .map((i) => i.to)
        .sort();

    // The officer screens and runs the processing tools, but the scientific
    // review is not their step. The other two review, and keep the tools.
    expect(seen("REVIEW_OFFICER")).toEqual(["/e2b", "/line-list", "/screening"]);
    expect(seen("EVALUATOR")).toEqual(["/e2b", "/line-list", "/psur"]);
    expect(seen("PEER_REVIEWER")).toEqual(["/e2b", "/line-list", "/psur"]);
  });
});
