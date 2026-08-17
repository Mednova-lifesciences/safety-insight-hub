import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";
import { intake as intakeApi } from "@/services/api/intake";
import { demoConversationDetails } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import {
  Field,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/intake/$conversationId")({
  head: () => ({
    meta: [
      { title: "Conversation — MedNova PV Assist" },
      { name: "description", content: "Inbound conversation with extracted information, missing fields and ICSR qualification." },
      { property: "og:title", content: "Conversation — MedNova PV Assist" },
      { property: "og:description", content: "Qualify an inbound safety report and convert it into an ICSR." },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const query = usePvQuery(
    ["intake", conversationId],
    () => intakeApi.conversation(conversationId),
    () => demoConversationDetails[conversationId] ?? Object.values(demoConversationDetails)[0]!,
  );

  return (
    <QueryBoundary query={query} loadingLabel="Loading conversation">
      {(c, source) => {
        const complete = Object.values(c.criteria).every(Boolean);
        return (
          <>
            <PageHeader
              title={c.reporterName}
              description={`WhatsApp intake · ${c.reporterNumberMasked}`}
              meta={
                <>
                  <StatusPill tone={c.consent === "GRANTED" ? "success" : "warning"}>
                    Consent {c.consent.toLowerCase()}
                  </StatusPill>
                  <StatusPill tone={complete ? "success" : "warning"}>
                    {complete ? "Minimum ICSR information available" : "Minimum criteria incomplete"}
                  </StatusPill>
                  <SourceTag source={source} />
                </>
              }
              actions={
                <Button asChild variant="outline" size="sm">
                  <Link to="/intake">
                    <ArrowLeft className="size-4" /> Inbox
                  </Link>
                </Button>
              }
            />

            <div className="grid gap-4 p-6 xl:grid-cols-[1.3fr_1fr]">
              <Section title="Messages">
                <ul className="space-y-3">
                  {c.messages.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        "max-w-[85%] rounded-lg border px-3 py-2",
                        m.direction === "INBOUND"
                          ? "border-border bg-muted"
                          : "ml-auto border-primary/30 bg-accent",
                      )}
                    >
                      <p className="text-sm">{m.body}</p>
                      <p className="mono-num mt-1 text-[11px] text-muted-foreground">
                        {m.direction.toLowerCase()} · {m.at.replace("T", " ").slice(0, 16)} UTC
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>

              <div className="space-y-4">
                <Section title="Minimum ICSR criteria">
                  <ul className="space-y-2">
                    {(
                      [
                        ["Identifiable reporter", c.criteria.reporter],
                        ["Identifiable patient", c.criteria.patient],
                        ["Suspect product", c.criteria.product],
                        ["Adverse event", c.criteria.event],
                      ] as [string, boolean][]
                    ).map(([label, ok]) => (
                      <li key={label} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                        <StatusPill tone={ok ? "success" : "warning"}>{ok ? "Present" : "Missing"}</StatusPill>
                        {label}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!complete}
                      onClick={async () => {
                        try {
                          const res = await intakeApi.convertToIcsr(c.id);
                          toast.success(`Case ${res.caseId} created from conversation.`);
                          navigate({ to: "/cases/$caseId", params: { caseId: res.caseId } });
                        } catch (err) {
                          toast.error(
                            isNotConfigured(err)
                              ? "Backend not connected — no case was created."
                              : "Conversion failed. No case was created.",
                          );
                        }
                      }}
                    >
                      <Send className="size-4" /> Create ICSR
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await intakeApi.requestInformation(c.id, c.missing, "Please provide the missing details.");
                          toast.success("Information request sent and recorded.");
                        } catch (err) {
                          toast.error(
                            isNotConfigured(err)
                              ? "Backend not connected — no message was sent."
                              : "The request could not be sent.",
                          );
                        }
                      }}
                    >
                      <MessageCircleQuestion className="size-4" /> Request information
                    </Button>
                  </div>
                </Section>

                <Section title="Extracted information" description="Values located in the conversation. Confirm each before case creation.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {c.extracted.map((e) => (
                      <Field key={e.field} label={e.field} value={e.value} />
                    ))}
                  </div>
                </Section>

                <Section title="Missing information">
                  {c.missing.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {c.missing.map((m) => (
                        <StatusPill key={m} tone="warning">{m}</StatusPill>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}
