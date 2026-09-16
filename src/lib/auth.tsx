import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { auth as apiAuth, type AuthResponse } from "@/services/api/auth";
import { getStoredToken, setStoredToken, isApiConfigured } from "@/services/api/client";
import { supabase } from "@/integrations/supabase/client";

/**
 * Session abstraction for MedNova PV Assist.
 *
 * This layer bridges the frontend UI with the FastAPI authentication backend.
 * - When FastAPI is configured: uses real JWT tokens stored in localStorage
 * - When FastAPI is not configured: falls back to mock auth for development
 *
 * No permission decision made here may be trusted by the backend: every API
 * handler must re-check the caller's role server-side.
 */

/** Canonical role identifiers shared with public.profiles.role. */
export type Role =
  | "FIELD_ASSOCIATE"
  | "PV_COORDINATOR"
  | "PV_MANAGER"
  | "REVIEW_OFFICER"
  | "EVALUATOR"
  | "PEER_REVIEWER";

/**
 * Six visible roles in two families.
 *
 * The first three are the MAH-side PV staff. PV_MANAGER carries every
 * permission FIELD_ASSOCIATE and PV_COORDINATOR have between them, on top
 * of manager-level permissions, but is its own labelled identity.
 *
 * The last three are NAFDAC's assessors, and all three are administrators —
 * they share the administrator sign-in door (see auth-portal.ts) and are
 * kept apart from staff there. They are not three tiers of seniority but
 * three consecutive steps of one assessment: the Review Officer screens an
 * incoming report and decides whether it goes forward or back to the MAH,
 * the Evaluator performs the scientific review against the NAFDAC V4
 * template, and the Peer Reviewer checks that review and signs off. They
 * replaced a single ADMIN role that did all three jobs at once.
 */
export const ROLE_LABELS: Record<Role, string> = {
  FIELD_ASSOCIATE: "PV Field Associate",
  PV_COORDINATOR: "PV Coordinator",
  PV_MANAGER: "PV Manager",
  REVIEW_OFFICER: "Review Officer",
  EVALUATOR: "Evaluator",
  PEER_REVIEWER: "Peer Reviewer",
};

