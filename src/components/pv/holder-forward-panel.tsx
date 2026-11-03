import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { products as productsApi } from "@/services/api/products";
import {
  FORWARD_METHOD_LABELS,
  caseProductHolders,
  validateForward,
  type ProductHolder,
} from "@/services/api/holder-forwarding";
import { todayIso } from "@/services/api/regulatory-clock";
import { demoProducts } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { usePermission } from "@/lib/auth";
import type { CaseDetail, HolderForward } from "@/types/pv";
import { Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function HolderLine({ p, canManageCatalog }: { p: ProductHolder; canManageCatalog: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{p.productName}</span>
      {p.status === "OWN_BRAND" ? (
        <StatusPill tone="info">Own brand — your registration, report it yourself</StatusPill>
      ) : p.status === "THIRD_PARTY" ? (
        p.forwards.length > 0 ? (
          <StatusPill tone="success">Forwarded to {p.holder}</StatusPill>
        ) : (
          <StatusPill tone="warning">Holder: {p.holder} — forward this report</StatusPill>
        )
      ) : (
        <>
          <StatusPill tone="neutral">Holder not recorded in the catalog</StatusPill>
          {canManageCatalog ? (
            <Link to="/drugs" className="text-xs text-primary hover:underline">
              Set it in the Drug Catalog
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}

function ForwardList({ forwards }: { forwards: HolderForward[] }) {
  if (forwards.length === 0) return null;
  return (
    <ul className="space-y-2">
      {forwards.map((f) => (
        <li key={f.id} className="rounded-md border border-border px-3 py-2 text-sm">
          <p>
            <span className="font-medium">{f.productName}</span> sent to{" "}
            <span className="font-medium">{f.holder}</span> on{" "}
            <span className="mono-num">{f.sentOn}</span> by {FORWARD_METHOD_LABELS[f.method]}
            {f.contact ? ` (${f.contact})` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Recorded by {f.recordedBy} · {f.recordedAt.slice(0, 16).replace("T", " ")}
            {f.note ? ` · ${f.note}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function HolderForwardPanel({ c, onSaved }: { c: CaseDetail; onSaved: () => void }) {
  const canEdit = usePermission("case.edit");
  const canManageCatalog = usePermission("catalog.manage");
  const catalogQuery = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );
  const holders = caseProductHolders(c, catalogQuery.data?.data ?? []);
  const firstToForward = holders.find((h) => h.status === "THIRD_PARTY" && h.forwards.length === 0);
  const [productName, setProductName] = useState("");
  const [holder, setHolder] = useState("");
  const [contact, setContact] = useState("");
  const [method, setMethod] = useState<HolderForward["method"]>("EMAIL");
  const [sentOn, setSentOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const allForwards = c.holderForwards ?? [];
  const anyThirdParty = holders.some((h) => h.status === "THIRD_PARTY");

  function start() {
    const target = firstToForward ?? holders[0];
    setProductName(target?.productName ?? "");
    setHolder(target?.holder ?? "");
    setOpen(true);
  }

  async function save() {
    const input = { productName, holder, contact, method, sentOn, note };
    const problems = validateForward(input, todayIso());
    if (problems.length > 0) {
      toast.error(problems[0]);
      return;
    }
    setSaving(true);
    try {
      await casesApi.recordHolderForward(c.id, input);
      toast.success(`Recorded: report sent to ${holder.trim()}.`);
      setOpen(false);
      setNote("");
      setContact("");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The forward could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Product holder"
      description="Reports about a product another company holds the NAFDAC registration for are passed on to that holder."
      actions={
        canEdit && !open ? (
          <Button
            size="sm"
            variant={firstToForward ? "default" : "outline"}
            onClick={() => start()}
          >
            <Send className="size-4" /> Record a forward
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {catalogQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Checking the drug catalog…</p>
        ) : (
          holders.map((p, i) => <HolderLine key={i} p={p} canManageCatalog={canManageCatalog} />)
        )}
        {!anyThirdParty && allForwards.length === 0 && !catalogQuery.isPending ? (
          <p className="text-xs text-muted-foreground">
            Nothing to forward unless a suspect product belongs to another holder.
          </p>
        ) : null}

        <ForwardList forwards={allForwards} />

        {open ? (
          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fwdProduct">Product</Label>
              <Select
                value={productName}
                onValueChange={(v) => {
                  setProductName(v);
                  const h = holders.find((x) => x.productName === v);
                  if (h?.holder) setHolder(h.holder);
                }}
              >
                <SelectTrigger id="fwdProduct">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {holders.map((h, i) => (
                    <SelectItem key={i} value={h.productName}>
                      {h.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fwdHolder">Sent to (holder)</Label>
              <Input id="fwdHolder" value={holder} onChange={(e) => setHolder(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fwdMethod">How</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as HolderForward["method"])}>
                <SelectTrigger id="fwdMethod">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FORWARD_METHOD_LABELS) as HolderForward["method"][]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {FORWARD_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fwdSentOn">Date sent</Label>
              <Input
                id="fwdSentOn"
                type="date"
                max={todayIso()}
                value={sentOn}
                onChange={(e) => setSentOn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fwdContact">
                Holder contact <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="fwdContact"
                placeholder="e.g. pv@holder.com"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fwdNote">
                Note <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="fwdNote"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save forward"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
