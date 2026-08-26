import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, UserCog, UserRound } from "lucide-react";
import { IcsrIntakeForm } from "@/components/pv/icsr-intake-form";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ICSR Intake — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Capture an individual case safety report — no account required. Staff can sign in as Coordinator or Manager.",
      },
      { property: "og:title", content: "ICSR Intake — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Structured ICSR intake with validation, triage and coding hand-off.",
      },
    ],
  }),
  component: HomePage,
});

/**
 * Public landing page. The field-associate ICSR intake form is the first
 * thing every visitor sees — no login. The header offers staff sign-in
 * (Coordinator / Manager) which routes to the auth page.
 */
function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">MedNova</p>
            <p className="text-[11px] tracking-wide text-muted-foreground">PV ASSIST</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/auth" search={{ role: "PV_COORDINATOR" }}>
              <UserRound className="size-4" /> Sign in as Coordinator
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/auth" search={{ role: "PV_MANAGER" }}>
              <UserCog className="size-4" /> Sign in as Manager
            </Link>
          </Button>
        </div>
      </header>

      <IcsrIntakeForm />

      <footer className="border-t border-border px-6 py-4 text-xs text-muted-foreground">
        Field associates capture reports here without signing in. Coordinator and Manager access is
        role-based; permissions are re-checked server-side on every request.
      </footer>
    </div>
  );
}
