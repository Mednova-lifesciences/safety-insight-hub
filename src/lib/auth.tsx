import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Session abstraction for MedNova PV Assist.
 *
 * This is deliberately a thin client-side abstraction over a session object.
 * When the FastAPI layer is connected, replace `signIn`/`restore` with real
 * calls (e.g. POST /api/auth/login returning a short-lived token stored in an
 * httpOnly cookie). No permission decision made here may be trusted by the
 * backend: every API handler must re-check the caller's role server-side.
 */

export type Role = "FIELD_ASSOCIATE" | "COORDINATOR" | "MANAGER";

export const ROLE_LABELS: Record<Role, string> = {
  FIELD_ASSOCIATE: "PV Field Associate",
  COORDINATOR: "PV Coordinator",
  MANAGER: "PV Manager",
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
  | "team.view";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  FIELD_ASSOCIATE: [
    "case.create",
    "case.edit",
    "case.view",
    "seriousness.review",
    "coding.review",
    "intake.manage",
  ],
  COORDINATOR: [
    "case.create",
    "case.edit",
    "case.view",
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
  MANAGER: [
    "case.view",
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
  signIn: (email: string, role: Role) => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setUser(JSON.parse(raw) as CurrentUser);
        setStatus("authenticated");
        return;
      }
    } catch {
      /* corrupt session — fall through to signed out */
    }
    setStatus("unauthenticated");
  }, []);

  const signIn = useCallback(async (email: string, role: Role) => {
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
      role,
      organisation: "MedNova Drug Safety",
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setUser(next);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const can = useCallback(
    (permission: Permission) =>
      !!user && ROLE_PERMISSIONS[user.role].includes(permission),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, status, signIn, signOut, can }),
    [user, status, signIn, signOut, can],
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
