import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { isApiConfigured } from "@/services/api/client";

/**
 * A warning, then the person's own password, before an irreversible
 * assessment decision is written.
 *
 * Three actions use this: the Review Officer sending a report forward or
 * back to the MAH, the Evaluator signing off and handing the report to peer
 * review, and the Peer Reviewer countersigning. All three attach a named
 * person to a regulatory record that another organisation acts on, and none
 * of them can be taken back afterwards. Re-entering the password is what
 * makes the signature mean "this person decided", rather than "this
 * browser was open".
 *
 * It is a card rather than a modal because the thing being confirmed is on
 * the page behind it — the officer needs the completeness check and the
 * evaluator needs their own conclusion still in view while deciding.
 *
 * SECURITY NOTE: in demo mode (no backend configured) there is no account
 * to check a password against, so verifyPassword accepts anything
 * non-empty. This component says so out loud rather than implying a
 * verification that did not happen. The real enforcement is server-side.
 */
export function ConfirmWithPassword({
  /** What is about to happen, in the person's own terms. */
  title,
  /** The consequence they should understand before typing a password. */
  warning,
  /** Text for the button that performs the action. */
  confirmLabel,
  /** Names the action inside error messages, e.g. "the screening decision". */
  actionName,
  /** Extra content between the warning and the password field. */
  children,
  /** Blocks confirmation entirely, with this reason shown. Used for "you
   *  cannot submit without signing off". */
  blockedReason,
  destructive,
  onConfirmed,
  onCancel,
}: {
  title: string;
  warning: string;
  confirmLabel: string;
  actionName: string;
  children?: ReactNode;
  blockedReason?: string | undefined;
  destructive?: boolean;
  onConfirmed: () => Promise<void>;
  onCancel: () => void;
}) {
  const { requirePasswordConfirmation } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = !!blockedReason;

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      // Verify FIRST, and let a bad password throw before anything is
      // written. requirePasswordConfirmation throws rather than returning
      // false precisely so this cannot fall through to onConfirmed.
      await requirePasswordConfirmation(password, actionName);
      await onConfirmed();
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not record ${actionName}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`space-y-3 rounded-md border p-4 ${
        destructive ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning-soft"
      }`}
    >
      <div className="flex gap-3">
        <AlertTriangle
          className={`mt-0.5 size-4 shrink-0 ${destructive ? "text-destructive" : "text-warning"}`}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{warning}</p>
        </div>
      </div>

      {children}

      {blocked ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {blockedReason}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`confirm-password-${actionName.replace(/\s+/g, "-")}`}>
            Confirm with your password
          </Label>
          <Input
            id={`confirm-password-${actionName.replace(/\s+/g, "-")}`}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password && !submitting) void confirm();
            }}
          />
          {!isApiConfigured() ? (
            <p className="text-xs text-muted-foreground">
              Demo mode — no backend is connected, so this password is not actually checked.
            </p>
          ) : null}
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={destructive ? "destructive" : "default"}
          disabled={blocked || submitting || password.length === 0}
          onClick={() => void confirm()}
        >
          {submitting ? "Recording…" : confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
