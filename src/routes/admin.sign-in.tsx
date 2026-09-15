import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isApiConfigured } from "@/services/api/client";
import {
  ADMIN_ROLES,
  DEMO_CREDENTIALS,
  STAFF_SIGN_IN_PATH,
  isRoleAllowedOnPortal,
  wrongPortalMessage,
} from "@/lib/auth-portal";

/**
 * The administrator door.
 *
 * Administrators used to be a fourth radio button on the staff sign-in
 * page. They are kept separate now at the customer's request.
 *
 * This page once had no role picker, because there was exactly one role it
 * admitted. There are now three — Review Officer, Evaluator and Peer
 * Reviewer — and they all belong here, so the picker is back. It matters
 * ONLY in demo mode, where there is no server to say who signed in; with a
 * backend connected the account's own role decides and the selection is
 * ignored. That is why it is labelled as demo-only, exactly as the staff
 * page labels its own.
 *
 * "noindex" because this is an internal console entrance; the staff page
 * stays indexable as before.
 */
export const Route = createFileRoute("/admin/sign-in")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Administrator sign-in — MedNova PV Assist" },
      {
        name: "description",
        content: "Administrator access to organisation, access and regulatory configuration.",
      },
      { property: "og:title", content: "Administrator sign-in — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Administrator access to organisation, access and regulatory configuration.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminSignInPage,
});

/** Defaults to the first step of the assessment, which is the one a demo
 *  most often wants to start from. */
const DEFAULT_ADMIN_ROLE: Role = "REVIEW_OFFICER";

function AdminSignInPage() {
  const { signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>(DEFAULT_ADMIN_ROLE);
  const [email, setEmail] = useState(DEMO_CREDENTIALS[DEFAULT_ADMIN_ROLE].email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS[DEFAULT_ADMIN_ROLE].password);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-6 py-12">
      <div className="w-full max-w-xl rounded-xl border border-border bg-background p-8 shadow-sm sm:p-10">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-6 text-primary" />
          <div className="leading-tight">
            <p className="text-base font-semibold">MedNova</p>
            <p className="text-[0.65rem] tracking-[0.18em] text-muted-foreground">PV ASSIST</p>
          </div>
        </div>

        <h1 className="mt-8 text-2xl font-semibold">Administrator sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          For Review Officers, Evaluators and Peer Reviewers. Staff sign in on the{" "}
          <Link to={STAFF_SIGN_IN_PATH} className="underline">
            main sign-in page
          </Link>
          .
        </p>

        <form
          className="mt-8 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setSubmitting(true);
            try {
              if (!password) {
                setError("Enter your password.");
                setSubmitting(false);
                return;
              }
              // In demo mode the role comes from the caller — whichever of
              // the three was picked above. With a backend connected the
              // server decides, and the check below is what actually holds.
              const signedIn = isApiConfigured()
                ? await signIn(email.trim(), password)
                : await signIn(email.trim(), password, role);

              if (!isRoleAllowedOnPortal(signedIn.role, "admin")) {
                // A staff account is dropped rather than admitted here, for
                // the same reason an administrator is turned away from the
                // staff page: a session that exists on a page saying you
                // are in the wrong place is worse than no session.
                await signOut();
                setError(wrongPortalMessage(signedIn.role));
                setSubmitting(false);
                return;
              }
              navigate({ to: "/dashboard", replace: true });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Sign in failed");
              setSubmitting(false);
            }
          }}
        >
          <fieldset className="space-y-2">
            <legend className="label-caps mb-1">Administrator role</legend>
            <p className="mb-2 text-xs text-muted-foreground">
              (Only used in demo mode; the server determines the actual role when a backend is
              connected)
            </p>
            {ADMIN_ROLES.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                  role === r ? "border-primary bg-accent" : "border-border hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="admin-role"
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
            <Label htmlFor="admin-email">Administrator email</Label>
            <Input
              id="admin-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            <Lock className="size-4" /> Sign in
          </Button>
        </form>

        <div className="mt-6 rounded-md border border-dashed border-border p-4">
          <p className="label-caps">Demo {ROLE_LABELS[role].toLowerCase()}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{DEMO_CREDENTIALS[role].email}</span> /{" "}
            {DEMO_CREDENTIALS[role].password}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Prefilled above so nothing has to be typed during a demo.
          </p>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          No account yet?{" "}
          <Link to="/admin/sign-up" className="underline">
            Register as a Review Officer, Evaluator or Peer Reviewer
          </Link>
          . You will need your organisation&rsquo;s invite code.
        </p>

        <p className="mt-2 text-xs text-muted-foreground">
          {isApiConfigured()
            ? "Backend connected."
            : "Backend not connected — screens will show pending-integration states or the seeded demo dataset."}
        </p>
      </div>
    </div>
  );
}
