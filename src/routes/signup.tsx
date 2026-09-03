import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Copy, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { useAuth, useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Sign up — MedNova PV Assist" }],
  }),
  component: SignupPage,
});

type SignupMode = "CREATE_ORG" | "JOIN_ORG";

function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<SignupMode>("CREATE_ORG");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreatedOrg, setJustCreatedOrg] = useState(false);

  const user = useCurrentUser();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signUp(
        email.trim(),
        password,
        name.trim(),
        mode === "CREATE_ORG" ? { mode, orgName: orgName.trim() } : { mode, orgCode: orgCode.trim() },
      );
      if (mode === "CREATE_ORG") {
        setJustCreatedOrg(true);
      } else {
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (justCreatedOrg && user) {
    const fieldAssociateLink =
      typeof window !== "undefined" ? `${window.location.origin}/r/${user.organizationSlug}` : "";
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <ShieldCheck className="mx-auto size-8 text-primary" />
            <h1 className="mt-3 text-lg font-semibold">{user.organisation} is set up</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Save these — you'll need them to bring your team on and let field associates report.
            </p>
          </div>

          <div className="space-y-3 rounded-md border border-border p-4">
            <div>
              <p className="label-caps">Coordinator invite code</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {user.organizationInviteCode}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(user.organizationInviteCode ?? "");
                    toast.success("Code copied.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Coordinators enter this on the sign-up page to join your organization.
              </p>
            </div>
            <div>
              <p className="label-caps">Field associate link</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {fieldAssociateLink}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(fieldAssociateLink);
                    toast.success("Link copied.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                No account needed — field associates use this to report cases directly.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-dashed border-border p-4">
            <p className="text-sm font-medium">Populate your drug catalog?</p>
            <p className="text-xs text-muted-foreground">
              Field associates pick from this list when reporting. Add drugs now, or skip and
              explore with the seeded demo data first.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => navigate({ to: "/drugs" })}>
                Set up drug catalog now
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
                Skip for now
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <span className="text-sm font-semibold">MedNova PV Assist</span>
        </div>

        <h1 className="text-lg font-semibold">Create your account</h1>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("CREATE_ORG")}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-center transition-colors",
              mode === "CREATE_ORG" ? "border-primary bg-accent" : "border-border hover:bg-muted",
            )}
          >
            <Building2 className="size-4" />
            <span className="text-xs font-medium">Start a new organization</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("JOIN_ORG")}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-center transition-colors",
              mode === "JOIN_ORG" ? "border-primary bg-accent" : "border-border hover:bg-muted",
            )}
          >
            <KeyRound className="size-4" />
            <span className="text-xs font-medium">Join with a code</span>
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
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
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === "CREATE_ORG" ? (
            <div className="space-y-1.5">
              <Label htmlFor="orgName">Company name</Label>
              <Input
                id="orgName"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                You'll be this organization's PV Manager and get a code for your coordinators.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="orgCode">Organization code</Label>
              <Input
                id="orgCode"
                required
                placeholder="e.g. MEDN-7X2K"
                value={orgCode}
                onChange={(e) => setOrgCode(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Get this from your PV manager. You'll join as a PV Coordinator.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            <UserPlus className="size-4" /> {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" className="underline">
            Sign in
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
