import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ROLE_LABELS, useAuth, type Permission } from "@/lib/auth";

/**
 * UI-level access control. The backend must enforce the same rule on every
 * endpoint — this only prevents the surface from being rendered.
 */
export function PermissionGate({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { user, can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
        <Lock className="mx-auto size-5 text-muted-foreground" />
        <h1 className="mt-3 text-base font-semibold">Access restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The {user ? ROLE_LABELS[user.role] : "current"} role does not have the{" "}
          <code className="mono-num">{permission}</code> permission for this workspace.
        </p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
