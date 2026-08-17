import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { audit as auditApi } from "@/services/api/audit";
import { demoAudit } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { PageHeader, QueryBoundary, Section, SourceTag } from "@/components/pv/primitives";
import { AuditTimeline } from "@/components/pv/audit-timeline";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/audit")({
  head: () => ({
    meta: [
      { title: "Audit trail — MedNova PV Assist" },
      { name: "description", content: "Append-only record of regulated actions: case edits, seriousness reviews, coding decisions, signal outcomes and E2B generation." },
      { property: "og:title", content: "Audit trail — MedNova PV Assist" },
      { property: "og:description", content: "Full audit history across the pharmacovigilance platform." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const query = usePvQuery(["audit", "all"], () => auditApi.list({ limit: 200 }), () => demoAudit);
  const [q, setQ] = useState("");
  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every meaningful regulated action writes an immutable audit event server-side."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
      />
      <div className="space-y-4 p-6">
        <div className="panel p-3">
          <label className="label-caps" htmlFor="audit-search">Filter</label>
          <Input
            id="audit-search"
            className="mt-1 max-w-md"
            placeholder="User, action, entity or entity ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Section title="Activity">
          <QueryBoundary query={query}>
            {(events) => (
              <AuditTimeline
                events={events.filter((e) =>
                  `${e.user} ${e.role} ${e.action} ${e.entity} ${e.entityId}`.toLowerCase().includes(q.toLowerCase()),
                )}
              />
            )}
          </QueryBoundary>
        </Section>
      </div>
    </>
  );
}
