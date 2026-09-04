import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Eye, KeyRound, User } from "lucide-react";
import { ROLE_LABELS, useAuth, useCurrentUser } from "@/lib/auth";
import { getMyOrganizationInviteCode, deleteMyOrganization } from "@/services/api/organizations";
import { isApiConfigured } from "@/services/api/client";
import { PageHeader, Section } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [{ title: "Settings — MedNova PV Assist" }],
  }),
  component: SettingsPage,
});

const DELETE_CONFIRMATION_PHRASE = "delete my project";

function ProfileSection() {
  const user = useCurrentUser();
  const { updateName } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  return (
    <Section title="Profile" description="Your name and account details.">
      <div className="max-w-sm space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="settings-name">Full name</Label>
          <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Work email</Label>
          <Input value={user.email} disabled />
          <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Input value={ROLE_LABELS[user.role]} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>Organization</Label>
          <Input value={user.organisation} disabled />
        </div>
        <Button
          size="sm"
          disabled={saving || name.trim() === user.name || name.trim().length === 0}
          onClick={async () => {
            setSaving(true);
            try {
              await updateName(name);
              toast.success("Name updated.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not update your name.");
            } finally {
              setSaving(false);
            }
          }}
        >
          <User className="size-4" /> Save name
        </Button>
      </div>
    </Section>
  );
}

function ChangePasswordSection() {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const valid = current.length > 0 && next.length >= 6 && next === confirm;

  return (
    <Section title="Change password" description="You'll need your current password to confirm.">
      <div className="max-w-sm space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirm.length > 0 && confirm !== next ? (
            <p className="text-xs text-destructive">Passwords don't match.</p>
          ) : null}
        </div>
        <Button
          size="sm"
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await changePassword(current, next);
              toast.success("Password updated.");
              setCurrent("");
              setNext("");
              setConfirm("");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not update your password.");
            } finally {
              setSaving(false);
            }
          }}
        >
          <KeyRound className="size-4" /> Update password
        </Button>
      </div>
    </Section>
  );
}

function OrganizationSection() {
  const user = useCurrentUser();
  const { verifyPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  if (!user) return null;

  const fieldAssociateLink =
    typeof window !== "undefined" ? `${window.location.origin}/r/${user.organizationSlug}` : "";

  return (
    <Section
      title="Organization"
      description={`${user.organisation} — everyone signed in under this org shares this data.`}
    >
      <div className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label>Field associate link</Label>
          <div className="flex items-center gap-2">
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
        </div>

        <div className="space-y-1.5">
          <Label>Coordinator invite code</Label>
          {inviteCode ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-sm">
                {inviteCode}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(inviteCode);
                  toast.success("Code copied.");
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder="Enter your password to reveal"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={revealing || password.length === 0}
                onClick={async () => {
                  setRevealing(true);
                  try {
                    const ok = await verifyPassword(password);
                    if (!ok) {
                      toast.error("Incorrect password.");
                      return;
                    }
                    const code = isApiConfigured()
                      ? await getMyOrganizationInviteCode()
                      : (user.organizationInviteCode ?? "MOCK-0000");
                    setInviteCode(code);
                    setPassword("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not reveal the code.");
                  } finally {
                    setRevealing(false);
                  }
                }}
              >
                <Eye className="size-4" /> Reveal
              </Button>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function DangerZone() {
  const user = useCurrentUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  return (
    <section className="overflow-hidden rounded-md border border-destructive/40 bg-destructive/5">
      <div className="border-b border-destructive/30 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertTriangle className="size-4" /> Danger zone
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Destructive, organization-wide actions. There is no undo.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium">Delete this organization</p>
          <p className="text-xs text-muted-foreground">
            Permanently deletes {user.organisation}, every case, drug, and audit record, and removes
            every team member's access.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Delete organization
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {user.organisation}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the organization, every case, the drug catalog, the audit
                trail, and every team member's access. <strong>This cannot be undone.</strong> Type{" "}
                <strong>{DELETE_CONFIRMATION_PHRASE}</strong> to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={DELETE_CONFIRMATION_PHRASE}
            />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmText.trim().toLowerCase() !== DELETE_CONFIRMATION_PHRASE || deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async (e) => {
                  e.preventDefault();
                  setDeleting(true);
                  try {
                    if (isApiConfigured()) {
                      await deleteMyOrganization();
                    }
                    toast.success("Organization deleted.");
                    await signOut();
                    navigate({ to: "/", replace: true });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not delete the organization.");
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

function SettingsPage() {
  const user = useCurrentUser();
  const isManager = user?.role === "PV_MANAGER" || user?.role === "ADMIN";

  return (
    <>
      <PageHeader title="Settings" description="Manage your account and organization." />
      <div className="space-y-4 p-6">
        <ProfileSection />
        <ChangePasswordSection />
        {isManager ? <OrganizationSection /> : null}
        {isManager ? <DangerZone /> : null}
      </div>
    </>
  );
}