/** One line on what each role actually does, shown beside the role pickers
 *  on both sign-in pages. Lives here rather than on either page so the two
 *  doors cannot describe the same role differently. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  FIELD_ASSOCIATE: "Capture and prepare incoming safety information.",
  PV_COORDINATOR: "Process, code and validate cases; run line-list and PSUR workflows.",
  PV_MANAGER:
    "Full access — cases, processing workflows, signal decisions and complete audit oversight.",
  REVIEW_OFFICER:
    "Screen incoming periodic reports, decide whether they go forward for scientific review or back to the MAH, and issue the directive.",
  EVALUATOR: "Perform the scientific review of a periodic report against the NAFDAC template.",
  PEER_REVIEWER: "Check a completed scientific review and countersign the final sign-off.",
};

export type Permission =
  | "case.create"
  | "case.edit"
  | "case.view"
  | "case.assign"
  | "seriousness.review"
  | "coding.review"
  | "coding.approve"
  | "intake.manage"
  | "linelist.process"
  | "e2b.generate"
  // Four permissions govern the PSUR surface because three different people
  // now share it and each must be able to do strictly less than the whole.
  // The split is view-vs-edit rather than one permission per role, which is
  // what lets PermissionGate and the sidebar keep taking a single
  // Permission: everyone who may open the page holds `psur.review`, and
  // what they may CHANGE once there is governed separately.
  /** Open the PSUR review surface at all. */
  | "psur.review"
  /** Screen an incoming report: the proceed/return decision, and the
   *  directive downloads that go out to the MAH. Review Officer only. */
  | "psur.screen"
  /** Perform the scientific review — findings, Sections 9-12, and the
   *  evaluator half of the Section 13 sign-off. */
  | "psur.evaluate"
  /** Countersign Section 13 as peer reviewer. */
  | "psur.peer_review"
  | "signal.view"
  | "signal.decide"
  | "audit.view.all"
  | "team.view"
  | "follow_up.view"
  | "follow_up.create"
  | "catalog.view"
  | "catalog.manage"
  | "regulatory.manage";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  FIELD_ASSOCIATE: [
    "case.create",
    "case.edit",
    "case.view",
    "follow_up.view",
    "follow_up.create",
    "seriousness.review",
    "coding.review",
    "intake.manage",
  ],
  PV_COORDINATOR: [
    "case.create",
    "case.edit",
    "case.view",
    "follow_up.view",
    "follow_up.create",
    "case.assign",
    "seriousness.review",
    "coding.review",
    "coding.approve",
    "intake.manage",
    "linelist.process",
    "e2b.generate",
    "psur.review",
    "psur.evaluate",
    "signal.view",
    "audit.view.all",
    "team.view",
    "catalog.view",
  ],
  // Merged: PV_MANAGER now gets everything FIELD_ASSOCIATE and
  // PV_COORDINATOR have, on top of its own manager-level permissions —
  // effectively the same full set ADMIN has.
  PV_MANAGER: [
    "case.create",
    "case.edit",
    "case.view",
    "follow_up.view",
    "follow_up.create",
    "case.assign",
    "seriousness.review",
    "coding.review",
    "coding.approve",
    "intake.manage",
    "linelist.process",
    "e2b.generate",
    "psur.review",
    "psur.evaluate",
    "signal.view",
    "signal.decide",
    "audit.view.all",
    "team.view",
    "catalog.view",
    "catalog.manage",
    "regulatory.manage",
  ],
  // The three NAFDAC assessor roles below hold ONLY what their own step of
  // the assessment needs. They are narrow on purpose: the whole point of
  // splitting the old ADMIN role was that one person should not be able to
  // screen a report, review it, and countersign their own review.
  // All three run line-list processing and E2B(R3) preparation, which the
  // single ADMIN role did before the split and which none of them stopped
  // needing when it was divided up. Those are processing tools rather than
  // a step of the PSUR assessment, so they do not follow the one-step-each
  // rule the psur.* permissions do.
  REVIEW_OFFICER: [
    // Deliberately WITHOUT `psur.review`. The scientific review is not the
    // officer's step: they screen a submission on receipt and decide
    // whether it goes forward. Everything they need — the checklist, the
    // outcome, the directive — is on the screening page.
    "psur.screen",
    "linelist.process",
    "e2b.generate",
  ],
  EVALUATOR: ["psur.review", "psur.evaluate", "linelist.process", "e2b.generate"],
  PEER_REVIEWER: [
    // Reads the whole review and signs the peer half of Section 13.
    // Deliberately WITHOUT `psur.evaluate`: a peer reviewer checks the
    // evaluator's work, so being able to quietly edit it first would
    // defeat the check.
    "psur.review",
    "psur.peer_review",
    "linelist.process",
    "e2b.generate",
  ],
};

export interface CurrentUser {
  id: string;
  name: string;
  initials: string;
  email: string;
  role: Role;
  organisation: string;
  organizationId: string;
  /** Public, shareable slug — the field-associate link is `/r/<slug>`. */
  organizationSlug: string;
  /** Only ever populated immediately after CREATE_ORG signup — the private
   *  code a coordinator needs to join this same org. Never re-fetched or
   *  shown again after that first response (see the Drug Catalog / Team
   *  surface for a persisted copy once that's built). */
  organizationInviteCode?: string | undefined;
}

/**
 * Roles a person may sign THEMSELVES up as, given a valid invite code.
 *
 * The three NAFDAC assessor roles are deliberately absent, and there is no
 * registration page for them. Their accounts are provisioned by an
 * administrator who hands over initial credentials, which the person then
 * changes from Settings.
 *
 * That is a stronger boundary than a sign-up form behind an invite code. A
 * Peer Reviewer can countersign a regulatory assessment, so who holds that
 * role is a decision the organisation makes deliberately — not something a
 * person asserts about themselves by filling in a form. An invite code
 * would not be enough: it is a shared secret, and shared secrets spread.
 *
 * CREATE_ORG is likewise not a route to any of them: it always mints a
 * PV_MANAGER.
 */
