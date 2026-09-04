import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MessageCircle, Send, Trash2, XCircle } from "lucide-react";
import {
  whatsapp,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from "@/services/api/whatsapp";
import { isNotConfigured } from "@/services/api/client";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/auth";
import { usePvQuery } from "@/lib/data-source";
import { PageHeader, QueryBoundary, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/whatsapp-intake")({
  validateSearch: (search: Record<string, unknown>) => ({
    conversation: typeof search["conversation"] === "string" ? search["conversation"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "WhatsApp intake — MedNova PV Assist" },
      {
        name: "description",
        content: "Live WhatsApp adverse-event intake conducted by AI, reviewed by staff before any ICSR is created.",
      },
    ],
  }),
  component: WhatsAppIntakePage,
});

const STATUS_TONE = {
  OPEN: "warning",
  READY_FOR_REVIEW: "success",
  CONVERTED: "neutral",
  CLOSED: "neutral",
} as const;

const STATUS_LABEL = {
  OPEN: "In progress",
  READY_FOR_REVIEW: "Ready for review",
  CONVERTED: "Converted",
  CLOSED: "Closed",
} as const;

function WhatsAppIntakePage() {
  const { conversation: conversationIdFromUrl } = Route.useSearch();
  const [selectedId, setSelectedId] = useState<string | undefined>(conversationIdFromUrl);
  const queryClient = useQueryClient();

  const query = usePvQuery(["whatsapp-conversations"], () => whatsapp.listConversations(), () => []);

  // Keeps the conversation list itself live — a brand new inbound message
  // (a new conversation, or a status change on an existing one) should
  // show up without a manual reload, the same way the open thread already
  // does via its own message-level subscription in ConversationPanel.
  useEffect(() => {
    const channel = supabase
      .channel("intake-conversations-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pv_intake_conversations" },
        () => queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <>
      <PageHeader
        title="WhatsApp intake"
        description="Field reporters message your organization's WhatsApp number. An AI conducts the intake conversation; nothing becomes a case until you review and confirm it."
      />
      <div className="p-6">
        <QueryBoundary query={query} loadingLabel="Loading conversations">
          {(conversations) => (
            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              <aside className="panel h-fit divide-y divide-border">
                <p className="label-caps px-3 py-2">
                  {conversations.length} conversation{conversations.length === 1 ? "" : "s"}
                </p>
                {conversations.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No WhatsApp conversations yet. Share your organization's WhatsApp number to start
                    receiving reports.
                  </p>
                ) : (
                  conversations.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                        selectedId === c.id && "bg-accent",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {c.data.reporter.name || c.data.phoneNumber}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.data.phoneNumber}</p>
                      <div className="mt-1.5">
                        <StatusPill tone={STATUS_TONE[c.data.status]}>{STATUS_LABEL[c.data.status]}</StatusPill>
                      </div>
                    </button>
                  ))
                )}
              </aside>

              {selectedId ? (
                <ConversationPanel
                  key={selectedId}
                  conversationId={selectedId}
                  onClosed={() => setSelectedId(undefined)}
                />
              ) : (
                <div className="panel flex min-h-[300px] items-center justify-center p-6 text-sm text-muted-foreground">
                  Select a conversation to view its messages.
                </div>
              )}
            </div>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}

function mapRealtimeMessage(row: Record<string, unknown>): WhatsAppMessage {
  return {
    id: row["id"] as string,
    conversationId: row["conversation_id"] as string,
    direction: row["direction"] as WhatsAppMessage["direction"],
    sender: row["sender"] as WhatsAppMessage["sender"],
    body: row["body"] as string,
    createdAt: row["created_at"] as string,
  };
}

