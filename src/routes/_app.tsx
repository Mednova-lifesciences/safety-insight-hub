import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/pv/app-shell";
import { useAuth } from "@/lib/auth";
import { LoadingState } from "@/components/pv/primitives";

/**
 * Protected application layout.
 *
 * Session state lives client-side, so this gate runs after hydration
 * (`ssr: false`). It protects the UI only — the FastAPI layer must enforce
 * authentication and role checks on every endpoint independently.
 */
export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "unauthenticated") navigate({ to: "/", replace: true });
  }, [status, navigate]);

  if (status !== "authenticated") {
    return (
      <div className="p-8">
        <LoadingState label="Restoring session" />
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
