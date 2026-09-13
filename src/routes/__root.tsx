import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import mednovaLogo from "../index.png?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { DataSourceProvider } from "@/lib/data-source";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const SITE_URL = "https://pv-assist.mednovalife.com";
const SITE_NAME = "MedNova PV Assist";
const SITE_TITLE = "MedNova PV Assist — Pharmacovigilance Operations Platform";
const SITE_DESCRIPTION =
  "Human-in-the-loop pharmacovigilance operations platform for ICSR triage, MedDRA/WHODrug coding, line-list processing, E2B(R3) preparation, PSUR/PBRER review and signal management.";
const SOCIAL_IMAGE = new URL(mednovaLogo, SITE_URL).toString();

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "theme-color", content: "#17588f" },
      { name: "robots", content: "noindex" },

      // Open Graph — controls how the link unfurls when shared (Slack, email, LinkedIn, etc.)
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:url", content: SITE_URL },
      { property: "og:locale", content: "en_US" },
      { property: "og:image", content: SOCIAL_IMAGE },
      { property: "og:image:width", content: "815" },
      { property: "og:image:height", content: "306" },
      { property: "og:image:alt", content: "MedNova Lifesciences" },

      // Twitter/X card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: SOCIAL_IMAGE },
      { name: "twitter:image:alt", content: "MedNova Lifesciences" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: mednovaLogo, type: "image/png" },
      { rel: "apple-touch-icon", href: mednovaLogo },
      { rel: "canonical", href: SITE_URL },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/** Styles for the pre-hydration fallback above. Inline and self-contained:
 *  the app stylesheet is a separate request that can itself stall, and a
 *  fallback that depends on it would be invisible in exactly the situation
 *  it exists for. Hidden for the first 600ms so a fast load never flashes. */
const BOOT_FALLBACK_CSS = `
#app-boot-fallback{position:fixed;inset:0;display:flex;align-items:center;
justify-content:center;background:#fff;z-index:9999;opacity:0;
animation:boot-in .3s ease-out .6s forwards;
font-family:"IBM Plex Sans",system-ui,-apple-system,sans-serif}
#app-boot-fallback .boot-inner{text-align:center}
#app-boot-fallback img{margin:0 auto 12px;display:block}
#app-boot-fallback .boot-title{margin:0;font-size:15px;font-weight:600;color:#0f172a}
#app-boot-fallback .boot-sub{margin:6px 0 0;font-size:13px;color:#64748b}
@keyframes boot-in{to{opacity:1}}
@media (prefers-color-scheme:dark){
#app-boot-fallback{background:#0b1120}
#app-boot-fallback .boot-title{color:#e2e8f0}
#app-boot-fallback .boot-sub{color:#94a3b8}}
`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {/*
          First-paint floor.

          Every route in this app sets ssr:false, so the server sends a body
          with zero visible content and nothing appears until the JS bundle
          has downloaded, parsed and executed. On a warm cache that gap is
          imperceptible; on a cold one the site is indistinguishable from
          broken — a real user on mobile Chrome saw pure white, waited, came
          back several minutes later and found it working.

          This markup ships inside the same ~5 KB HTML document that already
          has to arrive, so if the browser receives anything at all, it shows
          branding instead of a white screen. It is deliberately inline (no
          extra request to stall on) and is removed by RootComponent the
          moment React mounts.

          The 600ms delay before it becomes visible means a normal fast load
          never flashes it — it only appears when there is genuinely a wait
          worth explaining.
        */}
        <div id="app-boot-fallback" aria-hidden="true">
          <style>{BOOT_FALLBACK_CSS}</style>
          <div className="boot-inner">
            <img src={mednovaLogo} alt="" width="40" height="40" />
            <p className="boot-title">MedNova PV Assist</p>
            <p className="boot-sub">Loading…</p>
          </div>
        </div>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // React is mounted, so the fallback has served its purpose. Removed from
  // the DOM rather than hidden, so it can never intercept a click or be
  // read out by a screen reader once the real UI is up.
  useEffect(() => {
    document.getElementById("app-boot-fallback")?.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DataSourceProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-right" />
        </DataSourceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
