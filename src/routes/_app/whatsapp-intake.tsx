import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, MessageCircle, RotateCcw, ShieldAlert } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { isNotConfigured } from "@/services/api/client";
import { PageHeader, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/whatsapp-intake")({
  head: () => ({
    meta: [
      { title: "WhatsApp intake — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Simulated WhatsApp reporting conversation with guided reviewer actions, ending in a real auditable ICSR.",
      },
      { property: "og:title", content: "WhatsApp intake — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Guided WhatsApp intake simulation for field associates and coordinators.",
      },
    ],
  }),
  component: WhatsAppIntakePage,
});

interface ChatMessage {
  id: number;
  from: "reporter" | "staff" | "system";
  text: string;
  at: Date;
}

const REPORTER_FIRST = "Unknown reporter";
const REPORTER_FULL = "Kemi Tijani";
const REPORTER_NUMBER = "+234 802 966 2269";

const R_INTRO_1 = "Good afternoon. I am a nurse at a clinic in Ikeja.";
const R_INTRO_2 =
  "A patient took Astymin Forte yesterday and now has swelling of the face and difficulty breathing.";
const R_INTRO_3 = "We referred her to the hospital this morning.";

const STAFF_INFO_REQUEST =
  "Thank you for the report. To register this safety report we still need: your full name; the patient's initials, age and sex; and the exact medicine name with its batch number. Please reply with these details.";
const R_INFO_REPLY =
  "My name is Kemi Tijani, and you can reach me on this number. The patient's initials are A.S., she is 34 years old. The medicine is Astymin Forte syrup, batch number AF-2209.";

const STAFF_CONSENT_REQUEST =
  "Thank you, Nurse Tijani. One more thing: do you consent to the information you have provided being used for drug safety monitoring and regulatory reporting, in line with the NDPR?";
const R_CONSENT_REPLY = "Yes, I consent to my information being used for drug safety monitoring.";

const STAFF_NOT_REPORTABLE =
  "Thank you for reaching out. Based on the information provided, this report does not meet the criteria for an individual case safety report, so no case record will be created. Please contact us again if anything changes or if the patient's condition changes.";

const NARRATIVE =
  "Nurse Kemi Tijani (clinic in Ikeja, reachable on +234 802 966 2269) reported that a 34-year-old female patient (initials A.S.) took Astymin Forte syrup (batch AF-2209) yesterday for anaemia and developed facial swelling with difficulty breathing (suspected angioedema). She was referred to the hospital this morning; outcome not yet recovered. Received via WhatsApp.";

const CRITERIA: { key: string; label: string }[] = [
  { key: "reporter", label: "Identifiable reporter" },
  { key: "patient", label: "Identifiable patient" },
  { key: "product", label: "Suspect product" },
  { key: "event", label: "Adverse event" },
];

function WhatsAppIntakePage() {
  const [nonce, setNonce] = useState(0);
  return <WhatsAppIntakeDemo key={nonce} onReset={() => setNonce((n) => n + 1)} />;
}

