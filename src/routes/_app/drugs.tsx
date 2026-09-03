import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Pill, Plus, Search, Upload } from "lucide-react";
import { products as productsApi, type CatalogDrug } from "@/services/api/products";
import { parseTabularFile } from "@/services/api/tabular-parse";
import { demoProducts } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { useCurrentUser, usePermission } from "@/lib/auth";
import { PageHeader, QueryBoundary, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_app/drugs")({
  head: () => ({
    meta: [{ title: "Drug Catalog — MedNova PV Assist" }],
  }),
  component: DrugsPage,
});

function AddDrugDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", activeIngredient: "", strength: "", route: "" });

  async function save() {
    if (!form.name.trim()) {
      toast.error("Drug name is required.");
      return;
    }
    setSaving(true);
    try {
      await productsApi.create({
        name: form.name,
        activeIngredient: form.activeIngredient || undefined,
        strength: form.strength || undefined,
        route: form.route || undefined,
      });
      toast.success(`${form.name} added to the catalog.`);
      setForm({ name: "", activeIngredient: "", strength: "", route: "" });
      setOpen(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that drug.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Add drug
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a drug to the catalog</DialogTitle>
          <DialogDescription>
            Field associates will be able to search for and select this drug when reporting an
            ICSR.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="drugName">Drug name</Label>
            <Input
              id="drugName"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="drugIngredient">Active ingredient</Label>
              <Input
                id="drugIngredient"
                value={form.activeIngredient}
                onChange={(e) => setForm((f) => ({ ...f, activeIngredient: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drugStrength">Strength</Label>
              <Input
                id="drugStrength"
                value={form.strength}
                onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="drugRoute">Route</Label>
            <Input
              id="drugRoute"
              value={form.route}
              onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Adding…" : "Add drug"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recognises a handful of likely header spellings per drug field — this
 *  catalog only has five columns, so a small fixed lookup beats pulling in
 *  the AEFI-form-aware keyword mapper built for line-list processing. */
const COLUMN_ALIASES: Record<string, keyof CatalogDrug> = {
  name: "name",
  drugname: "name",
  drug: "name",
  product: "name",
  productname: "name",
  activeingredient: "activeIngredient",
  ingredient: "activeIngredient",
  strength: "strength",
  dose: "doseUnit",
  doseunit: "doseUnit",
  route: "route",
  routeofadministration: "route",
};

function mapCsvRow(headers: string[], row: string[]): Partial<CatalogDrug> {
  const out: Partial<CatalogDrug> = {};
  headers.forEach((header, i) => {
    const key = COLUMN_ALIASES[header.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (key && row[i]?.trim()) out[key] = row[i].trim();
  });
  return out;
}

function UploadCsvDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ filename: string; rows: Partial<CatalogDrug>[] } | null>(
    null,
  );

  async function handleFile(file: File) {
    try {
      const parsed = await parseTabularFile(file);
      const rows = parsed.rows
        .map((row) => mapCsvRow(parsed.headers, row))
        .filter((r): r is { name: string } & Partial<CatalogDrug> => !!r.name?.trim());
      if (rows.length === 0) {
        toast.error("No rows with a recognisable drug name column were found.");
        return;
      }
      setPreview({ filename: file.name, rows });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const { created, skipped } = await productsApi.bulkCreate(
        preview.rows.map((r) => ({ name: r.name!, ...r })),
        preview.filename,
      );
      toast.success(`Imported ${created} drug(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ""}.`);
      setPreview(null);
      setOpen(false);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPreview(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="size-4" /> Upload CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk-upload drugs</DialogTitle>
          <DialogDescription>
            CSV or spreadsheet with columns for name, active ingredient, strength and route.
            Duplicates (matched by name) are skipped automatically.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {preview.rows.length} row(s) recognised from <strong>{preview.filename}</strong>.
              Review before confirming.
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Active ingredient</TableHead>
                    <TableHead>Strength</TableHead>
                    <TableHead>Route</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, 50).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.activeIngredient ?? "—"}</TableCell>
                      <TableCell>{r.strength ?? "—"}</TableCell>
                      <TableCell>{r.route ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={importing}>
                Choose a different file
              </Button>
              <Button onClick={confirmImport} disabled={importing}>
                {importing ? "Importing…" : `Import ${preview.rows.length} drug(s)`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-10 text-center hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">Choose a CSV or spreadsheet file</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleFile(f);
              }}
            />
          </label>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DrugsPage() {
  const user = useCurrentUser();
  const canManage = usePermission("catalog.manage");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const query = usePvQuery(["products"], () => productsApi.list(), () => demoProducts);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products"] });

  const fieldAssociateLink =
    typeof window !== "undefined" && user?.organizationSlug
      ? `${window.location.origin}/r/${user.organizationSlug}`
      : "";

  return (
    <>
      <PageHeader
        title="Drug Catalog"
        description="The drugs field associates can choose from when reporting an ICSR."
        actions={
          canManage ? (
            <>
              <UploadCsvDialog onImported={refresh} />
              <AddDrugDialog onAdded={refresh} />
            </>
          ) : undefined
        }
      />
      <div className="space-y-4 p-6">
        {canManage && fieldAssociateLink ? (
          <Section
            title="Field associate link"
            description="Share this with field associates — no account needed on their end."
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
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
                <Copy className="size-4" /> Copy
              </Button>
            </div>
          </Section>
        ) : null}

        <QueryBoundary query={query} loadingLabel="Loading drug catalog">
          {(drugs) => <DrugTable drugs={drugs} search={search} setSearch={setSearch} />}
        </QueryBoundary>
      </div>
    </>
  );
}

function DrugTable({
  drugs,
  search,
  setSearch,
}: {
  drugs: CatalogDrug[];
  search: string;
  setSearch: (v: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drugs;
    return drugs.filter(
      (d) => d.name.toLowerCase().includes(q) || d.activeIngredient?.toLowerCase().includes(q),
    );
  }, [drugs, search]);

  return (
    <Section
      title={`${drugs.length} drug${drugs.length === 1 ? "" : "s"} in catalog`}
      actions={
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search drugs…"
            className="w-56 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-10 text-center">
          <Pill className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">
            {drugs.length === 0 ? "No drugs in the catalog yet" : "No drugs match your search"}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Active ingredient</TableHead>
              <TableHead>Strength</TableHead>
              <TableHead>Route</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.activeIngredient ?? "—"}</TableCell>
                <TableCell>{d.strength ?? "—"}</TableCell>
                <TableCell>
                  {d.route ? <StatusPill tone="neutral">{d.route}</StatusPill> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
