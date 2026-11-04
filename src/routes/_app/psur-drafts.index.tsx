import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PageHeader, Paged, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { DraftsNotSetUpError, psurDrafts } from "@/services/psur/draft/drafts";
import { draftReadiness } from "@/services/psur/draft/status";
import { longDate, intervalFrom } from "@/services/psur/draft/content";

export const Route = createFileRoute("/_app/psur-drafts/")({
  head: () => ({
    meta: [
      { title: "PSUR drafts — MedNova PV Assist" },
      { name: "description", content: "PSURs being written for own-brand products." },
    ],
  }),
  component: () => (
    <PermissionGate permission="team.view">
      <DraftsPage />
    </PermissionGate>
  ),
});

function DraftsPage() {
  const query = useQuery({
    queryKey: ["psur-drafts"],
    queryFn: () => psurDrafts.list(),
    retry: (count, err) => !(err instanceof DraftsNotSetUpError) && count < 2,
  });
  return (
    <>
      <PageHeader
        title="PSUR drafts"
        description="PSURs being written for your own-brand products. Start one from the PSUR calendar."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/psur-calendar">
              <CalendarClock className="size-4" /> PSUR calendar
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        {query.error ? (
          <div className="flex gap-2 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 text-warning" />
            {query.error.message}
          </div>
        ) : null}
        {query.isPending ? <p className="text-sm text-muted-foreground">Loading drafts…</p> : null}
        {query.data ? (
          <Section title={`${query.data.length} draft${query.data.length === 1 ? "" : "s"}`}>
            {query.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No drafts yet. Open the PSUR calendar and choose <strong>Start PSUR draft</strong>{" "}
                on an own-brand product.
              </p>
            ) : (
              <Paged items={query.data}>
                {(pageDrafts) => (
                  <ul className="divide-y divide-border">
                    {pageDrafts.map((d) => {
                      const r = draftReadiness(d);
                      return (
                        <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                          <Link
                            to="/psur-drafts/$draftId"
                            params={{ draftId: d.id }}
                            className="font-medium text-primary hover:underline"
                          >
                            {d.productName}
                          </Link>
                          <span className="text-sm text-muted-foreground">
                            {longDate(intervalFrom(d))} – {longDate(d.dlp)}
                          </span>
                          <StatusPill tone={r.cleanAllowed ? "success" : "neutral"}>
                            {r.done} of {r.total} sections done
                          </StatusPill>
                          {d.status === "SENT_TO_QC" ? (
                            <StatusPill tone="info">Sent to QC</StatusPill>
                          ) : null}
                          <span className="ml-auto text-xs text-muted-foreground">
                            Updated {d.updatedAt.slice(0, 16).replace("T", " ")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Paged>
            )}
          </Section>
        ) : null}
      </div>
    </>
  );
}
