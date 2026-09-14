import type { Role } from "./auth";

/**
 * Which door a person comes in through.
 *
 * Administrators were asked to be kept separate from staff, so there are
 * two sign-in pages rather than one page with an "Administrator" option.
 * Everything about which page suits which role lives here, in one place,
 * because the answer is needed by both sign-in pages AND by sign-out (a
 * person signing out belongs back at the door they came in by, not at
 * whichever one the code happened to hardcode).
 *
 * This is a UI routing concern and nothing more. It is NOT a security
 * boundary: an administrator who reaches the staff page and signs in is
 * still a genuine administrator, and the FastAPI layer enforces every
 * actual permission on its own. What this prevents is the confusing
 * outcome, not a privileged one.
 */
export type Portal = "staff" | "admin";

export const STAFF_SIGN_IN_PATH = "/auth";
export const ADMIN_SIGN_IN_PATH = "/admin/sign-in";

/** The roles each sign-in page is for. ADMIN is deliberately absent from
 *  the staff list — that is the whole point of the split. */
export const STAFF_ROLES: Role[] = ["FIELD_ASSOCIATE", "PV_COORDINATOR", "PV_MANAGER"];
export const ADMIN_ROLES: Role[] = ["ADMIN"];

export function portalForRole(role: Role): Portal {
  return ADMIN_ROLES.includes(role) ? "admin" : "staff";
}

export function signInPathForRole(role: Role): string {
  return portalForRole(role) === "admin" ? ADMIN_SIGN_IN_PATH : STAFF_SIGN_IN_PATH;
}

export function isRoleAllowedOnPortal(role: Role, portal: Portal): boolean {
  return portalForRole(role) === portal;
}

/**
 * Where a role lands after signing in.
 *
 * Administrators go to Settings, not the operations dashboard: access,
 * organisation and regulatory configuration are what the separate console
 * was asked for. Their navigation is unchanged — an administrator still
 * runs line-list and PSUR work, and every line-list job in the live
 * database was in fact uploaded by one — so this changes where they START,
 * never what they may reach.
 */
export function landingPathForRole(role: Role): string {
  return portalForRole(role) === "admin" ? "/settings" : "/dashboard";
}

/** What to tell someone who signed in at the wrong door. Names the page
 *  they want rather than only refusing, because "wrong page" with no
 *  onward route is a dead end. */
export function wrongPortalMessage(role: Role): string {
  return portalForRole(role) === "admin"
    ? "That is an administrator account. Administrators sign in on the administrator page."
    : "That is a staff account. Please sign in on the staff sign-in page.";
}

/**
 * Prefilled demo accounts, kept here rather than on either page so the two
 * sign-in screens cannot drift apart. Retained at the customer's request so
 * nobody has to type credentials during demos; these are seeded demo
 * accounts on a demo organisation, not real ones.
 */
export const DEMO_PASSWORD = "demo123";

export const DEMO_CREDENTIALS: Record<Role, { email: string; password: string }> = {
  FIELD_ASSOCIATE: { email: "field@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  PV_COORDINATOR: { email: "coordinator@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  PV_MANAGER: { email: "manager@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  ADMIN: { email: "admin@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
};