function ConversationPanel({
  conversationId,
  onClosed,
}: {
  conversationId: string;
  onClosed: () => void;
}) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<WhatsAppConversation | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [conv, msgs] = await Promise.all([
      whatsapp.getConversation(conversationId),
      whatsapp.listMessages(conversationId),
    ]);
    setConversation(conv);
    setMessages(msgs);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch(() => toast.error("Could not load this conversation."))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    const channel = supabase
      .channel(`intake-messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pv_intake_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, mapRealtimeMessage(payload.new as Record<string, unknown>)]);
          // A new AI/reporter message can also change conversation state
          // (status, extracted fields) — refetch that alongside it.
          whatsapp.getConversation(conversationId).then(setConversation).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (loading || !conversation) {
    return <div className="panel min-h-[300px] p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const d = conversation.data;
  const canAct = d.status === "OPEN" || d.status === "READY_FOR_REVIEW";

  async function sendReply() {
    if (!reply.trim() || !user) return;
    setSending(true);
    try {
      await whatsapp.sendStaffReply(conversation!, reply.trim(), user.id);
      setReply("");
    } catch (err) {
      toast.error(
        isNotConfigured(err) ? "Backend not connected — the message was not sent." : "Could not send the message.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessageCircle className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{d.reporter.name || "Unnamed reporter"}</p>
          <p className="mono-num truncate text-xs text-muted-foreground">{d.phoneNumber}</p>
        </div>
        <StatusPill tone={STATUS_TONE[d.status]} className="ml-auto">
          {STATUS_LABEL[d.status]}
        </StatusPill>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-medium">Auto-respond</p>
          <p className="text-xs text-muted-foreground">
            {d.autoRespond ? "The AI is replying automatically." : "Auto-respond is off — you're replying manually."}
          </p>
        </div>
        <Switch
          checked={d.autoRespond}
          onCheckedChange={async (checked) => {
            await whatsapp.setAutoRespond(conversation, checked);
            setConversation({ ...conversation, data: { ...d, autoRespond: checked } });
          }}
        />
      </div>

      <div ref={scrollRef} className="max-h-[360px] min-h-[220px] space-y-2.5 overflow-y-auto px-4 py-4">
        {messages.map((m) =>
          m.direction === "SYSTEM" ? (
            <div
              key={m.id}
              className="mx-auto max-w-[90%] rounded-md border border-dashed border-border px-3 py-1.5 text-center text-xs text-muted-foreground"
            >
              {m.body}
            </div>
          ) : (
            <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[78%] rounded-lg px-3 py-2 text-sm",
                  m.direction === "OUTBOUND"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm border border-border bg-muted text-foreground",
                )}
              >
                <p>{m.body}</p>
                <p
                  className={cn(
                    "mono-num mt-1 text-[10px]",
                    m.direction === "OUTBOUND" ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {m.sender} · {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ),
        )}
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No messages yet.</p>
        ) : null}
      </div>

      {!d.autoRespond ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Textarea
            rows={1}
            placeholder="Type a reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="min-h-9 resize-none"
          />
          <Button size="sm" disabled={sending || !reply.trim()} onClick={sendReply}>
            <Send className="size-4" />
          </Button>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border px-4 py-3">
        <p className="label-caps">Extracted for review</p>
        <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Reporter: </span>
            <span className="font-medium">{d.reporter.name || "—"}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Patient: </span>
            <span className="font-medium">{d.patient.identifier || "—"}</span>
          </p>
        </div>
        {d.suspectProducts.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Suspect products</p>
            {d.suspectProducts.map((p, i) => (
              <p key={i} className="text-sm">
                {p.reportedName}
                {p.dose ? ` · ${p.dose}` : ""}
                {p.batchNumber ? ` · batch ${p.batchNumber}` : ""}
              </p>
            ))}
          </div>
        ) : null}
        {d.reactions.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Reactions</p>
            {d.reactions.map((r, i) => (
              <p key={i} className="text-sm">
                {r.reportedTerm}
                {r.outcome ? ` · ${r.outcome}` : ""}
              </p>
            ))}
          </div>
        ) : null}
        {d.requiredQuestionsStatus.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {d.requiredQuestionsStatus.map((q) => (
              <StatusPill key={q.questionId} tone={q.answered ? "success" : "warning"}>
                {q.answered ? "Answered" : "Pending"}
              </StatusPill>
            ))}
          </div>
        ) : null}
        {d.dynamicFields.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Additional information detected — review before it's included
            </p>
            {d.dynamicFields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                <span className="flex-1">
                  <span className="text-muted-foreground">{f.label}: </span>
                  {f.value || "—"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await whatsapp.dismissDynamicField(conversation, i);
                    setConversation({
                      ...conversation,
                      data: { ...d, dynamicFields: d.dynamicFields.filter((_, idx) => idx !== i) },
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {canAct ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={acting}
            onClick={async () => {
              setActing(true);
              try {
                await whatsapp.terminate(conversation);
                toast.success("Conversation closed — no case created.");
                onClosed();
              } catch {
                toast.error("Could not close this conversation.");
              } finally {
                setActing(false);
              }
            }}
          >
            <XCircle className="size-4" /> Terminate
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            disabled={acting || d.suspectProducts.length === 0}
            onClick={async () => {
              if (!user) return;
              setActing(true);
              try {
                const created = await whatsapp.convertToCase(conversation, user.name);
                toast.success(`Case ${created.caseId} created from this WhatsApp conversation.`);
                navigate({ to: "/cases/$caseId", params: { caseId: created.caseId } });
              } catch (err) {
                toast.error(
                  isNotConfigured(err) ? "Backend not connected — the case was not created." : "Could not create the case.",
                );
              } finally {
                setActing(false);
              }
            }}
          >
            <CheckCircle2 className="size-4" /> Create ICSR
          </Button>
        </div>
      ) : d.linkedCaseId ? (
        <div className="border-t border-border px-4 py-3 text-sm">
          Converted to{" "}
          <button
            className="text-primary underline"
            onClick={() => navigate({ to: "/cases/$caseId", params: { caseId: d.linkedCaseId! } })}
          >
            case {d.linkedCaseId}
          </button>
          .
        </div>
      ) : null}
    </section>
  );
}
