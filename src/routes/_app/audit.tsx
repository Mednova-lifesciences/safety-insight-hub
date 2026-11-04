import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { audit as auditApi } from "@/services/api/audit";
import { demoAudit } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  PageHeader,
  Pager,
  QueryBoundary,
  Section,
  SourceTag,
  paginate,
} from "@/components/pv/primitives";
import { AuditTimeline } from "@/components/pv/audit-timeline";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/pv/permission-gate";

export const Route = createFileRoute("/_app/audit")({
  head: () => ({
    meta: [
      { title: "Audit trail — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Append-only record of regulated actions: case edits, seriousness reviews, coding decisions, signal outcomes and E2B generation.",
      },
      { property: "og:title", content: "Audit trail — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Full audit history across the pharmacovigilance platform.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="audit.view.all">
      <AuditPage />
    </PermissionGate>
  ),
});

/** How many of the newest events are read; the filter searches these. */
const AUDIT_READ_LIMIT = 200;

function AuditPage() {
  const query = usePvQuery(
    ["audit", "all"],
    () => auditApi.list({ limit: AUDIT_READ_LIMIT }),
    () => demoAudit,
  );
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every meaningful regulated action writes an immutable audit event server-side."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
      />
      <div className="space-y-4 p-6">
        <div className="panel p-3">
          <label className="label-caps" htmlFor="audit-search">
            Filter
          </label>
          <Input
            id="audit-search"
            className="mt-1 max-w-md"
            placeholder="User, action, entity or entity ID"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Section
          title="Activity"
          description={`The ${AUDIT_READ_LIMIT} most recent events, newest first, 10 to a page.`}
        >
          <QueryBoundary query={query}>
            {(events) => {
              const matching = events.filter((e) =>
                `${e.user} ${e.role} ${e.action} ${e.entity} ${e.entityId}`
                  .toLowerCase()
                  .includes(q.toLowerCase()),
              );
              const pageCount = Math.max(1, Math.ceil(matching.length / 10));
              const shownPage = Math.min(page, pageCount);
              return (
                <div className="space-y-3">
                  <AuditTimeline events={paginate(matching, shownPage)} />
                  <Pager page={shownPage} total={matching.length} onPageChange={setPage} />
                </div>
              );
            }}
          </QueryBoundary>
        </Section>
      </div>
    </>
  );
}
