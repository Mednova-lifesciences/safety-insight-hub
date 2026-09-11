import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  MessageCircle,
  Phone,
  Plus,
  ShieldQuestion,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { ROLE_LABELS, useAuth, useCurrentUser } from "@/lib/auth";
import { getMyOrganizationInviteCode, deleteMyOrganization } from "@/services/api/organizations";
import { whatsapp, type RequiredQuestion } from "@/services/api/whatsapp";
import { regulatoryConfig } from "@/services/api/regulatory-config";
import {
  ALL_REACTION_OUTCOMES,
  type OrgQualificationMapping,
  type OrgRegulatoryConfig,
} from "@/services/e2b-r3/regulatory-config";
import { computeOrganizationReadiness } from "@/services/e2b-r3/regulatory-readiness";
import { UNCONFIRMED_SENTINEL } from "@/services/e2b-r3/transmission-config";
import type { ReactionOutcome, ReportType } from "@/services/e2b-r3/types";
import { supabase } from "@/integrations/supabase/client";
import { isApiConfigured } from "@/services/api/client";
import { PageHeader, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [phone, setPhone] = useState("");
  const [initialPhone, setInitialPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  useEffect(() => {
    if (!user || !isApiConfigured()) return;
    supabase
      .from("profiles")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const value = (data?.phone as string | null) ?? "";
        setPhone(value);
        setInitialPhone(value);
      });
  }, [user]);

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

        <div className="space-y-1.5 border-t border-border pt-4">
          <Label htmlFor="settings-phone">Phone number</Label>
          <Input
            id="settings-phone"
            type="tel"
            placeholder="e.g. 2348012345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Used to text you when a WhatsApp report is ready for your review.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={savingPhone || phone.trim() === initialPhone}
            onClick={async () => {
              setSavingPhone(true);
              try {
                const { error } = await supabase
                  .from("profiles")
                  .update({ phone: phone.trim() || null })
                  .eq("id", user.id);
                if (error) throw new Error(error.message);
                setInitialPhone(phone.trim());
                toast.success("Phone number updated.");
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Could not update your phone number.",
                );
              } finally {
                setSavingPhone(false);
              }
            }}
          >
            <Phone className="size-4" /> Save phone number
          </Button>
        </div>
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
                disabled={
                  confirmText.trim().toLowerCase() !== DELETE_CONFIRMATION_PHRASE || deleting
                }
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
                    toast.error(
                      err instanceof Error ? err.message : "Could not delete the organization.",
                    );
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

function newQuestionId() {
  return `q-${Math.random().toString(36).slice(2, 10)}`;
}

function WhatsAppIntakeSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [autoRespondDefault, setAutoRespondDefault] = useState(true);
  const [questions, setQuestions] = useState<RequiredQuestion[]>([]);
  const [newQuestion, setNewQuestion] = useState("");

  useEffect(() => {
    if (!isApiConfigured()) {
      setLoading(false);
      return;
    }
    whatsapp
      .getSettings()
      .then((s) => {
        setWhatsappNumber(s.whatsappNumber ?? "");
        setAutoRespondDefault(s.autoRespondDefault);
        setQuestions(s.requiredQuestions);
      })
      .catch(() => toast.error("Could not load WhatsApp intake settings."))
      .finally(() => setLoading(false));
  }, []);

  async function save(next: { requiredQuestions?: RequiredQuestion[] } = {}) {
    setSaving(true);
    try {
      await whatsapp.saveSettings({
        whatsappNumber: whatsappNumber.trim() || null,
        autoRespondDefault,
        requiredQuestions: next.requiredQuestions ?? questions,
      });
      toast.success("WhatsApp intake settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Section
      title="WhatsApp intake"
      description="Field reporters message this number and an AI conducts the intake conversation until your required questions are answered."
    >
      <div className="max-w-lg space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp-number">WhatsApp number</Label>
          <Input
            id="whatsapp-number"
            placeholder="e.g. 2348012345678"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The Termii-registered number field associates and reporters text.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Auto-respond by default</p>
            <p className="text-xs text-muted-foreground">
              New conversations start with the AI replying automatically. Staff can turn this off
              per-conversation to take over manually.
            </p>
          </div>
          <Switch checked={autoRespondDefault} onCheckedChange={setAutoRespondDefault} />
        </div>

        <div className="space-y-2">
          <Label>Required questions</Label>
          <p className="text-xs text-muted-foreground">
            The AI keeps asking questions until every one of these is answered (on top of the
            minimum reporter/patient/product/reaction ICSR criteria).
          </p>
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div
                key={q.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="flex-1 text-sm">{q.text}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = questions.filter((_, idx) => idx !== i);
                    setQuestions(next);
                    save({ requiredQuestions: next });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="e.g. What is the batch number?"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newQuestion.trim()}
              onClick={() => {
                const next = [...questions, { id: newQuestionId(), text: newQuestion.trim() }];
                setQuestions(next);
                setNewQuestion("");
                save({ requiredQuestions: next });
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>

        <Button size="sm" disabled={saving} onClick={() => save()}>
          <MessageCircle className="size-4" /> Save WhatsApp settings
        </Button>
      </div>
    </Section>
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  RECOVERED: "Recovered/resolved",
  RECOVERING: "Recovering/resolving",
  NOT_RECOVERED: "Not recovered/not resolved",
  RECOVERED_WITH_SEQUELAE: "Recovered/resolved with sequelae",
  FATAL: "Fatal",
  UNKNOWN: "Unknown",
};

const QUALIFICATION_CODE_LABELS: Record<"1" | "2" | "3" | "4" | "5", string> = {
  "1": "1 — Physician",
  "2": "2 — Pharmacist",
  "3": "3 — Other health professional",
  "4": "4 — Lawyer",
  "5": "5 — Consumer or other non-health professional",
};

/**
 * "Settings → Regulatory Profiles → NAFDAC E2B(R3)" — the one place
 * decisions D2-D4 (sender/receiver identifiers, C.1.3 report type, the
 * C.2.r.4 reporter-qualification mapping, and the E.i.7 outcome codelist)
 * get configured ONCE and are then automatically reused by every future
 * E2B(R3) export (src/services/e2b-r3/export.ts reads this same
 * pv_regulatory_config / pv_reporter_qualification_mappings state — see
 * services/api/regulatory-config.ts). Nothing here is ever guessed: every
 * field starts unconfigured/unverified and stays that way until an admin
 * explicitly enters and confirms a real NAFDAC-supplied value.
 */
function RegulatoryProfileSection() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<OrgRegulatoryConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const [senderOrg, setSenderOrg] = useState("");
  const [senderId, setSenderId] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [receiverOrg, setReceiverOrg] = useState("");
  const [reportType, setReportType] = useState<ReportType>("4");
  const [reportTypeConfirmed, setReportTypeConfirmed] = useState(false);
  const [environment, setEnvironment] = useState<"uat" | "production">("uat");

  const [newDesignation, setNewDesignation] = useState("");
  const [newDesignationCode, setNewDesignationCode] = useState<"1" | "2" | "3" | "4" | "5" | "">(
    "",
  );

  async function load() {
    setLoading(true);
    try {
      const c = await regulatoryConfig.get();
      setConfig(c);
      setSenderOrg(
        c.transmission.sender.organization === UNCONFIRMED_SENTINEL
          ? ""
          : c.transmission.sender.organization,
      );
      setSenderId(
        c.transmission.sender.identifier === UNCONFIRMED_SENTINEL
          ? ""
          : c.transmission.sender.identifier,
      );
      setReceiverId(
        c.transmission.receiver.identifier === UNCONFIRMED_SENTINEL
          ? ""
          : c.transmission.receiver.identifier,
      );
      setReceiverOrg(c.transmission.receiver.organization ?? "");
      setReportType(c.transmission.reportType);
      setReportTypeConfirmed(c.transmission.reportTypeConfirmed === true);
      setEnvironment(c.transmission.environment);
    } catch {
      toast.error("Could not load NAFDAC E2B(R3) regulatory configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isApiConfigured()) {
      setLoading(false);
      return;
    }
    load();
  }, []);

  if (loading) return null;
  if (!config) return null;

  const readiness = computeOrganizationReadiness(config);

  async function saveTransmission() {
    setSaving(true);
    try {
      await regulatoryConfig.saveTransmission({
        environment,
        senderOrganization: senderOrg.trim() || null,
        senderIdentifier: senderId.trim() || null,
        receiverOrganization: receiverOrg.trim() || null,
        receiverIdentifier: receiverId.trim() || null,
        reportType,
        reportTypeConfirmed,
      });
      toast.success("Transmission configuration saved.");
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save transmission configuration.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveOutcomeCode(outcome: ReactionOutcome, code: string) {
    if (!code.trim()) return;
    try {
      await regulatoryConfig.saveOutcomeCode(outcome, code.trim());
      toast.success(`Outcome code for "${OUTCOME_LABELS[outcome]}" saved.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save outcome code.");
    }
  }

  async function addQualificationMapping() {
    if (!newDesignation.trim() || !newDesignationCode) return;
    try {
      await regulatoryConfig.upsertReporterQualificationMapping(
        newDesignation.trim(),
        newDesignationCode,
      );
      setNewDesignation("");
      setNewDesignationCode("");
      toast.success("Reporter qualification mapping saved.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the mapping.");
    }
  }

  async function updateMappingCode(
    mapping: OrgQualificationMapping,
    code: "1" | "2" | "3" | "4" | "5",
  ) {
    try {
      await regulatoryConfig.upsertReporterQualificationMapping(mapping.designation, code);
      toast.success(`"${mapping.designation}" configured.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the mapping.");
    }
  }

  async function removeMapping(mapping: OrgQualificationMapping) {
    try {
      await regulatoryConfig.deleteReporterQualificationMapping(mapping.id);
      toast.success(`"${mapping.designation}" removed.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the mapping.");
    }
  }

  return (
    <Section
      title="Regulatory Profiles — NAFDAC E2B(R3)"
      description="Configure sender/receiver identifiers, report type, reporter-qualification mappings, and the outcome codelist ONCE — every future E2B(R3) export reuses this automatically."
    >
      <div className="space-y-6">
        <div>
          <p className="label-caps mb-2">NAFDAC E2B(R3) readiness</p>
          <div className="flex flex-wrap gap-2">
            {readiness.map((item) => (
              <StatusPill
                key={item.key}
                tone={
                  item.status === "CONFIGURED"
                    ? "success"
                    : item.status === "MISSING"
                      ? "critical"
                      : "warning"
                }
              >
                {item.status === "CONFIGURED" ? (
                  <CheckCircle2 className="mr-1 inline size-3" />
                ) : (
                  <ShieldQuestion className="mr-1 inline size-3" />
                )}
                {item.label}
              </StatusPill>
            ))}
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {readiness.map((item) => (
              <li key={item.key}>
                <strong>{item.label}:</strong> {item.detail}
              </li>
            ))}
          </ul>
        </div>

        <div className="max-w-lg space-y-4 border-t border-border pt-4">
          <p className="text-sm font-medium">Transmission (decision D4)</p>
          <p className="text-xs text-muted-foreground">
            Sender/receiver identifiers are trading-partner configuration agreed bilaterally with
            NAFDAC/UMC — never invented here. Leave blank until NAFDAC supplies a real value.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="reg-sender-org">Sender organisation (C.3.2)</Label>
            <Input
              id="reg-sender-org"
              value={senderOrg}
              onChange={(e) => setSenderOrg(e.target.value)}
              placeholder="Source: NAFDAC confirmation required"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-sender-id">Sender transmission identifier</Label>
            <Input
              id="reg-sender-id"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              placeholder="Source: NAFDAC confirmation required"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-receiver-org">Receiver organisation</Label>
            <Input
              id="reg-receiver-org"
              value={receiverOrg}
              onChange={(e) => setReceiverOrg(e.target.value)}
              placeholder="e.g. NAFDAC"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-receiver-id">Receiver transmission identifier</Label>
            <Input
              id="reg-receiver-id"
              value={receiverId}
              onChange={(e) => setReceiverId(e.target.value)}
              placeholder="Source: NAFDAC confirmation required"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select
              value={environment}
              onValueChange={(v) => setEnvironment(v as "uat" | "production")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uat">UAT / test</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>C.1.3 report type (decision D3)</Label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 — Spontaneous report</SelectItem>
                <SelectItem value="2">2 — Report from study</SelectItem>
                <SelectItem value="3">3 — Other</SelectItem>
                <SelectItem value="4">4 — Not available to sender</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={reportTypeConfirmed} onCheckedChange={setReportTypeConfirmed} />
              <span className="text-xs text-muted-foreground">
                Confirmed with NAFDAC — this value has been verified, not merely selected.
              </span>
            </div>
          </div>
          <Button size="sm" disabled={saving} onClick={saveTransmission}>
            Save transmission configuration
          </Button>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">Outcome codelist (E.i.7, Appendix I(F))</p>
          <p className="text-xs text-muted-foreground">
            NAFDAC/ICH's numeric binding for each of the six fixed outcome concepts. Not assumed
            from any developer spec's illustrative numbering — each one starts unconfigured until
            entered here.
          </p>
          <div className="space-y-2">
            {ALL_REACTION_OUTCOMES.map((outcome) => {
              const current = config.outcomeCodes[outcome];
              return (
                <div
                  key={outcome}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="flex-1 text-sm">{OUTCOME_LABELS[outcome]}</span>
                  {current ? (
                    <StatusPill tone="success">Code {current}</StatusPill>
                  ) : (
                    <StatusPill tone="warning">Not configured</StatusPill>
                  )}
                  <Input
                    className="w-20"
                    placeholder="code"
                    defaultValue={current ?? ""}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value.trim() !== current) {
                        saveOutcomeCode(outcome, e.target.value);
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">
            Reporter qualification mappings (C.2.r.4, Appendix I(F))
          </p>
          <p className="text-xs text-muted-foreground">
            Free-text reporter designations from any source line-list (CHEW, CHO, Nurse, Midwife,
            Doctor, HMIS, OIC, …) mapped to a qualification code. A designation is added here
            automatically the first time an E2B(R3) preflight encounters it in real case data — "Not
            configured" rows need an admin to pick a code before affected cases can export.
          </p>
          <div className="space-y-2">
            {config.reporterQualificationMappings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No designations configured or seen yet.
              </p>
            ) : (
              config.reporterQualificationMappings.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="flex-1 text-sm">{m.designation}</span>
                  {m.code ? (
                    <StatusPill tone="success">Configured</StatusPill>
                  ) : (
                    <StatusPill tone="warning">Not configured</StatusPill>
                  )}
                  <Select
                    value={m.code ?? ""}
                    onValueChange={(v) => updateMappingCode(m, v as "1" | "2" | "3" | "4" | "5")}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Choose a code…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["1", "2", "3", "4", "5"] as const).map((code) => (
                        <SelectItem key={code} value={code}>
                          {QUALIFICATION_CODE_LABELS[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => removeMapping(m)}>
                    <XCircle className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="e.g. Midwife"
              value={newDesignation}
              onChange={(e) => setNewDesignation(e.target.value)}
            />
            <Select
              value={newDesignationCode}
              onValueChange={(v) => setNewDesignationCode(v as "1" | "2" | "3" | "4" | "5")}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Choose a code…" />
              </SelectTrigger>
              <SelectContent>
                {(["1", "2", "3", "4", "5"] as const).map((code) => (
                  <SelectItem key={code} value={code}>
                    {QUALIFICATION_CODE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!newDesignation.trim() || !newDesignationCode}
              onClick={addQualificationMapping}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function SettingsPage() {
  const user = useCurrentUser();
  const isManager = user?.role === "PV_MANAGER" || user?.role === "ADMIN";
  const canConfigureIntake =
    user?.role === "PV_MANAGER" || user?.role === "PV_COORDINATOR" || user?.role === "ADMIN";

  return (
    <>
      <PageHeader title="Settings" description="Manage your account and organization." />
      <div className="space-y-4 p-6">
        <ProfileSection />
        <ChangePasswordSection />
        {canConfigureIntake ? <WhatsAppIntakeSection /> : null}
        {isManager ? <RegulatoryProfileSection /> : null}
        {isManager ? <OrganizationSection /> : null}
        {isManager ? <DangerZone /> : null}
      </div>
    </>
  );
}
