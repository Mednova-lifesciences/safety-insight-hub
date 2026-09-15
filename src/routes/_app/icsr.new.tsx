import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pill, Search } from "lucide-react";
import { IcsrIntakeForm } from "@/components/pv/icsr-intake-form";
import { products as productsApi, type CatalogDrug } from "@/services/api/products";
import { demoProducts } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { EmptyState, PageHeader, QueryBoundary } from "@/components/pv/primitives";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/icsr/new")({
  head: () => ({
    meta: [
      { title: "New ICSR — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Capture a new individual case safety report with the minimum criteria required for a valid ICSR.",
      },
      { property: "og:title", content: "New ICSR — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Structured ICSR intake with validation, triage and coding hand-off.",
      },
    ],
  }),
  component: NewIcsrPage,
});

function NewIcsrPage() {
  // Every role that can reach this page must pick the suspect drug from the
  // organization's own catalog first, so what lands on the report is always
  // a product the org actually deals in, not whatever was typed. Locking the
  // product also keeps this consistent with the public field-associate flow
  // (/r/:orgSlug), which works the same way.
  //
  // The old ADMIN role was exempted from that and kept a free-text form.
  // The three roles that replaced it are NAFDAC assessors who hold no
  // case.create permission and do not file reports at all, so the exemption
  // had nobody left to apply to and is gone rather than reassigned.
  return <DrugPickerThenForm />;
}

function DrugPickerThenForm() {
  const [selected, setSelected] = useState<CatalogDrug | null>(null);
  if (selected) {
    return <IcsrIntakeForm lockedProduct={selected} onChangeDrug={() => setSelected(null)} />;
  }
  return <DrugPicker onPick={setSelected} />;
}

function DrugPicker({ onPick }: { onPick: (drug: CatalogDrug) => void }) {
  const [search, setSearch] = useState("");
  const query = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );

  return (
    <>
      <PageHeader
        title="New ICSR"
        description="Pick the suspect drug this report is about — search or browse your organization's catalog."
      />
      <div className="p-6">
        <QueryBoundary query={query} loadingLabel="Loading drug catalog">
          {(drugs) => {
            const q = search.trim().toLowerCase();
            const filtered = q
              ? drugs.filter(
                  (d) =>
                    d.name.toLowerCase().includes(q) ||
                    d.activeIngredient?.toLowerCase().includes(q),
                )
              : drugs;
            return (
              <div className="mx-auto max-w-xl">
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Search drugs…"
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="mt-4 space-y-2">
                  {drugs.length === 0 ? (
                    <EmptyState
                      title="No drugs in the catalog yet"
                      description="Ask your PV manager to add drugs to the catalog before filing an ICSR."
                    />
                  ) : filtered.length === 0 ? (
                    <EmptyState title="No drugs match your search" />
                  ) : (
                    filtered.map((drug) => (
                      <button
                        key={drug.id}
                        type="button"
                        onClick={() => onPick(drug)}
                        className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{drug.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {[drug.activeIngredient, drug.strength, drug.route]
                              .filter(Boolean)
                              .join(" · ") || "No further detail"}
                          </p>
                        </div>
                        <Pill className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          }}
        </QueryBoundary>
      </div>
    </>
  );
}
