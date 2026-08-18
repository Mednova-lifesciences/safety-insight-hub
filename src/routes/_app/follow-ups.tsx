import { Link, createFileRoute } from "@tanstack/react-router";
import { cases as casesApi } from "@/services/api/cases";
import { demoFollowUps } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { PermissionGate } from "@/components/pv/permission-gate";

export const Route = createFileRoute("/_app/follow-ups")({
  head: () => ({
    meta: [
      { title: "Follow-ups — MedNova PV Assist" },
      { name: "description", content: "Outstanding follow-up information requests to reporters, with due dates and response status." },
      { property: "og:title", content: "Follow-ups — MedNova PV Assist" },
      { property: "og:description", content: "Track reporter information requests across open safety cases." },
    ],
  }),
  component: () => (
    <PermissionGate permission="follow_up.view">
      <FollowUpsPage />
    </PermissionGate>
  ),
});

function FollowUpsPage() {
  const query = usePvQuery(["follow-ups"], () => casesApi.followUps(), () => demoFollowUps);
  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Information requested from reporters to complete or clarify safety cases."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
      />
      <div className="p-6">
        <Section title="Open and recent requests">
          <QueryBoundary query={query}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No follow-up requests" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left">
                        {["Case", "Requested information", "Channel", "Requested by", "Requested", "Due", "Status"].map((h) => (
                          <th key={h} className="label-caps px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((f) => (
                        <tr key={f.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">
                            <Link to="/cases/$caseId" params={{ caseId: f.caseId }} className="mono-num text-primary hover:underline">
                              {f.caseId}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{f.requestedInformation}</td>
                          <td className="px-3 py-2 text-muted-foreground">{f.channel.toLowerCase()}</td>
                          <td className="px-3 py-2">{f.requestedBy}</td>
                          <td className="mono-num px-3 py-2">{f.requestedAt.slice(0, 10)}</td>
                          <td className="mono-num px-3 py-2">{f.dueAt.slice(0, 10)}</td>
                          <td className="px-3 py-2">
                            <StatusPill
                              tone={f.status === "OVERDUE" ? "critical" : f.status === "RESPONDED" ? "success" : f.status === "CLOSED" ? "neutral" : "warning"}
                            >
                              {f.status.toLowerCase()}
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </QueryBoundary>
        </Section>
      </div>
    </>
  );
}
