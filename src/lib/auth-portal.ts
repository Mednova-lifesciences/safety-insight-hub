import type { Role } from "./auth";

/**
 * Which door a person comes in through.
 *
 * Administrators were asked to be kept separate from staff, so there are
 * two sign-in pages rather than one page with an "Administrator" option.
 * All three NAFDAC assessor roles are administrators and share the ONE
 * administrator page — the separation asked for is between staff and
 * administrators, not between the three assessors, who work on the same
 * reports in sequence and have no reason to sign in at different URLs.
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

/** The roles each sign-in page is for. The assessor roles are deliberately
 *  absent from the staff list — that is the whole point of the split. */
export const STAFF_ROLES: Role[] = ["FIELD_ASSOCIATE", "PV_COORDINATOR", "PV_MANAGER"];
export const ADMIN_ROLES: Role[] = ["REVIEW_OFFICER", "EVALUATOR", "PEER_REVIEWER"];

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
 * There is deliberately no per-role landing path. Signing in through a
 * different door does not mean arriving somewhere different: every role,
 * administrators included, starts on the dashboard. An earlier version of
 * this sent administrators to Settings, which was not what was wanted —
 * the separation asked for is of the sign-in, not of where the day starts.
 */

/** What to tell someone who signed in at the wrong door. Names the page
 *  they want rather than only refusing, because "wrong page" with no
 *  onward route is a dead end. */
export function wrongPortalMessage(role: Role): string {
  return portalForRole(role) === "admin"
    ? "That is an administrator account. Administrators sign in on the administrator page."
    : "That is a staff account. Please sign in on the staff sign-in page.";
}

/** Human-readable list of who the administrator page is for, so the page
 *  itself never has to hardcode the three role names. */
export const ADMIN_PORTAL_ROLE_SUMMARY = "Review Officers, Evaluators and Peer Reviewers";

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
  // Deliberately admin@ rather than officer@: this is the original seeded
  // administrator account, migrated to REVIEW_OFFICER by migration 022. A
  // second officer@ account would mean two Review Officers and a stale one
  // left behind, so the name stays historical and the account stays single.
  REVIEW_OFFICER: { email: "admin@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  EVALUATOR: { email: "evaluator@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  PEER_REVIEWER: { email: "peer@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
};
