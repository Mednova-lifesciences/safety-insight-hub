import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SIZE, Pager, Section } from "@/components/pv/primitives";
import { usePvQuery } from "@/lib/data-source";
import { ibdRegister } from "@/services/api/psur-ibd";
import {
  parseRegisterCsv,
  readDocumentDate,
  showDate,
  type IbdRegisterEntry,
} from "@/services/psur/ibd-register";

type Draft = {
  id?: string;
  activeSubstance: string;
  ibd: string;
  productNames: string;
  nafdacRegNos: string;
  source: string;
};
const EMPTY: Draft = {
  activeSubstance: "",
  ibd: "",
  productNames: "",
  nafdacRegNos: "",
  source: "",
};
const split = (s: string) =>
  s
    .split(/;|\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * The organisation's International Birth Dates, one per active substance.
 * PSUR pages compare the IBD a report states against these, and offer to
 * use the registered one when they differ. Every change is audited.
 */
export function ProductIbdsSection() {
  const register = usePvQuery(
    ["psur", "ibd-register"],
    () => ibdRegister.list(),
    () => [],
  );
  const entries = useMemo(() => register.data?.data ?? [], [register.data]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? entries.filter((e) =>
          [e.activeSubstance, ...e.productNames, ...e.nafdacRegNos].some((v) =>
            v.toLowerCase().includes(q),
          ),
        )
      : entries;
  }, [entries, search]);

  async function save() {
    if (!draft) return;
    const ibd = readDocumentDate(draft.ibd);
    if (!draft.activeSubstance.trim() || !ibd) {
      toast.error(
        !ibd ? "Enter the IBD as a date, e.g. 17 March 2014." : "Enter the active substance.",
      );
      return;
    }
    setSaving(true);
    try {
      await ibdRegister.save({
        ...(draft.id ? { id: draft.id } : {}),
        activeSubstance: draft.activeSubstance.trim(),
        ibd,
        productNames: split(draft.productNames),
        nafdacRegNos: split(draft.nafdacRegNos),
        source: draft.source.trim(),
      });
      toast.success(`${draft.activeSubstance.trim()}: IBD ${showDate(ibd)} saved.`);
      setDraft(null);
      await register.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: IbdRegisterEntry) {
    try {
      await ibdRegister.remove(e.id);
      toast.success(`${e.activeSubstance} removed from the register.`);
      await register.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const { rows, rejected } = parseRegisterCsv(await file.text());
      if (rows.length === 0) {
        toast.error(rejected[0]?.reason ?? "No rows could be read from that file.");
        return;
      }
      const r = await ibdRegister.importRows(rows, file.name);
      toast.success(
        `${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged${rejected.length ? `; ${rejected.length} row(s) skipped (${rejected.map((x) => `line ${x.line}: ${x.reason}`).join(" ")})` : ""}.`,
      );
      await register.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not import that file.");
    }
  }

  return (
    <Section
      id="product-ibds"
      title="Product IBDs"
      description="The International Birth Date of each active substance — its first marketing authorisation anywhere in the world. PSUR pages check the IBD a report states against this list."
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-full sm:w-72"
            placeholder="Search substance, product or NAFDAC Reg. No."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
            Add a product IBD
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
            <Upload className="size-3.5" /> Import a CSV
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-xs text-muted-foreground">
            CSV columns: Active substance, IBD, Product names, NAFDAC Reg No, Source (several names
            or numbers separated by ";").
          </span>
        </div>

        {draft ? (
          <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
            {(
              [
                ["activeSubstance", "Active substance", "e.g. Amoxicillin / clavulanic acid"],
                ["ibd", "International Birth Date", "e.g. 17 March 2014"],
                [
                  "productNames",
                  "Product names (separate with ;)",
                  "e.g. Amoxiclav 625; Augmentin",
                ],
                ["nafdacRegNos", "NAFDAC Reg. Nos (separate with ;)", "e.g. A4-100123"],
                ["source", "Source of the IBD", "e.g. Company declaration, EU reference date list"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`ibd-${key}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`ibd-${key}`}
                  value={draft[key]}
                  placeholder={placeholder}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No IBDs registered yet. Add them here, or from a PSUR page where a product is not yet in
            the register.
          </p>
        ) : (
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Active substance</th>
                  <th>IBD</th>
                  <th>Products</th>
                  <th>NAFDAC Reg. No.</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="py-1.5 font-medium">{e.activeSubstance}</td>
                    <td className="mono-num">{showDate(e.ibd)}</td>
                    <td>{e.productNames.join("; ") || "—"}</td>
                    <td>{e.nafdacRegNos.join("; ") || "—"}</td>
                    <td>
                      {e.source || "—"}
                      <span className="block text-muted-foreground">
                        {e.by} · {new Date(e.at).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setDraft({
                            id: e.id,
                            activeSubstance: e.activeSubstance,
                            ibd: showDate(e.ibd),
                            productNames: e.productNames.join("; "),
                            nafdacRegNos: e.nafdacRegNos.join("; "),
                            source: e.source,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(e)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} total={shown.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </Section>
  );
}
