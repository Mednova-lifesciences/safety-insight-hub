import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardPlus, ShieldCheck, UserCog, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "MedNova PV Assist" },
      {
        name: "description",
        content:
          "Pharmacovigilance operations for your organization. Staff sign in; field associates report through your company's own link.",
      },
      { property: "og:title", content: "MedNova PV Assist" },
      {
        property: "og:description",
        content: "ICSR intake, triage, coding assistance and signal review — organized per company.",
      },
      // Overrides the root's default `noindex` — this is the one page
      // meant to be publicly discoverable. Every authenticated page
      // (dashboard, cases, audit, …) and every per-org field-associate
      // link (/r/:orgSlug) stays noindex: nothing behind login should be
      // indexed, and a company's own drug catalog isn't public information.
      { name: "robots", content: "index, follow" },
    ],
    // `scripts` (unlike the component body below, which is client-rendered
    // — this route sets ssr:false) is assembled server-side regardless, so
    // this JSON-LD is actually present in the HTML a crawler fetches.
    // Facts only: no fabricated ratings, pricing, or org details not
    // already stated in this app's own meta tags above.
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "MedNova PV Assist",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description:
            "Pharmacovigilance operations platform for ICSR triage, MedDRA/WHODrug coding, line-list processing, E2B(R3) preparation, PSUR/PBRER review and signal management.",
          url: "https://pv-assist.mednovalife.com",
        }),
      },
    ],
  }),
  component: HomePage,
});

/**
 * Public landing page. There is no company-agnostic ICSR form here any
 * more — every anonymous submission now belongs to a specific company via
 * its own `/r/:orgSlug` link (see the Drug Catalog page for that link, or
 * the post-signup screen). This page only routes staff to sign-in/sign-up.
 */
function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card/95 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">MedNova</p>
            <p className="text-[11px] tracking-wide text-muted-foreground">PV ASSIST</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <ShieldCheck className="size-10 text-primary" />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">
          Pharmacovigilance operations, organized per company
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Each organization gets its own drug catalog and a public reporting link for field
          associates — no account needed on their end. Staff sign in below.
        </p>

        <div className="mt-8 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link to="/auth">
              <UserRound className="size-4" /> Sign in
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/signup">
              <UserCog className="size-4" /> Set up your organization
            </Link>
          </Button>
        </div>

        <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ClipboardPlus className="size-3.5" /> Field associate? Use the reporting link your PV
          manager shared with you.
        </p>
      </main>
    </div>
  );
}