function WhatsAppIntakeDemo({ onReset }: { onReset: () => void }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [infoRequested, setInfoRequested] = useState(false);
  const [infoComplete, setInfoComplete] = useState(false);
  const [consentRequested, setConsentRequested] = useState(false);
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [seriousness, setSeriousness] = useState<"SERIOUS" | "NON_SERIOUS" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const idRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const aliveRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = (from: ChatMessage["from"], text: string) => {
    const id = ++idRef.current;
    setMessages((prev) => [...prev, { id, from, text, at: new Date() }]);
  };

  const wait = (ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = window.setTimeout(() => resolve(aliveRef.current), ms);
      timersRef.current.push(t);
    });

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      if (!(await wait(500))) return;
      setTyping(true);
      if (!(await wait(1100))) return;
      setTyping(false);
      push("reporter", R_INTRO_1);
      if (!(await wait(1300))) return;
      setTyping(true);
      if (!(await wait(1400))) return;
      setTyping(false);
      push("reporter", R_INTRO_2);
      if (!(await wait(1300))) return;
      setTyping(true);
      if (!(await wait(1200))) return;
      setTyping(false);
      push("reporter", R_INTRO_3);
      setIntroDone(true);
    })();
    return () => {
      aliveRef.current = false;
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  const criteriaMet: Record<string, boolean> = {
    reporter: infoComplete,
    patient: infoComplete,
    product: introDone,
    event: introDone,
  };
  const metCount = CRITERIA.filter((c) => criteriaMet[c.key]).length;
  const canCreate =
    introDone &&
    infoComplete &&
    consentRecorded &&
    seriousness !== null &&
    !closed &&
    !busy &&
    !creating;

  async function requestInfo() {
    if (busy || closed || infoRequested) return;
    setBusy(true);
    setInfoRequested(true);
    push("staff", STAFF_INFO_REQUEST);
    setTyping(true);
    if (!(await wait(1900))) return;
    setTyping(false);
    push("reporter", R_INFO_REPLY);
    setInfoComplete(true);
    setBusy(false);
  }

  async function requestConsent() {
    if (busy || closed || consentRecorded || consentRequested) return;
    setBusy(true);
    setConsentRequested(true);
    push("staff", STAFF_CONSENT_REQUEST);
    setTyping(true);
    if (!(await wait(1700))) return;
    setTyping(false);
    push("reporter", R_CONSENT_REPLY);
    setConsentRecorded(true);
    setBusy(false);
  }

  function classify(value: "SERIOUS" | "NON_SERIOUS") {
    if (busy || closed || seriousness) return;
    setSeriousness(value);
    push(
      "system",
      value === "SERIOUS"
        ? "Reviewer classified this report as SERIOUS — hospitalisation required. A qualified PV reviewer must confirm the regulatory seriousness classification."
        : "Reviewer classified this report as NON-SERIOUS.",
    );
  }

  function confirmMinimum() {
    if (busy || closed || confirmed || metCount < CRITERIA.length) return;
    setConfirmed(true);
    push("system", "Minimum ICSR criteria confirmed by reviewer — all four elements captured.");
  }

  function notReportable() {
    if (busy || closed) return;
    setClosed(true);
    push("staff", STAFF_NOT_REPORTABLE);
    push("system", "Conversation closed as not reportable — no case record will be created.");
  }

  async function createCase() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const created = await casesApi.create({
        reporter: {
          name: REPORTER_FULL,
          qualification: "Nurse",
          country: "Nigeria",
          contact: REPORTER_NUMBER,
        },
        patient: {
          identifier: "A.S.",
          age: "34",
          sex: "FEMALE",
          weightKg: "",
          medicalHistory: "Anaemia — reported by the caller",
        },
        product: {
          reportedName: "Astymin Forte",
          dose: "",
          route: "Oral",
          indication: "Anaemia",
          therapyStart: "",
          action: "Dose not changed",
          batchNumber: "AF-2209",
          expiryDate: "",
        },
        reaction: {
          reportedTerm: "Angioedema",
          onsetDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
          outcome: "NOT_RECOVERED",
        },
        narrative: NARRATIVE,
        reportedSeriousness: seriousness ?? "UNASSESSED",
        seriousnessCriteria:
          seriousness === "SERIOUS" ? ["Requires or prolongs hospitalisation"] : [],
        additionalInformation: "Captured via the WhatsApp intake channel (simulated demo).",
        additionalProducts: [],
        concomitantMedicines: [],
        dynamicFields: [],
      });
      push("system", `Case ${created.caseId} created from this WhatsApp conversation.`);
      toast.success(`Case ${created.caseId} created from WhatsApp intake.`);
      navigate({ to: "/cases/$caseId", params: { caseId: created.caseId } });
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the case was not created."
          : "The case could not be created. Nothing was saved.",
      );
    } finally {
      setCreating(false);
    }
  }

  const reporterName = infoComplete ? REPORTER_FULL : REPORTER_FIRST;

  return (
    <>
      <PageHeader
        title="WhatsApp intake"
        description="Simulated WhatsApp conversation with a scripted reporter. Reviewer actions send real messages, criteria update live, and creating the ICSR is a genuine, auditable case creation."
        actions={
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="size-4" /> New simulation
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="rounded-md border border-info/30 bg-info-soft px-3 py-2 text-xs text-foreground">
          All WhatsApp reports require human PV review before entering the formal case record.
          Nothing here is auto-submitted or auto-coded — this channel feeds the Case Workbench, it
          never bypasses it.
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="panel h-fit p-3">
            <p className="label-caps mb-2 px-1">Conversations</p>
            <div
              className={cn(
                "cursor-pointer rounded-md border px-3 py-2.5 transition-colors",
                "border-primary bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {reporterName} <span className="text-muted-foreground">(simulated)</span>
                </span>
                <span className="mono-num shrink-0 text-[10px] text-muted-foreground">
                  Just now
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{REPORTER_NUMBER}</p>
              <div className="mt-1.5">
                <StatusPill tone={closed ? "neutral" : canCreate ? "success" : "warning"}>
                  {closed ? "Not reportable" : canCreate ? "Ready to convert" : "New"}
                </StatusPill>
              </div>
            </div>
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
              Demo channel — the reporter's replies are scripted. Your actions and the created case
              are real.
            </p>
          </aside>

          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageCircle className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {reporterName}{" "}
                  <span className="font-normal text-muted-foreground">(simulated)</span>
                </p>
                <p className="mono-num truncate text-xs text-muted-foreground">
                  {REPORTER_NUMBER} · Healthcare Professional
                </p>
              </div>
              <StatusPill tone="assist" className="ml-auto">
                Demo channel
              </StatusPill>
            </div>

            <div className="space-y-3 border-b border-border px-4 py-3">
              {seriousness === "SERIOUS" ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  Potential serious case detected — triage signal only, expedite review. A qualified
                  PV reviewer must confirm the regulatory seriousness classification.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {CRITERIA.map((c) => (
                  <StatusPill key={c.key} tone={criteriaMet[c.key] ? "success" : "warning"}>
                    {c.label}
                  </StatusPill>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {metCount} of {CRITERIA.length} minimum ICSR criteria met — a valid ICSR needs all
                four before it can be created.
              </p>
              <StatusPill tone={consentRecorded ? "success" : "warning"}>
                Data-use consent (NDPR): {consentRecorded ? "recorded" : "not recorded"}
              </StatusPill>
            </div>

            <div ref={scrollRef} className="max-h-[420px] min-h-[280px] space-y-2.5 overflow-y-auto px-4 py-4">
              {messages.map((m) =>
                m.from === "system" ? (
                  <div
                    key={m.id}
                    className="mx-auto max-w-[90%] rounded-md border border-dashed border-border px-3 py-1.5 text-center text-xs text-muted-foreground"
                  >
                    {m.text}
                  </div>
                ) : (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.from === "staff" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[78%] rounded-lg px-3 py-2 text-sm",
                        m.from === "staff"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm border border-border bg-muted text-foreground",
                      )}
                    >
                      <p>{m.text}</p>
                      <p
                        className={cn(
                          "mono-num mt-1 text-[10px]",
                          m.from === "staff" ? "text-primary-foreground/70" : "text-muted-foreground",
                        )}
                      >
                        {m.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ),
              )}
              {typing ? (
                <div className="flex justify-start">
                  <div className="rounded-lg rounded-bl-sm border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                    <span className="animate-pulse">{reporterName} is typing…</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-border px-4 py-3">
              <p className="label-caps mb-2">Extracted for PV review — confirm before creating case</p>
              <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Product: </span>
                  <span className="font-medium">{introDone ? "Astymin Forte" : "—"}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Suspected term: </span>
                  <span className="font-medium">{introDone ? "Angioedema" : "—"}</span>
                </p>
              </div>
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">Draft narrative: </span>
                {introDone ? NARRATIVE : "Waiting for the reporter's opening messages…"}
              </p>
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">Reviewer seriousness decision: </span>
                <span className="font-medium">
                  {seriousness ? (seriousness === "SERIOUS" ? "Serious" : "Non-serious") : "Not yet decided"}
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed || infoRequested || !introDone}
                onClick={requestInfo}
              >
                Request missing info
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed || consentRecorded || consentRequested}
                onClick={requestConsent}
              >
                Request consent confirmation
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed || seriousness !== null}
                onClick={() => classify("SERIOUS")}
              >
                <AlertTriangle className="size-4" /> Classify serious
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed || seriousness !== null}
                onClick={() => classify("NON_SERIOUS")}
              >
                Classify non-serious
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed || confirmed || metCount < CRITERIA.length}
                onClick={confirmMinimum}
              >
                Confirm minimum information
              </Button>
              <Button size="sm" variant="ghost" disabled={busy || closed} onClick={notReportable}>
                Not reportable
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                disabled={!canCreate}
                onClick={createCase}
              >
                {creating ? "Creating…" : "Create minimum-information ICSR"}
              </Button>
            </div>

            <div className="border-t border-border px-4 py-2.5 text-[11px] italic text-muted-foreground">
              Conversion requires all four minimum criteria, recorded NDPR consent and a reviewer
              seriousness decision.
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
