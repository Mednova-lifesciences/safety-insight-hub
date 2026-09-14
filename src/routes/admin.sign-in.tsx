import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isApiConfigured } from "@/services/api/client";
import {
  DEMO_CREDENTIALS,
  STAFF_SIGN_IN_PATH,
  isRoleAllowedOnPortal,
  wrongPortalMessage,
} from "@/lib/auth-portal";

/**
 * The administrator door.
 *
 * Administrators used to be a fourth radio button on the staff sign-in
 * page. They are kept separate now at the customer's request. This page
 * deliberately has no role picker at all — there is exactly one role it
 * admits, so offering a choice would only invite the wrong one.
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
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminSignInPage,
});

function AdminSignInPage() {
  const { signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO_CREDENTIALS.ADMIN.email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS.ADMIN.password);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-6 py-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">MedNova</p>
            <p className="text-[0.65rem] tracking-[0.18em] text-muted-foreground">PV ASSIST</p>
          </div>
        </div>

        <h1 className="mt-6 text-lg font-semibold">Administrator sign-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For organisation, access and regulatory configuration. Staff sign in on the{" "}
          <Link to={STAFF_SIGN_IN_PATH} className="underline">
            main sign-in page
          </Link>
          .
        </p>

        <form
          className="mt-6 space-y-5"
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
              // In demo mode the role comes from the caller, and this page
              // only ever asks for the administrator one. With a backend
              // connected the server decides, and the check below is what
              // actually holds.
              const signedIn = isApiConfigured()
                ? await signIn(email.trim(), password)
                : await signIn(email.trim(), password, "ADMIN");

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

        <div className="mt-4 rounded-md border border-dashed border-border p-3">
          <p className="label-caps">Demo administrator</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{DEMO_CREDENTIALS.ADMIN.email}</span> /{" "}
            {DEMO_CREDENTIALS.ADMIN.password}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Prefilled above so nothing has to be typed during a demo.
          </p>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          {isApiConfigured()
            ? "Backend connected."
            : "Backend not connected — screens will show pending-integration states or the seeded demo dataset."}
        </p>
      </div>
    </div>
  );
}
