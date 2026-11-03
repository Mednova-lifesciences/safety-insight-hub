import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy, Pencil, Plus, Printer, QrCode as QrIcon } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PageHeader, QueryBoundary, Section, StatusPill } from "@/components/pv/primitives";
import { QrCode } from "@/components/pv/qr-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { usePvQuery } from "@/lib/data-source";
import { useCurrentUser } from "@/lib/auth";
import { cases as casesApi } from "@/services/api/cases";
import { demoCases } from "@/services/demo/dataset";
import {
  BranchesNotSetUpError,
  branchActivity,
  branchLink,
  branches as branchesApi,
  monthKey,
  validateBranch,
  type Branch,
  type BranchActivity,
  type BranchInput,
} from "@/services/api/branches";
import { todayIso } from "@/services/api/regulatory-clock";
import { isNotConfigured } from "@/services/api/client";

export const Route = createFileRoute("/_app/branches")({
  head: () => ({
    meta: [
      { title: "Branches — MedNova PV Assist" },
      {
        name: "description",
        content: "Branch register, reporting links and QR codes, and reports received by branch.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="team.view">
      <BranchesPage />
    </PermissionGate>
  ),
});

const EMPTY: BranchInput = {
  name: "",
  code: "",
  area: "",
  focalPerson: "",
  focalPhone: "",
  active: true,
};

function BranchDialog({
  branch,
  prefillName,
  all,
  onSaved,
}: {
  branch?: Branch;
  prefillName?: string;
  all: Branch[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BranchInput>(EMPTY);
  const set = (k: keyof BranchInput) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const input: BranchInput = {
      name: form.name.trim(),
      code: form.code?.trim() || undefined,
      area: form.area?.trim() || undefined,
      focalPerson: form.focalPerson?.trim() || undefined,
      focalPhone: form.focalPhone?.trim() || undefined,
      active: form.active,
    };
    const problems = validateBranch(
      input,
      all.filter((b) => b.id !== branch?.id),
    );
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    if (branch && branch.name !== input.name) {
      toast.message(
        "Renamed — print a new QR code for this branch; the old one uses the old name.",
      );
    }
    setSaving(true);
    try {
      if (branch) await branchesApi.update(branch.id, branch, input);
      else await branchesApi.create(input);
      toast.success(branch ? `${input.name} updated.` : `${input.name} added.`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The branch could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setForm(branch ? { ...EMPTY, ...branch } : { ...EMPTY, name: prefillName ?? "" });
      }}
    >
      <DialogTrigger asChild>
        {branch ? (
          <Button size="sm" variant="ghost" aria-label={`Edit ${branch.name}`}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : prefillName ? (
          <Button size="sm" variant="ghost">
            <Plus className="size-3.5" /> Add to register
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Add branch
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a branch"}</DialogTitle>
          <DialogDescription>
            The branch name is what its QR code and reporting link carry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="brName">Branch name</Label>
            <Input id="brName" value={form.name} onChange={set("name")} maxLength={80} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brCode">Store code</Label>
            <Input id="brCode" value={form.code ?? ""} onChange={set("code")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brArea">Area / city</Label>
            <Input id="brArea" value={form.area ?? ""} onChange={set("area")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brFocal">PV focal person</Label>
            <Input id="brFocal" value={form.focalPerson ?? ""} onChange={set("focalPerson")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brPhone">Focal person phone</Label>
            <Input id="brPhone" value={form.focalPhone ?? ""} onChange={set("focalPhone")} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v === true }))}
            />
            Active branch
          </label>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : branch ? "Save changes" : "Add branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QrDialog({ name, link, orgName }: { name: string; link: string; orgName: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`QR code for ${name}`}>
          <QrIcon className="size-3.5" /> QR
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{name} — reporting QR code</DialogTitle>
          <DialogDescription>
            Reports sent through this code are tagged to {name} automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="print-area space-y-3 text-center">
          <p className="text-lg font-semibold">{orgName}</p>
          <p className="text-base">Had a side effect from a medicine?</p>
          <div className="flex justify-center">
            <QrCode value={link} size={240} title={`Reporting QR code for ${name}`} />
          </div>
          <p className="text-sm">Scan to report it — it takes a few minutes, no account needed.</p>
          <p className="text-xs text-muted-foreground">Branch: {name}</p>
          <p className="text-[10px] break-all text-muted-foreground">{link}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(link);
              toast.success("Link copied.");
            }}
          >
            <Copy className="size-4" /> Copy link
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Print poster
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

function ActivityTable({
  rows,
  register,
  setUp,
  onSaved,
}: {
  rows: BranchActivity[];
  register: Branch[];
  setUp: boolean;
  onSaved: () => void;
}) {
  const user = useCurrentUser();
  const today = todayIso();
  const months = Array.from({ length: 6 }, (_, i) => monthKey(today, 5 - i));
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = user?.organizationSlug ?? "";

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No branches yet. Add your branches, then print each one&apos;s QR code for the counter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="label-caps px-3 py-2">Branch</th>
            <th className="label-caps px-3 py-2">Focal person</th>
            <th className="label-caps px-3 py-2 text-right">Last 30 days</th>
            {months.map((m) => (
              <th key={m} className="label-caps px-2 py-2 text-right">
                {monthLabel(m)}
              </th>
            ))}
            <th className="label-caps px-3 py-2 text-right">Total</th>
            <th className="label-caps px-3 py-2">Last report</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border last:border-0">
              <td className="px-3 py-2">
                <p className="font-medium">{r.name}</p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {r.branch?.area ? (
                    <span className="text-xs text-muted-foreground">{r.branch.area}</span>
                  ) : null}
                  {!r.branch ? <StatusPill tone="neutral">Not in register</StatusPill> : null}
                  {r.branch && !r.branch.active ? (
                    <StatusPill tone="neutral">Inactive</StatusPill>
                  ) : null}
                  {r.silent ? <StatusPill tone="warning">No reports in 30 days</StatusPill> : null}
                </div>
              </td>
              <td className="px-3 py-2 text-xs">
                {r.branch?.focalPerson ?? <span className="text-muted-foreground">—</span>}
                {r.branch?.focalPhone ? (
                  <span className="block text-muted-foreground">{r.branch.focalPhone}</span>
                ) : null}
              </td>
              <td className="mono-num px-3 py-2 text-right font-semibold">{r.last30Days}</td>
              {r.monthly.map((n, i) => (
                <td
                  key={i}
                  className={
                    "mono-num px-2 py-2 text-right " + (n === 0 ? "text-muted-foreground" : "")
                  }
                >
                  {n}
                </td>
              ))}
              <td className="mono-num px-3 py-2 text-right">{r.total}</td>
              <td className="mono-num px-3 py-2 whitespace-nowrap">{r.lastReport ?? "—"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap justify-end gap-1">
                  {slug ? (
                    <QrDialog
                      name={r.name}
                      orgName={user?.organisation ?? ""}
                      link={branchLink(origin, slug, r.name)}
                    />
                  ) : null}
                  {setUp ? (
                    r.branch ? (
                      <BranchDialog branch={r.branch} all={register} onSaved={onSaved} />
                    ) : (
                      <BranchDialog prefillName={r.name} all={register} onSaved={onSaved} />
                    )
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchesPage() {
  const queryClient = useQueryClient();
  const registerQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchesApi.list(),
    retry: (count, err) => !(err instanceof BranchesNotSetUpError) && count < 2,
  });
  const casesQuery = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["branches"] });

  const notSetUp =
    registerQuery.error instanceof BranchesNotSetUpError ||
    (registerQuery.error ? isNotConfigured(registerQuery.error) : false);
  const register = registerQuery.data ?? [];
  const otherError = registerQuery.error && !notSetUp ? registerQuery.error : null;

  return (
    <>
      <PageHeader
        title="Branches"
        description="Each branch's reporting link and QR code, and how many reports each branch sends."
        actions={
          !notSetUp && registerQuery.isSuccess ? (
            <BranchDialog all={register} onSaved={refresh} />
          ) : undefined
        }
      />
      <div className="space-y-4 p-6">
        {notSetUp ? (
          <div className="flex gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">The branch register is not set up on this database yet.</p>
              <p className="text-muted-foreground">
                It needs a one-off database update (migration
                20261103220000_pv_branches_and_registrations). Until then, reports are still counted
                below by the branch names on the cases, and QR codes can still be printed.
              </p>
            </div>
          </div>
        ) : null}
        {otherError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            Could not load the branch register: {otherError.message}
          </div>
        ) : null}

        <QueryBoundary query={casesQuery} loadingLabel="Loading reports">
          {(cases) => (
            <Section
              title="Reports by branch"
              description="Counted from cases tagged with a branch. Active branches with no report in 30 days are flagged."
            >
              {registerQuery.isPending && !notSetUp ? (
                <p className="text-sm text-muted-foreground">Loading branch register…</p>
              ) : (
                <ActivityTable
                  rows={branchActivity(register, cases, todayIso())}
                  register={register}
                  setUp={!notSetUp && registerQuery.isSuccess}
                  onSaved={refresh}
                />
              )}
            </Section>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}