export type JoinableRole = "PV_COORDINATOR" | "FIELD_ASSOCIATE";

/** Runtime mirror of JoinableRole, for the sign-up page and for the tests
 *  that pin which roles are self-service. Must match JOINABLE_ROLES in
 *  src/server/roles.py — the server holds the enforcing copy. */
export const JOINABLE_ROLES: JoinableRole[] = ["PV_COORDINATOR", "FIELD_ASSOCIATE"];

export type SignUpOptions =
  | { mode: "CREATE_ORG"; orgName: string }
  | { mode: "JOIN_ORG"; orgCode: string; role: JoinableRole };

/** The editable parts of a person's profile. */
export interface ProfileDetails {
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
}

export interface ProfileUpdateResult {
  /** True when the email was changed AND Supabase is sending a
   *  confirmation link. Until the person clicks it, their sign-in address
   *  is still the old one — the UI has to say so rather than implying the
   *  change already took effect. */
  emailConfirmationRequired: boolean;
}

interface AuthState {
  user: CurrentUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  /** Resolves with the signed-in user. The caller needs the ROLE to decide
   *  where to send them, and whether they came in through the right
   *  door — context state is not readable synchronously here. */
  signIn: (email: string, password: string, mockRole?: Role) => Promise<CurrentUser>;
  signUp: (email: string, password: string, name: string, opts: SignUpOptions) => Promise<void>;
  signOut: () => void;
  can: (permission: Permission) => boolean;
  /** Re-checks the current user's password against the real backend
   *  (Supabase Auth's own sign-in) without ending the current session —
   *  used to gate sensitive actions (revealing the invite code, changing
   *  the password itself, and every assessment decision that carries a
   *  person's name). In mock mode (no FastAPI configured, so there is no
   *  real backing account to check against) any non-empty password is
   *  accepted, matching how mock sign-in already behaves.
   *
   *  Callers that need the caller to be genuinely re-authenticated — as
   *  opposed to merely prompted — must ALSO check `isApiConfigured()`, or
   *  use requirePasswordConfirmation below, which does it for them. */
  verifyPassword: (password: string) => Promise<boolean>;
  /**
   * Re-authenticates for a named action, and THROWS rather than returning
   * false so no caller can accidentally treat a refusal as a pass.
   *
   * This is the gate behind the screening decision and both halves of the
   * Section 13 sign-off: actions that attach a person's name to a
   * regulatory record and cannot be undone. `action` is only used in the
   * error message, so a failure says which thing was refused.
   */
  requirePasswordConfirmation: (password: string, action: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
  /** Name, email and personal details in one save. Email goes through
   *  Supabase Auth as well as the profile row — it is a login credential,
   *  not just a display field. */
  updateProfile: (details: ProfileDetails) => Promise<ProfileUpdateResult>;
  /** Reads the profile columns that are not carried on the session. */
  loadProfileDetails: () => Promise<ProfileDetails>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Redirects to Google's OAuth consent screen via Supabase Auth. Requires
   *  the Google provider to be configured in the Supabase project — until
   *  then this rejects with Supabase's own "provider not enabled" error. */
  signInWithGoogle: () => Promise<void>;
  /** Sends a password-reset email via Supabase Auth. The link lands on
   *  /reset-password, which reads the recovery session Supabase attaches
   *  to that URL and lets the user set a new password. */
  sendPasswordResetEmail: (email: string) => Promise<void>;
}

const STORAGE_KEY = "mednova.pv.session";

const AuthContext = createContext<AuthState | null>(null);

function deriveName(email: string) {
  const local = email.split("@")[0] ?? "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function mapRoleFromApi(apiRole: string): Role {
  const roleMap: Record<string, Role> = {
    REVIEW_OFFICER: "REVIEW_OFFICER",
    EVALUATOR: "EVALUATOR",
    PEER_REVIEWER: "PEER_REVIEWER",
    PV_MANAGER: "PV_MANAGER",
    MANAGER: "PV_MANAGER",
    PV_COORDINATOR: "PV_COORDINATOR",
    COORDINATOR: "PV_COORDINATOR",
    FIELD_ASSOCIATE: "FIELD_ASSOCIATE",
  };
  const role = roleMap[apiRole];
  if (!role) throw new Error(`Unsupported account role: ${apiRole}`);
  return role;
}

/**
 * The FastAPI signin/signup routes proxy Supabase Auth's own token endpoint,
 * so the access/refresh tokens they return are valid Supabase session tokens.
 * Attaching them to the browser's Supabase client makes `auth.uid()` resolve
 * inside RLS policies for the direct-to-Supabase data calls used elsewhere in
 * the app. Without this, those calls run as fully anonymous requests.
 */
/**
 * Hands the backend's tokens to the Supabase client, which is what actually
 * authorises every database read: the `authenticated` role holds the table
 * grants, `anon` holds none.
 *
 * This used to swallow its own failure, so sign-in could "succeed" with no
 * Supabase session at all — the UI showed a signed-in dashboard while every
 * query went out as anon and came back "permission denied for table
 * pv_psur_documents". A half-authenticated state is worse than a failed
 * sign-in, because the person cannot tell anything is wrong. It now throws,
 * and signIn surfaces it.
 */
async function syncSupabaseSession(authResponse: AuthResponse): Promise<void> {
  if (!authResponse.access_token || !authResponse.refresh_token) {
    throw new Error(
      "Sign-in did not return the tokens needed to read your data. Please try again.",
    );
  }
  const { error } = await supabase.auth.setSession({
    access_token: authResponse.access_token,
    refresh_token: authResponse.refresh_token,
  });
  if (error) {
    console.error("Failed to sync Supabase session:", error);
    throw new Error(
      "Signed in, but your data session could not be established. Please try signing in again.",
    );
  }
}

/** Is there a live Supabase session — the thing that actually authorises
 *  reads? Answers false rather than throwing when Supabase is unreachable
 *  or unconfigured, so callers treat "cannot tell" as "not authorised". */
async function hasLiveSupabaseSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session?.access_token;
  } catch {
    return false;
  }
}

