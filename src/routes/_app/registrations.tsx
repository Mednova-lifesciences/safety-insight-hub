import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PageHeader, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePvQuery } from "@/lib/data-source";
import { products as productsApi } from "@/services/api/products";
import { demoProducts } from "@/services/demo/dataset";
import { newId } from "@/services/api/db";
import { isNotConfigured } from "@/services/api/client";
import { addMonthsIso } from "@/services/psur/own-brand-calendar";
import { daysBetween, todayIso } from "@/services/api/regulatory-clock";
import {
  RegistrationsNotSetUpError,
  allAlerts,
  registrationAlerts,
  registrations as registrationsApi,
  validateRegistration,
  type AlertLevel,
  type Registration,
  type RegistrationInput,
  type Variation,
} from "@/services/api/registrations";

export const Route = createFileRoute("/_app/registrations")({
  head: () => ({
    meta: [
      { title: "Registrations — MedNova PV Assist" },
      {
        name: "description",
        content:
          "NAFDAC registrations, renewals, variations and commitments, with deadline alerts.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="team.view">
      <RegistrationsPage />
    </PermissionGate>
  ),
});

const ALERT_TONE: Record<AlertLevel, "critical" | "warning" | "info"> = {
  EXPIRED: "critical",
  CRITICAL: "critical",
  WARNING: "warning",
  NOTICE: "info",
};

const VARIATION_LABELS: Record<Variation["status"], string> = {
  PLANNED: "Planned",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const EMPTY: RegistrationInput = {
  productName: "",
  registrationNumber: "",
  status: "ACTIVE",
  variations: [],
  commitments: [],
};

function RegistrationDialog({
  registration,
  onSaved,
}: {
  registration?: Registration;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RegistrationInput>(EMPTY);
  const catalogQuery = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );
  const catalog = catalogQuery.data?.data ?? [];
  const set =
    <K extends keyof RegistrationInput>(k: K) =>
    (v: RegistrationInput[K]) =>
      setForm((f) => ({ ...f, [k]: v }));
  const text =
    (k: "productName" | "registrationNumber" | "holder" | "notes") =>
    (e: { target: { value: string } }) =>
      set(k)(e.target.value);
  const date =
    (k: "issueDate" | "expiryDate" | "renewalSubmittedOn") => (e: { target: { value: string } }) =>
      set(k)(e.target.value || undefined);

  async function save() {
    const match = catalog.find(
      (d) => d.name.trim().toLowerCase() === form.productName.trim().toLowerCase(),
    );
    const input: RegistrationInput = {
      ...form,
      productName: form.productName.trim(),
      registrationNumber: form.registrationNumber.trim(),
      holder: form.holder?.trim() || match?.holder || undefined,
      productId: match?.id,
      notes: form.notes?.trim() || undefined,
      variations: form.variations.filter((v) => v.description.trim()),
      commitments: form.commitments.filter((c) => c.description.trim()),
    };
    const problems = validateRegistration(input);
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    setSaving(true);
    try {
      if (registration) await registrationsApi.update(registration.id, registration, input);
      else await registrationsApi.create(input);
      toast.success(`${input.productName} — ${input.registrationNumber} saved.`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The registration could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setForm(registration ? { ...EMPTY, ...registration } : EMPTY);
      }}
    >
      <DialogTrigger asChild>
        {registration ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Edit ${registration.productName} ${registration.registrationNumber}`}
          >
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Add registration
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{registration ? "Edit registration" : "Add a registration"}</DialogTitle>
          <DialogDescription>
            Alerts start 180 days before expiry and stop once the renewal is filed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="regProduct">Product</Label>
            <Input
              id="regProduct"
              list="reg-catalog"
              value={form.productName}
              onChange={text("productName")}
            />
            <datalist id="reg-catalog">
              {catalog.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regNumber">NAFDAC registration number</Label>
            <Input
              id="regNumber"
              placeholder="e.g. A4-1234"
              value={form.registrationNumber}
              onChange={text("registrationNumber")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regHolder">Holder</Label>
            <Input id="regHolder" value={form.holder ?? ""} onChange={text("holder")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regStatus">Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => set("status")(v as Registration["status"])}
            >
              <SelectTrigger id="regStatus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="WITHDRAWN">Withdrawn / lapsed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regIssue">Issue date</Label>
            <Input
              id="regIssue"
              type="date"
              value={form.issueDate ?? ""}
              onChange={date("issueDate")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regExpiry">Expiry date</Label>
            <div className="flex gap-2">
              <Input
                id="regExpiry"
                type="date"
                value={form.expiryDate ?? ""}
                onChange={date("expiryDate")}
              />
              {form.issueDate && !form.expiryDate ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => set("expiryDate")(addMonthsIso(form.issueDate!, 60))}
                >
                  +5 years
                </Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regRenewal">
              Renewal filed on <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="regRenewal"
              type="date"
              max={todayIso()}
              value={form.renewalSubmittedOn ?? ""}
              onChange={date("renewalSubmittedOn")}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="regNotes">
              Notes <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="regNotes" rows={2} value={form.notes ?? ""} onChange={text("notes")} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <p className="label-caps">Variations</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  set("variations")([
                    ...form.variations,
                    { id: newId("var"), description: "", status: "PLANNED" },
                  ])
                }
              >
                <Plus className="size-3.5" /> Add variation
              </Button>
            </div>
            {form.variations.map((v, i) => (
              <div key={v.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
                <Input
                  aria-label="Variation"
                  placeholder="e.g. New pack size"
                  value={v.description}
                  onChange={(e) =>
                    set("variations")(
                      form.variations.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Input
                  aria-label="Submitted on"
                  type="date"
                  value={v.submittedOn ?? ""}
                  onChange={(e) =>
                    set("variations")(
                      form.variations.map((x, j) =>
                        j === i ? { ...x, submittedOn: e.target.value || undefined } : x,
                      ),
                    )
                  }
                />
                <Select
                  value={v.status}
                  onValueChange={(s) =>
                    set("variations")(
                      form.variations.map((x, j) =>
                        j === i ? { ...x, status: s as Variation["status"] } : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger aria-label="Variation status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VARIATION_LABELS) as Variation["status"][]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {VARIATION_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Remove variation"
                  onClick={() => set("variations")(form.variations.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <p className="label-caps">Commitments</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  set("commitments")([
                    ...form.commitments,
                    { id: newId("cmt"), description: "", done: false },
                  ])
                }
              >
                <Plus className="size-3.5" /> Add commitment
              </Button>
            </div>
            {form.commitments.map((c, i) => (
              <div key={c.id} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem_auto_auto]">
                <Input
                  aria-label="Commitment"
                  placeholder="e.g. Submit 24-month stability data"
                  value={c.description}
                  onChange={(e) =>
                    set("commitments")(
                      form.commitments.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Input
                  aria-label="Due date"
                  type="date"
                  value={c.dueDate ?? ""}
                  onChange={(e) =>
                    set("commitments")(
                      form.commitments.map((x, j) =>
                        j === i ? { ...x, dueDate: e.target.value || undefined } : x,
                      ),
                    )
                  }
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={c.done}
                    onCheckedChange={(v) =>
                      set("commitments")(
                        form.commitments.map((x, j) => (j === i ? { ...x, done: v === true } : x)),
                      )
                    }
                  />
                  Done
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Remove commitment"
                  onClick={() => set("commitments")(form.commitments.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save registration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidityPill({ r, today }: { r: Registration; today: string }) {
  if (r.status === "WITHDRAWN") return <StatusPill tone="neutral">Withdrawn</StatusPill>;
  if (r.renewalSubmittedOn)
    return <StatusPill tone="info">Renewal filed {r.renewalSubmittedOn}</StatusPill>;
  if (!r.expiryDate) return <StatusPill tone="neutral">No expiry recorded</StatusPill>;
  const days = daysBetween(today, r.expiryDate) ?? 0;
  const expiry = registrationAlerts({ ...r, commitments: [] }, today)[0];
  if (!expiry) return <StatusPill tone="success">Valid</StatusPill>;
  return (
    <StatusPill tone={ALERT_TONE[expiry.level]}>
      {days < 0 ? `Expired ${-days} days ago` : `Expires in ${days} days`}
    </StatusPill>
  );
}

function RegistrationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["registrations"],
    queryFn: () => registrationsApi.list(),
    retry: (count, err) => !(err instanceof RegistrationsNotSetUpError) && count < 2,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["registrations"] });
  const notSetUp =
    query.error instanceof RegistrationsNotSetUpError ||
    (query.error ? isNotConfigured(query.error) : false);
  const list = query.data ?? [];
  const today = todayIso();
  const alerts = allAlerts(list, today);

  return (
    <>
      <PageHeader
        title="Registrations & renewals"
        description="NAFDAC registrations, variations and commitments, with alerts before every deadline."
        actions={query.isSuccess ? <RegistrationDialog onSaved={refresh} /> : undefined}
      />
      <div className="space-y-4 p-6">
        {notSetUp ? (
          <div className="flex gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">
                The registration register is not set up on this database yet.
              </p>
              <p className="text-muted-foreground">
                It needs a one-off database update (migration
                20261103220000_pv_branches_and_registrations).
              </p>
            </div>
          </div>
        ) : null}
        {query.error && !notSetUp ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            Could not load registrations: {query.error.message}
          </div>
        ) : null}
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading registrations…</p>
        ) : null}

        {query.isSuccess ? (
          <>
            <Section
              title={alerts.length ? `${alerts.length} alert(s)` : "No alerts"}
              description="Expiry alerts at 180, 90 and 30 days; commitments within 30 days or overdue."
            >
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing due.</p>
              ) : (
                <ul className="space-y-1.5">
                  {alerts.map((a) => (
                    <li key={a.key} className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusPill tone={ALERT_TONE[a.level]}>
                        {a.level === "EXPIRED" ? "Overdue" : a.date}
                      </StatusPill>
                      <span className="font-medium">{a.productName}</span>
                      <span>{a.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`${list.length} registration${list.length === 1 ? "" : "s"}`}>
              {list.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No registrations yet. Add each product&apos;s NAFDAC registration to get renewal
                  alerts.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        {[
                          "Product",
                          "Reg. no.",
                          "Holder",
                          "Issued",
                          "Expires",
                          "Validity",
                          "Variations",
                          "Commitments",
                          "",
                        ].map((h) => (
                          <th key={h} className="label-caps px-3 py-2 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const openCommitments = r.commitments.filter((c) => !c.done).length;
                        const pendingVariations = r.variations.filter(
                          (v) => v.status === "PLANNED" || v.status === "SUBMITTED",
                        ).length;
                        return (
                          <tr key={r.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-medium">{r.productName}</td>
                            <td className="mono-num px-3 py-2">{r.registrationNumber}</td>
                            <td className="px-3 py-2">{r.holder ?? "—"}</td>
                            <td className="mono-num px-3 py-2 whitespace-nowrap">
                              {r.issueDate ?? "—"}
                            </td>
                            <td className="mono-num px-3 py-2 whitespace-nowrap">
                              {r.expiryDate ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <ValidityPill r={r} today={today} />
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {r.variations.length
                                ? `${r.variations.length} (${pendingVariations} pending)`
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {r.commitments.length
                                ? `${openCommitments} open of ${r.commitments.length}`
                                : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <RegistrationDialog registration={r} onSaved={refresh} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </>
  );
}
