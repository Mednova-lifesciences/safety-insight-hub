import { createFileRoute, redirect } from "@tanstack/react-router";
import { ADMIN_SIGN_IN_PATH } from "@/lib/auth-portal";

/**
 * "/admin" on its own is what someone actually types. There is no
 * administrator landing page behind it — the console is the ordinary app,
 * entered through a separate door — so this sends them to that door rather
 * than a 404.
 *
 * Redirecting in beforeLoad means it never renders anything: no flash of an
 * empty page before the navigation.
 */
export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: ADMIN_SIGN_IN_PATH, replace: true });
  },
});
