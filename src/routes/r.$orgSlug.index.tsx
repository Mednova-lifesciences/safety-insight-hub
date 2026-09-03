import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pill, Search, ShieldCheck } from "lucide-react";
import { getOrganizationBySlug } from "@/services/api/organizations";
import { products as productsApi } from "@/services/api/products";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/pv/primitives";

export const Route = createFileRoute("/r/$orgSlug/")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Report a case — MedNova PV Assist" }],
  }),
  component: DrugPickerPage,
});

function DrugPickerPage() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const orgQuery = useQuery({
    queryKey: ["public-org", orgSlug],
    queryFn: () => getOrganizationBySlug(orgSlug),
  });

  const drugsQuery = useQuery({
    queryKey: ["public-products", orgQuery.data?.id],
    queryFn: () => productsApi.listPublic(orgQuery.data!.id),
    enabled: !!orgQuery.data,
  });

  const filtered = useMemo(() => {
    const drugs = drugsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return drugs;
    return drugs.filter(
      (d) => d.name.toLowerCase().includes(q) || d.activeIngredient?.toLowerCase().includes(q),
    );
  }, [drugsQuery.data, search]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur">
        <ShieldCheck className="size-5 text-primary" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">MedNova</p>
          <p className="text-[11px] tracking-wide text-muted-foreground">PV ASSIST</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {orgQuery.isPending ? (
          <LoadingState label="Loading" />
        ) : !orgQuery.data ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-6 text-center">
            <p className="text-sm font-medium text-destructive">This reporting link isn't valid.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Double-check the link with your PV manager.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-foreground">{orgQuery.data.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Search for the drug you'd like to report a case for. No account is needed.
            </p>

            <div className="relative mt-6">
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
              {drugsQuery.isPending ? (
                <LoadingState label="Loading drug list" />
              ) : filtered.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
                  <Pill className="mx-auto mb-2 size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {(drugsQuery.data?.length ?? 0) === 0
                      ? "No drugs have been added to this company's catalog yet."
                      : "No drugs match your search."}
                  </p>
                </div>
              ) : (
                filtered.map((drug) => (
                  <button
                    key={drug.id}
                    type="button"
                    onClick={() =>
                      navigate({
                        to: "/r/$orgSlug/report",
                        params: { orgSlug },
                        search: { productId: drug.id },
                      })
                    }
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
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </main>

      <footer className="px-6 py-4 text-center text-xs text-muted-foreground">
        Need staff access instead?{" "}
        <Link to="/auth" className="underline">
          Sign in
        </Link>
        .
      </footer>
    </div>
  );
}