function buildCurrentUser(authResponse: AuthResponse): CurrentUser {
  const email = authResponse.user.email;
  const name = authResponse.user.user_metadata?.name || deriveName(email);
  const role = mapRoleFromApi(authResponse.profile.role);
  const organisation = authResponse.organization?.name || "MedNova Drug Safety";

  return {
    id: authResponse.user.id,
    name,
    initials:
      name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "PV",
    email,
    role,
    organisation,
    organizationId: authResponse.organization?.id ?? authResponse.profile.organization_id,
    organizationSlug: authResponse.organization?.slug ?? "",
    organizationInviteCode: authResponse.organization?.invite_code,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  // On mount, restore session from stored token if available
  useEffect(() => {
    const restoreSession = async () => {
      try {
        if (isApiConfigured()) {
          // Try to restore from stored JWT token
          const token = getStoredToken();
          if (token) {
            const profile = await apiAuth.getCurrentUser();
            if (profile) {
              const storedUserJson = window.localStorage.getItem(STORAGE_KEY);
              // The backend recognised the token, but reads are authorised
              // by Supabase — both must hold, or the session is only half
              // restored and every query fails as anon.
              const supabaseLive = await hasLiveSupabaseSession();
              if (storedUserJson && supabaseLive) {
                const storedUser = JSON.parse(storedUserJson) as CurrentUser;
                setUser({
                  ...storedUser,
                  id: profile.user_id,
                  email: profile.email,
                  role: mapRoleFromApi(profile.role),
                });
                setStatus("authenticated");
                return;
              }
            }
          }
        } else {
          // API not configured - try mock auth
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            setUser(JSON.parse(raw) as CurrentUser);
            setStatus("authenticated");
            return;
          }
        }
        // Deliberately NO localStorage fallback when the API is configured.
        //
        // This fallback used to run unconditionally, so a stale
        // mednova.pv.session blob was enough to mark the app
        // "authenticated" with no Supabase session behind it. Every read
        // then went out as anon and Postgres answered "permission denied
        // for table pv_psur_documents" — a real user was shown a signed-in
        // dashboard that could not load anything. The blob is a UI
        // convenience; Supabase holds the authorisation, and only it can
        // answer whether this person may read data.
        //
        // It remains correct for mock mode, which is handled in the branch
        // above and never mints a Supabase session to begin with.
      } catch (error) {
        console.error("Failed to restore session:", error);
        // Clear invalid token
        setStoredToken(null);
      }
      setStatus("unauthenticated");
    };

    restoreSession();
  }, []);

  const signIn = useCallback(async (email: string, password: string, mockRole?: Role) => {
    if (isApiConfigured()) {
      // Use real backend authentication
      const response = await apiAuth.signin({ email, password });
      await syncSupabaseSession(response);
      const currentUser = buildCurrentUser(response);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      setUser(currentUser);
      setStatus("authenticated");
      return currentUser;
    } else {
      // Mock authentication (dev mode without backend)
      const name = deriveName(email);
      const next: CurrentUser = {
        id: `usr_${email.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`,
        name,
        initials:
          name
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "PV",
        email,
        role: mockRole || "PV_COORDINATOR",
        organisation: "MedNova Drug Safety",
        organizationId: "mock-org",
        organizationSlug: "mednova-demo",
        organizationInviteCode: "MOCK-0000",
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setUser(next);
      setStatus("authenticated");
      return next;
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, opts: SignUpOptions) => {
      if (isApiConfigured()) {
        // Use real backend authentication
        const response = await apiAuth.signup({
          email,
          password,
          name,
          mode: opts.mode,
          ...(opts.mode === "CREATE_ORG"
            ? { organization_name: opts.orgName }
            : { org_code: opts.orgCode, role: opts.role }),
        });
        await syncSupabaseSession(response);
        const currentUser = buildCurrentUser(response);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        setUser(currentUser);
        setStatus("authenticated");
      } else {
        // Mock authentication (dev mode without backend)
        const n = deriveName(email);
        const orgName = opts.mode === "CREATE_ORG" ? opts.orgName : "MedNova Drug Safety";
        const next: CurrentUser = {
          id: `usr_${email.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`,
          name: n,
          initials:
            n
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase() || "PV",
          email,
          role: opts.mode === "CREATE_ORG" ? "PV_MANAGER" : opts.role,
          organisation: orgName,
          organizationId: "mock-org",
          organizationSlug: "mednova-demo",
          organizationInviteCode: opts.mode === "CREATE_ORG" ? "MOCK-0000" : undefined,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setUser(next);
        setStatus("authenticated");
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    // Clear the local session FIRST so the UI is immediately
    // unauthenticated — the network cleanup below can be slow or fail
    // (e.g. backend not running), and the signed-out state must never
    // depend on it.
    window.localStorage.removeItem(STORAGE_KEY);
    setStoredToken(null);
    setUser(null);
    setStatus("unauthenticated");
    try {
      if (isApiConfigured()) {
        await apiAuth.signout();
      }
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => !!user && ROLE_PERMISSIONS[user.role].includes(permission),
    [user],
  );

  const verifyPassword = useCallback(
    async (password: string) => {
      if (!user) return false;
      if (!isApiConfigured()) return password.length > 0;
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
      return !error;
    },
    [user],
  );

  const updateName = useCallback(
    async (name: string) => {
      if (!user) throw new Error("Not signed in");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name cannot be empty");
      if (isApiConfigured()) {
        const { error } = await supabase
          .from("profiles")
          .update({ full_name: trimmed })
          .eq("id", user.id);
        if (error) throw new Error(error.message);
      }
      const initials =
        trimmed
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || "PV";
      const next: CurrentUser = { ...user, name: trimmed, initials };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setUser(next);
    },
    [user],
  );

  const requirePasswordConfirmation = useCallback(
    async (password: string, action: string) => {
      if (!user) throw new Error("Not signed in");
      if (!password) throw new Error("Enter your password to confirm.");
      const ok = await verifyPassword(password);
      if (!ok) throw new Error(`That password is not correct, so ${action} was not recorded.`);
    },
    [user, verifyPassword],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!user) throw new Error("Not signed in");
      // This used to `return` here, so in mock mode the caller's
      // `toast.success("Password updated.")` fired having changed nothing.
      // Telling someone their password changed when it did not is worse
      // than refusing: they will believe the old one no longer works.
      // Mock mode has no backing account, so the honest answer is that the
      // operation is unavailable.
      if (!isApiConfigured()) {
        throw new Error(
          "Passwords cannot be changed in demo mode — no backend is connected to change them on.",
        );
      }
      const ok = await verifyPassword(currentPassword);
      if (!ok) throw new Error("Current password is incorrect");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
    },
    [user, verifyPassword],
  );

  const loadProfileDetails = useCallback(async (): Promise<ProfileDetails> => {
    if (!user) throw new Error("Not signed in");
    const fallback: ProfileDetails = {
      name: user.name,
      email: user.email,
      phone: "",
      jobTitle: "",
    };
    if (!isApiConfigured()) return fallback;
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, email, phone, job_title")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fallback;
    return {
      name: (data.full_name as string | null) ?? user.name,
      email: (data.email as string | null) ?? user.email,
      phone: (data.phone as string | null) ?? "",
      jobTitle: (data.job_title as string | null) ?? "",
    };
  }, [user]);

  const updateProfile = useCallback(
    async (details: ProfileDetails): Promise<ProfileUpdateResult> => {
      if (!user) throw new Error("Not signed in");
      const name = details.name.trim();
      const email = details.email.trim();
      const phone = details.phone.trim();
      const jobTitle = details.jobTitle.trim();

      if (!name) throw new Error("Name cannot be empty");
      if (!email) throw new Error("Email cannot be empty");

      const emailChanged = email.toLowerCase() !== user.email.toLowerCase();
      let emailConfirmationRequired = false;

      if (isApiConfigured()) {
        // Email is a sign-in credential, so it changes in Supabase Auth,
        // not just in the profile row. Supabase emails a confirmation link
        // and does NOT switch the login address until it is clicked, so
        // this is done FIRST: if it fails, nothing else has been written
        // and the profile does not end up claiming an address the person
        // cannot actually sign in with.
        if (emailChanged) {
          const { error } = await supabase.auth.updateUser({ email });
          if (error) throw new Error(error.message);
          emailConfirmationRequired = true;
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            full_name: name,
            phone: phone || null,
            job_title: jobTitle || null,
            // Deliberately NOT writing `email` here when it changed: the
            // profile row must keep matching the address that actually
            // signs in until the new one is confirmed.
            ...(emailChanged ? {} : { email }),
          })
          .eq("id", user.id);
        if (error) throw new Error(error.message);
      }

      const initials =
        name
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || "PV";
      // The session keeps the OLD email while a change is pending, for the
      // same reason the profile row does.
      const next: CurrentUser = { ...user, name, initials };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setUser(next);
      return { emailConfirmationRequired };
    },
    [user],
  );

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) throw new Error(error.message);
  }, []);

  const sendPasswordResetEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(error.message);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      signIn,
      signUp,
      signOut,
      can,
      verifyPassword,
      requirePasswordConfirmation,
      updateName,
      updateProfile,
      loadProfileDetails,
      changePassword,
      signInWithGoogle,
      sendPasswordResetEmail,
    }),
    [
      user,
      status,
      signIn,
      signUp,
      signOut,
      can,
      verifyPassword,
      requirePasswordConfirmation,
      updateName,
      updateProfile,
      loadProfileDetails,
      changePassword,
      signInWithGoogle,
      sendPasswordResetEmail,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useCurrentUser(): CurrentUser | null {
  return useAuth().user;
}

export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}

export function usePermission(permission: Permission): boolean {
  return useAuth().can(permission);
}
