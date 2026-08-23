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
export type Role = "FIELD_ASSOCIATE" | "PV_COORDINATOR" | "PV_MANAGER" | "ADMIN";

/**
 * Four distinct, visible roles. PV_MANAGER carries every permission
 * FIELD_ASSOCIATE/PV_COORDINATOR/PV_MANAGER previously had between them,
 * on top of manager-level permissions — the same full set ADMIN has (see
 * ROLE_PERMISSIONS below) — but is its own labelled identity, not an
 * alias for Administrator.
 */
export const ROLE_LABELS: Record<Role, string> = {
  FIELD_ASSOCIATE: "PV Field Associate",
  PV_COORDINATOR: "PV Coordinator",
  PV_MANAGER: "PV Manager",
  ADMIN: "Administrator",
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
  | "psur.review"
  | "signal.view"
  | "signal.decide"
  | "audit.view.all"
  | "team.view"
  | "follow_up.view"
  | "follow_up.create";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
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
    "signal.view",
    "audit.view.all",
    "team.view",
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
    "signal.view",
    "signal.decide",
    "audit.view.all",
    "team.view",
  ],
  ADMIN: [
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
    "signal.view",
    "signal.decide",
    "audit.view.all",
    "team.view",
  ],
};

export interface CurrentUser {
  id: string;
  name: string;
  initials: string;
  email: string;
  role: Role;
  organisation: string;
}

interface AuthState {
  user: CurrentUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  signIn: (email: string, password: string, mockRole?: Role) => Promise<void>;
  signUp: (email: string, password: string, name: string, org?: string) => Promise<void>;
  signOut: () => void;
  can: (permission: Permission) => boolean;
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
    ADMIN: "ADMIN",
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
async function syncSupabaseSession(authResponse: AuthResponse): Promise<void> {
  if (!authResponse.access_token || !authResponse.refresh_token) return;
  try {
    await supabase.auth.setSession({
      access_token: authResponse.access_token,
      refresh_token: authResponse.refresh_token,
    });
  } catch (error) {
    console.error("Failed to sync Supabase session:", error);
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
              if (storedUserJson) {
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
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setUser(next);
      setStatus("authenticated");
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, org?: string) => {
      if (isApiConfigured()) {
        // Use real backend authentication
        const response = await apiAuth.signup({
          email,
          password,
          name,
          ...(org ? { organization_name: org } : {}),
        });
        await syncSupabaseSession(response);
        const currentUser = buildCurrentUser(response);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        setUser(currentUser);
        setStatus("authenticated");
      } else {
        // Mock authentication (dev mode without backend)
        const n = deriveName(email);
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
          role: "ADMIN",
          organisation: org || "MedNova Drug Safety",
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setUser(next);
        setStatus("authenticated");
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      if (isApiConfigured()) {
        await apiAuth.signout();
      }
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    } finally {
      window.localStorage.removeItem(STORAGE_KEY);
      setStoredToken(null);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => !!user && ROLE_PERMISSIONS[user.role].includes(permission),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, status, signIn, signUp, signOut, can }),
    [user, status, signIn, signUp, signOut, can],
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
