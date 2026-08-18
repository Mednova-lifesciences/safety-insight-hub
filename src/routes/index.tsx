import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, Lock } from "lucide-react";
import { ROLE_LABELS, useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isApiConfigured } from "@/services/api/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Secure sign-in to MedNova PV Assist, the human-in-the-loop pharmacovigilance operations platform.",
      },
      { property: "og:title", content: "Sign in — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Role-based access to ICSR triage, coding assistance, line-list processing and signal review.",
      },
    ],
  }),
  component: SignInPage,
});

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  FIELD_ASSOCIATE: "Capture and prepare incoming safety information.",
  COORDINATOR: "Process, code and validate cases; run line-list and PSUR workflows.",
  MANAGER: "Oversight, signal decisions and audit review.",
};

function SignInPage() {
  const { user, status, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("a.okafor@mednova.example");
  const [password, setPassword] = useState("demo123");
  const [role, setRole] = useState<Role>("FIELD_ASSOCIATE");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" && user) navigate({ to: "/dashboard", replace: true });
  }, [status, user, navigate]);

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

          <h2 className="text-lg font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Access is role-based. Permissions are re-checked server-side on every request.
          </p>

          <form
            className="mt-6 space-y-5"
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
              {!isApiConfigured() && (
                <p className="text-xs text-muted-foreground">
                  Demo login: <span className="font-medium text-foreground">a.okafor@mednova.example</span> / any password
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="label-caps mb-1">Demo Role</legend>
              <p className="text-xs text-muted-foreground mb-2">
                (Only used in demo mode; server determines actual role when backend is connected)
              </p>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
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
                    onChange={() => setRole(r)}
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

            <Button type="submit" className="w-full" disabled={submitting}>
              <Lock className="size-4" /> Sign in
            </Button>
          </form>

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
