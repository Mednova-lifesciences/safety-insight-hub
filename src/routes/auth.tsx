import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Lock, LogIn, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isApiConfigured } from "@/services/api/client";

type AuthSearch = { role?: Role };

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => {
    const role = search["role"];
    return role === "PV_COORDINATOR" || role === "PV_MANAGER" || role === "ADMIN"
      ? { role }
      : {};
  },
  head: () => ({
    meta: [
      { title: "Sign in — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Secure sign-in to MedNova PV Assist. Field associates enter without an account; coordinators and managers sign in.",
      },
      { property: "og:title", content: "Sign in — MedNova PV Assist" },
      {
        property: "og:description",
        content:
          "Role-based access to ICSR triage, coding assistance, line-list processing and signal review.",
      },
    ],
  }),
  component: AuthPage,
});

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  FIELD_ASSOCIATE: "Capture and prepare incoming safety information.",
  PV_COORDINATOR: "Process, code and validate cases; run line-list and PSUR workflows.",
  PV_MANAGER:
    "Full access — cases, processing workflows, signal decisions and complete audit oversight.",
  ADMIN: "Manage access, operations and the complete audit surface.",
};

/** Roles that still sign in with credentials. Field associates don't. */
const SIGN_IN_ROLES: Role[] = ["PV_COORDINATOR", "PV_MANAGER", "ADMIN"];

const DEMO_PASSWORD = "demo123";
const DEMO_CREDENTIALS: Record<Role, { email: string; password: string }> = {
  FIELD_ASSOCIATE: { email: "field@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  PV_COORDINATOR: { email: "coordinator@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  PV_MANAGER: { email: "manager@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
  ADMIN: { email: "admin@demo.safetyinsighthub.com", password: DEMO_PASSWORD },
};

function AuthPage() {
  const { role: requestedRole } = Route.useSearch();
  const { signIn, signInFieldAssociate } = useAuth();
  const navigate = useNavigate();
  const initialRole: Role =
    requestedRole && SIGN_IN_ROLES.includes(requestedRole) ? requestedRole : "PV_COORDINATOR";
  const [email, setEmail] = useState(DEMO_CREDENTIALS[initialRole].email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS[initialRole].password);
  const [role, setRole] = useState<Role>(initialRole);
  const [submitting, setSubmitting] = useState(false);
  const [enteringAsFieldAssociate, setEnteringAsFieldAssociate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deliberately no "already authenticated → /dashboard" redirect here:
  // staff must be able to open this page while signed in (e.g. a field
  // associate switching to a coordinator account) without being bounced
  // back. Both sign-in paths below navigate on success themselves.

  async function enterAsFieldAssociate() {
    setError(null);
    setEnteringAsFieldAssociate(true);
    try {
      await signInFieldAssociate();
      navigate({ to: "/dashboard", replace: true });
    } finally {
      setEnteringAsFieldAssociate(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-6 text-sidebar-primary" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-sidebar-accent-foreground">MedNova</p>
            <p className="text-xs tracking-[0.18em] text-sidebar-foreground/70">PV ASSIST</p>
          </div>
        </div>

        <div className="max-w-lg">
          <h1 className="text-3xl leading-tight font-semibold text-sidebar-accent-foreground">
            Pharmacovigilance operations with a human in the loop.
          </h1>
          <p className="mt-4 text-sm text-sidebar-foreground/80">
            ICSR seriousness triage, MedDRA and WHODrug coding assistance, line-list cleaning with
            E2B(R3) preparation, and PSUR/PBRER review support — all executed by the validated
            Python engines behind the API, never by the interface.
          </p>
          <dl className="mt-8 grid gap-3 text-sm">
            {[
              ["AI assists", "Suggestions are labelled and never applied silently."],
              ["Rules validate", "Deterministic validation runs server-side."],
              ["Humans decide", "Every safety decision requires an explicit action."],
              ["Everything is auditable", "Each regulated action writes an audit event."],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-40 shrink-0 font-medium text-sidebar-accent-foreground">{k}</dt>
                <dd className="text-sidebar-foreground/75">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-xs text-sidebar-foreground/60">
          This system prepares regulatory content. It does not transmit reports to authorities.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              <span className="text-sm font-semibold">MedNova PV Assist</span>
            </div>
          </div>

          <h2 className="text-lg font-semibold">Choose your access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Field associates enter directly. Coordinator and manager access is signed in and
            role-based.
          </p>

          <button
            type="button"
            onClick={enterAsFieldAssociate}
            disabled={enteringAsFieldAssociate}
            className={cn(
              "group mt-6 flex w-full cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 text-left transition-colors",
              "border-primary bg-accent hover:bg-primary/10",
            )}
          >
            <LogIn className="mt-0.5 size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{ROLE_LABELS.FIELD_ASSOCIATE}</span>
              <span className="block text-xs text-muted-foreground">
                {ROLE_DESCRIPTIONS.FIELD_ASSOCIATE}
              </span>
              <span className="mt-1 block text-xs font-medium text-primary">
                No account needed — click to enter
              </span>
            </span>
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
          </button>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs tracking-wide text-muted-foreground">STAFF SIGN-IN</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setSubmitting(true);
              try {
                if (isApiConfigured()) {
                  // Real authentication with backend
                  await signIn(email.trim(), password);
                } else {
                  // Mock authentication (dev mode)
                  // In mock mode, still require a non-empty password field
                  if (!password) {
                    setError("Enter a password (any value works in demo mode)");
                    setSubmitting(false);
                    return;
                  }
                  // Use the selected role in mock mode
                  await signIn(email.trim(), password, role);
                }
                navigate({ to: "/dashboard", replace: true });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Sign in failed");
                setSubmitting(false);
              }
            }}
          >
            <fieldset className="space-y-2">
              <legend className="label-caps mb-1">Staff role</legend>
              <p className="mb-2 text-xs text-muted-foreground">
                (Only used in demo mode; server determines actual role when backend is connected)
              </p>
              {SIGN_IN_ROLES.map((r) => (
                <label
                  key={r}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                    role === r ? "border-primary bg-accent" : "border-border hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    className="mt-1 accent-[var(--primary)]"
                    checked={role === r}
                    onChange={() => {
                      setRole(r);
                      setEmail(DEMO_CREDENTIALS[r].email);
                      setPassword(DEMO_CREDENTIALS[r].password);
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium">{ROLE_LABELS[r]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ROLE_DESCRIPTIONS[r]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Credential verification is performed by the backend identity service once connected.
              </p>
              {!isApiConfigured() &&
                (role === "PV_COORDINATOR" || role === "PV_MANAGER" || role === "ADMIN") && (
                  <p className="text-xs text-muted-foreground">
                    Demo login:{" "}
                    <span className="font-medium text-foreground">
                      {DEMO_CREDENTIALS[role].email}
                    </span>{" "}
                    / {DEMO_CREDENTIALS[role].password}
                  </p>
                )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              <Lock className="size-4" /> Sign in
            </Button>
          </form>

          <p className="mt-4 text-xs text-muted-foreground">
            New organization?{" "}
            <Link to="/signup" className="underline">
              Sign up
            </Link>
            .
          </p>

          <p className="mt-6 text-xs text-muted-foreground">
            {isApiConfigured()
              ? "Backend connected."
              : "Backend not connected — screens will show pending-integration states or the seeded demo dataset."}
          </p>
        </div>
      </section>
    </div>
  );
}
