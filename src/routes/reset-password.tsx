import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/pv/primitives";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Reset password — MedNova PV Assist" }],
  }),
  component: ResetPasswordPage,
});

/**
 * Landing page for the link Supabase Auth emails from
 * resetPasswordForEmail() (see src/lib/auth.tsx sendPasswordResetEmail).
 * The link itself carries a recovery token that supabase-js picks up
 * automatically (detectSessionInUrl, on by default) and turns into a real,
 * if short-lived, session — checked here rather than trusted blindly, so
 * an expired or already-used link shows an explicit error instead of a
 * broken form.
 */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setValidLink(!!data.session);
        setChecking(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setValidLink(true);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const valid = password.length >= 6 && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // The recovery session is single-purpose — sign out of it and send
      // them through the app's normal sign-in flow, which is what
      // actually establishes the app-level session (see auth.tsx).
      await supabase.auth.signOut();
      toast.success("Password updated. Sign in with your new password.");
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <span className="text-sm font-semibold">MedNova PV Assist</span>
        </div>

        {checking ? (
          <LoadingState label="Checking your link" />
        ) : !validLink ? (
          <div className="space-y-3">
            <h1 className="text-lg font-semibold">This link isn't valid</h1>
            <p className="text-sm text-muted-foreground">
              It may have expired or already been used. Request a new reset link from the sign-in
              page.
            </p>
            <Link to="/auth" className="text-sm text-primary underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Set a new password</h1>
            <form className="mt-4 space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                {confirm.length > 0 && confirm !== password ? (
                  <p className="text-xs text-destructive">Passwords don't match.</p>
                ) : null}
              </div>
              <Button type="submit" className="w-full" disabled={!valid || submitting}>
                <KeyRound className="size-4" /> {submitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
