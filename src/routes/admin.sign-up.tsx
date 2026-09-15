import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardCheck, FileText, ShieldCheck, Stamp, UserPlus } from "lucide-react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ADMIN_ROLES, ADMIN_SIGN_IN_PATH } from "@/lib/auth-portal";

/**
 * Registration for NAFDAC's three assessor roles.
 *
 * Deliberately a separate page from /signup rather than three more options
 * on it. /signup is where an MAH sets up its own organisation; this is where
 * a regulator's staff join an organisation that already exists. Mixing them
 * would put "Peer Reviewer" in a dropdown on a public company-registration
 * form, which is precisely the wrong framing for a role that can
 * countersign a regulatory assessment.
 *
 * The invite code is REQUIRED and is the actual security boundary. Picking a
 * role here is a statement of which job you do, not a grant of authority —
 * the authority comes from holding the organisation's private code, the
 * same gate coordinators and field associates already pass through. The
 * server re-validates both (see JOINABLE_ROLES in src/server/roles.py) and
 * never trusts what this page sends.
 *
 * "noindex" for the same reason the administrator sign-in page carries it.
 */
export const Route = createFileRoute("/admin/sign-up")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Administrator registration — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Register as a Review Officer, Evaluator or Peer Reviewer using your organisation's invite code.",
      },
      { property: "og:title", content: "Administrator registration — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Register as a Review Officer, Evaluator or Peer Reviewer.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminSignUpPage,
});

/** One card per assessor role, in the order a report passes through them. */
const ROLE_CARDS: { role: Role; icon: typeof ClipboardCheck; step: string }[] = [
  { role: "REVIEW_OFFICER", icon: ClipboardCheck, step: "Step 1" },
  { role: "EVALUATOR", icon: FileText, step: "Step 2" },
  { role: "PEER_REVIEWER", icon: Stamp, step: "Step 3" },
];

function AdminSignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  // Null until a role is chosen: the form does not exist yet, because
  // "which of these three jobs do you do" is the question that decides what
  // the rest of the page is for.
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    setError(null);
    setSubmitting(true);
    try {
      await signUp(email.trim(), password, name.trim(), {
        mode: "JOIN_ORG",
        orgCode: orgCode.trim(),
        // Narrowed by the guard above plus ROLE_CARDS, which only ever
        // holds the three assessor roles.
        role: role as "REVIEW_OFFICER" | "EVALUATOR" | "PEER_REVIEWER",
      });
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

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

        <h1 className="mt-8 text-2xl font-semibold">Administrator registration</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {role
            ? "Enter your details and your organisation's invite code."
            : "Which part of the assessment do you carry out? Pick the one that matches your post."}
        </p>

        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {ROLE_CARDS.map(({ role: r, icon: Icon, step }) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-md border p-3 text-left transition-colors",
                role === r ? "border-primary bg-accent" : "border-border hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-primary" />
                <span className="text-[0.6rem] tracking-[0.14em] text-muted-foreground">
                  {step.toUpperCase()}
                </span>
              </div>
              <span className="text-sm font-medium">{ROLE_LABELS[r]}</span>
              <span className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
            </button>
          ))}
        </div>

        {role ? (
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <div className="rounded-md border border-dashed border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Registering as{" "}
                <span className="font-medium text-foreground">{ROLE_LABELS[role]}</span>.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setRole(null)}
                  disabled={submitting}
                >
                  Change
                </button>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-signup-name">Full name</Label>
              <Input
                id="admin-signup-name"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This is the name that appears on the assessments you sign.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-signup-email">Work email</Label>
              <Input
                id="admin-signup-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-signup-password">Password</Label>
              <Input
                id="admin-signup-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                You will re-enter this to confirm every screening decision and sign-off, so pick
                something you can type quickly but nobody can guess.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-signup-code">Organisation invite code</Label>
              <Input
                id="admin-signup-code"
                required
                placeholder="Paste the code your administrator shared"
                value={orgCode}
                onChange={(e) => setOrgCode(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Required. Registration is not open — the code is what confirms you belong to this
                organisation.
              </p>
            </div>

            {error ? (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              <UserPlus className="size-4" />{" "}
              {submitting ? "Creating account…" : `Create ${ROLE_LABELS[role]} account`}
            </Button>
          </form>
        ) : null}

        <p className="mt-6 text-xs text-muted-foreground">
          Already registered?{" "}
          <Link to={ADMIN_SIGN_IN_PATH} className="underline">
            Sign in
          </Link>
          . Staff roles register on the{" "}
          <Link to="/signup" className="underline">
            main sign-up page
          </Link>
          .
        </p>

        {/* Keeps this page honest if the role list ever changes: it renders
            one card per assessor role, so a role added to ADMIN_ROLES without
            a card here would be silently unregisterable. */}
        {ROLE_CARDS.length !== ADMIN_ROLES.length ? (
          <p className="mt-2 text-xs text-destructive">
            Some administrator roles have no registration option on this page.
          </p>
        ) : null}
      </div>
    </div>
  );
}
