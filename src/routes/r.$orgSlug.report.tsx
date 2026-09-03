import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getOrganizationBySlug } from "@/services/api/organizations";
import { products as productsApi } from "@/services/api/products";
import { createPublicCase } from "@/services/api/public-intake";
import { IcsrIntakeForm } from "@/components/pv/icsr-intake-form";
import { LoadingState } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";

interface ReportSearch {
  productId: string;
}

export const Route = createFileRoute("/r/$orgSlug/report")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ReportSearch => ({
    productId: typeof search["productId"] === "string" ? search["productId"] : "",
  }),
  head: () => ({
    meta: [{ title: "Report an ICSR — MedNova PV Assist" }],
  }),
  component: PublicReportPage,
});

function PublicReportPage() {
  const { orgSlug } = Route.useParams();
  const { productId } = Route.useSearch();
  const navigate = useNavigate();

  const orgQuery = useQuery({
    queryKey: ["public-org", orgSlug],
    queryFn: () => getOrganizationBySlug(orgSlug),
  });

  const drugsQuery = useQuery({
    queryKey: ["public-products", orgQuery.data?.id],
    queryFn: () => productsApi.listPublic(orgQuery.data!.id),
    enabled: !!orgQuery.data,
  });

  const backToPicker = () => navigate({ to: "/r/$orgSlug", params: { orgSlug } });

  if (orgQuery.isPending || drugsQuery.isPending) {
    return (
      <div className="p-10">
        <LoadingState label="Loading" />
      </div>
    );
  }

  const org = orgQuery.data;
  const drug = drugsQuery.data?.find((d) => d.id === productId);

  if (!org || !drug) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-sm font-medium">
          {!org ? "This reporting link isn't valid." : "That drug could no longer be found."}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={backToPicker}>
          <ArrowLeft className="size-4" /> Back to drug list
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={backToPicker}>
          <ArrowLeft className="size-4" /> Change drug
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <span className="text-sm font-semibold">{org.name}</span>
        </div>
      </header>

      <IcsrIntakeForm
        lockedProduct={drug}
        onChangeDrug={backToPicker}
        submitOverride={(payload) => createPublicCase(org.id, payload)}
      />
    </div>
  );
}
