import { Link, createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { intake as intakeApi } from "@/services/api/intake";
import { demoConversations } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import type { IntakeConversation } from "@/types/pv";

export const Route = createFileRoute("/_app/intake/")({
  head: () => ({
    meta: [
      { title: "Inbound intake — MedNova PV Assist" },
      { name: "description", content: "WhatsApp and inbound reporting inbox with minimum ICSR criteria, consent status and missing information." },
      { property: "og:title", content: "Inbound intake — MedNova PV Assist" },
      { property: "og:description", content: "Qualify inbound reports before creating an individual case safety report." },
    ],
  }),
  component: IntakeInbox,
});

export function CriteriaChips({ c }: { c: IntakeConversation["criteria"] }) {
  const items: [string, boolean][] = [
    ["Reporter", c.reporter],
    ["Patient", c.patient],
    ["Product", c.product],
    ["Event", c.event],
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([label, ok]) => (
        <StatusPill key={label} tone={ok ? "success" : "warning"}>
          {label}
        </StatusPill>
      ))}
    </div>
  );
}

function IntakeInbox() {
  const query = usePvQuery(["intake"], () => intakeApi.conversations(), () => demoConversations);

  return (
    <>
      <PageHeader
        title="Inbound intake"
        description="Conversations received from reporters. A case is only created when a human confirms the minimum ICSR criteria."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
      />
      <div className="p-6">
        <Section title="Conversations">
          <QueryBoundary query={query} loadingLabel="Loading conversations">
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No inbound conversations" />
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((c) => {
                    const complete = Object.values(c.criteria).every(Boolean);
                    return (
                      <li key={c.id} className="py-3">
                        <Link
                          to="/intake/$conversationId"
                          params={{ conversationId: c.id }}
                          className="flex flex-wrap items-start gap-3 rounded-md px-2 py-1 hover:bg-muted/60"
                        >
                          <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{c.reporterName}</span>
                              <span className="mono-num text-xs text-muted-foreground">{c.reporterNumberMasked}</span>
                              <StatusPill tone={c.consent === "GRANTED" ? "success" : c.consent === "DECLINED" ? "critical" : "warning"}>
                                consent {c.consent.toLowerCase()}
                              </StatusPill>
                              <StatusPill tone={c.status === "CONVERTED" ? "success" : c.status === "NEW" ? "info" : "neutral"}>
                                {c.status.replaceAll("_", " ").toLowerCase()}
                              </StatusPill>
                            </div>
                            <p className="mt-1 truncate text-sm text-muted-foreground">{c.lastMessage}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <CriteriaChips c={c.criteria} />
                              <StatusPill tone={complete ? "success" : "warning"}>
                                {complete ? "Minimum ICSR information available" : "Minimum criteria incomplete"}
                              </StatusPill>
                              {c.linkedCaseId ? (
                                <span className="mono-num text-xs text-muted-foreground">→ {c.linkedCaseId}</span>
                              ) : null}
                            </div>
                          </div>
                          <span className="mono-num text-xs text-muted-foreground">
                            {c.lastMessageAt.replace("T", " ").slice(0, 16)} UTC
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </QueryBoundary>
        </Section>
      </div>
    </>
  );
}
