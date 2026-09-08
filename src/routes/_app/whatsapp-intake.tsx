import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

/** One scripted reporter + case for the demo conversation. A fresh one is
 *  picked at random each time the page loads or "New simulation" is
 *  clicked, so repeat demos don't always show the same Astymin Forte case. */
interface Scenario {
  reporterFull: string;
  /** How staff address them in the consent message, e.g. "Nurse Tijani". */
  addressForm: string;
  qualification: string;
  /** Shown under the reporter name in the chat header. */
  qualificationLabel: string;
  reporterNumber: string;
  intro: [string, string, string];
  infoReply: string;
  patientInitials: string;
  patientAge: string;
  patientSex: "MALE" | "FEMALE";
  medicalHistory: string;
  product: string;
  batchNumber: string;
  route: string;
  indication: string;
  action: string;
  reactionTerm: string;
  onsetDaysAgo: number;
  outcome: "RECOVERED" | "RECOVERING" | "NOT_RECOVERED";
  narrative: string;
}

const SCENARIOS: Scenario[] = [
  {
    reporterFull: "Kemi Tijani",
    addressForm: "Nurse Tijani",
    qualification: "Nurse",
    qualificationLabel: "Healthcare Professional",
    reporterNumber: "+234 802 966 2269",
    intro: [
      "Good afternoon. I am a nurse at a clinic in Ikeja.",
      "A patient took Astymin Forte yesterday and now has swelling of the face and difficulty breathing.",
      "We referred her to the hospital this morning.",
    ],
    infoReply:
      "My name is Kemi Tijani, and you can reach me on this number. The patient's initials are A.S., she is 34 years old. The medicine is Astymin Forte syrup, batch number AF-2209.",
    patientInitials: "A.S.",
    patientAge: "34",
    patientSex: "FEMALE",
    medicalHistory: "Anaemia — reported by the caller",
    product: "Astymin Forte",
    batchNumber: "AF-2209",
    route: "Oral",
    indication: "Anaemia",
    action: "Dose not changed",
    reactionTerm: "Angioedema",
    onsetDaysAgo: 1,
    outcome: "NOT_RECOVERED",
    narrative:
      "Nurse Kemi Tijani (clinic in Ikeja, reachable on +234 802 966 2269) reported that a 34-year-old female patient (initials A.S.) took Astymin Forte syrup (batch AF-2209) yesterday for anaemia and developed facial swelling with difficulty breathing (suspected angioedema). She was referred to the hospital this morning; outcome not yet recovered. Received via WhatsApp.",
  },
  {
    reporterFull: "Chidinma Okoro",
    addressForm: "Pharm. Okoro",
    qualification: "Pharmacist",
    qualificationLabel: "Pharmacist",
    reporterNumber: "+234 803 214 5567",
    intro: [
      "Good day. I am a community pharmacist in Surulere, Lagos.",
      "A customer bought Paracetamol tablets two days ago for fever and now has a blistering skin rash all over her body.",
      "She has been admitted for observation at a nearby hospital.",
    ],
    infoReply:
      "My name is Chidinma Okoro, and you can reach me on this number. The patient's initials are O.A., she is 22 years old. The medicine is Paracetamol tablets, batch number PC-1187.",
    patientInitials: "O.A.",
    patientAge: "22",
    patientSex: "FEMALE",
    medicalHistory: "No known drug allergies — reported by the caller",
    product: "Paracetamol",
    batchNumber: "PC-1187",
    route: "Oral",
    indication: "Fever",
    action: "Product withdrawn",
    reactionTerm: "Blistering skin rash",
    onsetDaysAgo: 2,
    outcome: "RECOVERING",
    narrative:
      "Pharmacist Chidinma Okoro (community pharmacy, Surulere, Lagos, reachable on +234 803 214 5567) reported that a 22-year-old female patient (initials O.A.) took Paracetamol tablets (batch PC-1187) two days ago for fever and developed a blistering skin rash over her whole body. She has been admitted to hospital for observation; recovering. Received via WhatsApp.",
  },
  {
    reporterFull: "Femi Adebayo",
    addressForm: "Dr. Adebayo",
    qualification: "Physician",
    qualificationLabel: "Physician",
    reporterNumber: "+234 805 990 2231",
    intro: [
      "Good morning, I'm a physician at a clinic in Wuse, Abuja.",
      "One of my patients received an Amoxicillin injection this morning and immediately developed swelling, wheezing and low blood pressure.",
      "We gave emergency treatment and are monitoring him in the ICU.",
    ],
    infoReply:
      "My name is Femi Adebayo, and you can reach me on this number. The patient's initials are T.O., he is 8 years old. The medicine is Amoxicillin injection, batch number AMX-3390.",
    patientInitials: "T.O.",
    patientAge: "8",
    patientSex: "MALE",
    medicalHistory: "No known drug allergies — reported by the caller",
    product: "Amoxicillin",
    batchNumber: "AMX-3390",
    route: "Intramuscular",
    indication: "Ear infection",
    action: "Drug withdrawn",
    reactionTerm: "Anaphylaxis",
    onsetDaysAgo: 0,
    outcome: "RECOVERING",
    narrative:
      "Dr. Femi Adebayo (clinic in Wuse, Abuja, reachable on +234 805 990 2231) reported that an 8-year-old male patient (initials T.O.) received an Amoxicillin injection (batch AMX-3390) for an ear infection and immediately developed swelling, wheezing and hypotension consistent with anaphylaxis. He received emergency treatment and is being monitored in the ICU; recovering. Received via WhatsApp.",
  },
  {
    reporterFull: "Musa Ibrahim",
    addressForm: "Mr. Ibrahim",
    qualification: "Consumer/patient",
    qualificationLabel: "Consumer/patient",
    reporterNumber: "+234 807 662 9911",
    intro: [
      "Hello, I want to report something about a drug I have been taking.",
      "I have been taking Ibuprofen tablets for my back pain and yesterday I noticed blood in my stool and felt very weak.",
      "I went to the hospital and they say it is bleeding in my stomach.",
    ],
    infoReply:
      "My name is Musa Ibrahim, and you can reach me on this number. It is me, I am 51 years old. The medicine is Ibuprofen tablets, batch number IBU-7742.",
    patientInitials: "M.I.",
    patientAge: "51",
    patientSex: "MALE",
    medicalHistory: "Chronic back pain — reported by the caller",
    product: "Ibuprofen",
    batchNumber: "IBU-7742",
    route: "Oral",
    indication: "Back pain",
    action: "Drug withdrawn",
    reactionTerm: "Gastrointestinal haemorrhage",
    onsetDaysAgo: 1,
    outcome: "NOT_RECOVERED",
    narrative:
      "Mr. Musa Ibrahim (reachable on +234 807 662 9911) self-reported that he took Ibuprofen tablets (batch IBU-7742) for chronic back pain and developed melena and weakness, diagnosed at hospital as gastrointestinal haemorrhage; not yet recovered. Received via WhatsApp.",
  },
  {
    reporterFull: "Ngozi Umeh",
    addressForm: "Nurse Umeh",
    qualification: "Nurse",
    qualificationLabel: "Healthcare Professional",
    reporterNumber: "+234 809 441 7765",
    intro: [
      "Good afternoon, I'm a nurse at a diabetes clinic in Port Harcourt.",
      "A patient started Metformin last week and has had persistent nausea and dizziness since.",
      "She is otherwise stable and managing at home.",
    ],
    infoReply:
      "My name is Ngozi Umeh, and you can reach me on this number. The patient's initials are E.N., she is 46 years old. The medicine is Metformin tablets, batch number MET-5561.",
    patientInitials: "E.N.",
    patientAge: "46",
    patientSex: "FEMALE",
    medicalHistory: "Type 2 diabetes — reported by the caller",
    product: "Metformin",
    batchNumber: "MET-5561",
    route: "Oral",
    indication: "Type 2 diabetes",
    action: "Dose not changed",
    reactionTerm: "Nausea and dizziness",
    onsetDaysAgo: 7,
    outcome: "RECOVERING",
    narrative:
      "Nurse Ngozi Umeh (diabetes clinic, Port Harcourt, reachable on +234 809 441 7765) reported that a 46-year-old female patient (initials E.N.) started Metformin (batch MET-5561) a week ago for type 2 diabetes and has had persistent nausea and dizziness since; managing at home, recovering. Received via WhatsApp.",
  },
  {
    reporterFull: "Bola Balogun",
    addressForm: "Pharm. Balogun",
    qualification: "Pharmacist",
    qualificationLabel: "Pharmacist",
    reporterNumber: "+234 810 332 8890",
    intro: [
      "Good evening. I am a pharmacist here in Enugu.",
      "A customer who took Ciprofloxacin for a urinary infection is now complaining of severe pain and swelling in his Achilles tendon.",
      "He says he can barely walk.",
    ],
    infoReply:
      "My name is Bola Balogun, and you can reach me on this number. The patient's initials are K.C., he is 60 years old. The medicine is Ciprofloxacin tablets, batch number CIP-2204.",
    patientInitials: "K.C.",
    patientAge: "60",
    patientSex: "MALE",
    medicalHistory: "No known drug allergies — reported by the caller",
    product: "Ciprofloxacin",
    batchNumber: "CIP-2204",
    route: "Oral",
    indication: "Urinary tract infection",
    action: "Drug withdrawn",
    reactionTerm: "Tendon pain and swelling",
    onsetDaysAgo: 3,
    outcome: "NOT_RECOVERED",
    narrative:
      "Pharmacist Bola Balogun (community pharmacy, Enugu, reachable on +234 810 332 8890) reported that a 60-year-old male patient (initials K.C.) took Ciprofloxacin (batch CIP-2204) for a urinary tract infection and developed severe Achilles tendon pain and swelling, now unable to walk normally; not yet recovered. Received via WhatsApp.",
  },
  {
    reporterFull: "Yetunde Fashola",
    addressForm: "Nurse Fashola",
    qualification: "Nurse",
    qualificationLabel: "Healthcare Professional",
    reporterNumber: "+234 812 556 0034",
    intro: [
      "Good morning, I'm a nurse at a primary health centre in Ibadan.",
      "A child was given Coartem for malaria and has been vomiting repeatedly and seems dizzy.",
      "The mother is very worried and the child has not been able to keep any food down.",
    ],
    infoReply:
      "My name is Yetunde Fashola, and you can reach me on this number. The patient's initials are B.F., he is 6 years old. The medicine is Coartem tablets, batch number CRT-9013.",
    patientInitials: "B.F.",
    patientAge: "6",
    patientSex: "MALE",
    medicalHistory: "No known drug allergies — reported by the caller",
    product: "Artemether-Lumefantrine (Coartem)",
    batchNumber: "CRT-9013",
    route: "Oral",
    indication: "Malaria",
    action: "Dose not changed",
    reactionTerm: "Persistent vomiting and dizziness",
    onsetDaysAgo: 1,
    outcome: "RECOVERING",
    narrative:
      "Nurse Yetunde Fashola (primary health centre, Ibadan, reachable on +234 812 556 0034) reported that a 6-year-old male patient (initials B.F.) was given Artemether-Lumefantrine (Coartem, batch CRT-9013) for malaria and developed persistent vomiting and dizziness, unable to retain food; recovering. Received via WhatsApp.",
  },
  {
    reporterFull: "Grace Effiong",
    addressForm: "Dr. Effiong",
    qualification: "Physician",
    qualificationLabel: "Physician",
    reporterNumber: "+234 813 771 4420",
    intro: [
      "Good afternoon, I'm a physician in Kaduna.",
      "A patient on Omeprazole for acid reflux has reported a persistent headache for the past three days.",
      "Nothing else notable — she is still able to go about her daily activities.",
    ],
    infoReply:
      "My name is Grace Effiong, and you can reach me on this number. The patient's initials are R.E., she is 39 years old. The medicine is Omeprazole capsules, batch number OMP-4471.",
    patientInitials: "R.E.",
    patientAge: "39",
    patientSex: "FEMALE",
    medicalHistory: "Acid reflux — reported by the caller",
    product: "Omeprazole",
    batchNumber: "OMP-4471",
    route: "Oral",
    indication: "Acid reflux",
    action: "Dose not changed",
    reactionTerm: "Headache",
    onsetDaysAgo: 3,
    outcome: "RECOVERED",
    narrative:
      "Dr. Grace Effiong (clinic in Kaduna, reachable on +234 813 771 4420) reported that a 39-year-old female patient (initials R.E.) on Omeprazole (batch OMP-4471) for acid reflux experienced a persistent headache for three days, otherwise able to continue daily activities; recovered. Received via WhatsApp.",
  },
  {
    reporterFull: "Chika Nwosu",
    addressForm: "Ms. Nwosu",
    qualification: "Consumer/patient",
    qualificationLabel: "Reporting on a family member",
    reporterNumber: "+234 814 220 9987",
    intro: [
      "Hello, I need to report something about my brother's medication.",
      "He started Sertraline three weeks ago for depression and has become withdrawn, and this week mentioned thoughts of ending his life.",
      "We took him to the emergency department yesterday and he is currently admitted for psychiatric observation.",
    ],
    infoReply:
      "My name is Chika Nwosu, and you can reach me on this number. The patient's initials are U.N., he is 27 years old. The medicine is Sertraline tablets, batch number SER-6650.",
    patientInitials: "U.N.",
    patientAge: "27",
    patientSex: "MALE",
    medicalHistory: "Depression — reported by the caller",
    product: "Sertraline",
    batchNumber: "SER-6650",
    route: "Oral",
    indication: "Depression",
    action: "Drug withdrawn",
    reactionTerm: "Suicidal ideation",
    onsetDaysAgo: 2,
    outcome: "NOT_RECOVERED",
    narrative:
      "Chika Nwosu (reachable on +234 814 220 9987) reported that her 27-year-old brother (initials U.N.) started Sertraline (batch SER-6650) three weeks ago for depression, became withdrawn, and this week expressed suicidal ideation. He was taken to the emergency department and is currently admitted for psychiatric observation; not yet recovered. Received via WhatsApp.",
  },
  {
    reporterFull: "Amaka Eze",
    addressForm: "Nurse Eze",
    qualification: "Nurse",
    qualificationLabel: "Healthcare Professional",
    reporterNumber: "+234 816 903 1256",
    intro: [
      "Good afternoon, I'm a nurse at a hospital in Benin City.",
      "A patient received a Ceftriaxone injection yesterday and now has significant swelling, redness and pain at the injection site.",
      "It has not improved since yesterday, but she is otherwise well.",
    ],
    infoReply:
      "My name is Amaka Eze, and you can reach me on this number. The patient's initials are P.O., she is 33 years old. The medicine is Ceftriaxone injection, batch number CFX-3387.",
    patientInitials: "P.O.",
    patientAge: "33",
    patientSex: "FEMALE",
    medicalHistory: "No known drug allergies — reported by the caller",
    product: "Ceftriaxone",
    batchNumber: "CFX-3387",
    route: "Intramuscular",
    indication: "Bacterial infection",
    action: "Dose not changed",
    reactionTerm: "Injection site swelling and pain",
    onsetDaysAgo: 1,
    outcome: "RECOVERING",
    narrative:
      "Nurse Amaka Eze (hospital, Benin City, reachable on +234 816 903 1256) reported that a 33-year-old female patient (initials P.O.) received a Ceftriaxone injection (batch CFX-3387) for a bacterial infection and developed significant swelling, redness and pain at the injection site, unimproved since onset; otherwise well, recovering. Received via WhatsApp.",
  },
];

function pickScenario(): Scenario {
  return SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]!;
}

const REPORTER_FIRST = "Unknown reporter";

const STAFF_INFO_REQUEST =
  "Thank you for the report. To register this safety report we still need: your full name; the patient's initials, age and sex; and the exact medicine name with its batch number. Please reply with these details.";

const R_CONSENT_REPLY = "Yes, I consent to my information being used for drug safety monitoring.";

const STAFF_NOT_REPORTABLE =
  "Thank you for reaching out. Based on the information provided, this report does not meet the criteria for an individual case safety report, so no case record will be created. Please contact us again if anything changes or if the patient's condition changes.";

const CRITERIA: { key: string; label: string }[] = [
  { key: "reporter", label: "Identifiable reporter" },
  { key: "patient", label: "Identifiable patient" },
  { key: "product", label: "Suspect product" },
  { key: "event", label: "Adverse event" },
];

function WhatsAppIntakePage() {
  const [nonce, setNonce] = useState(0);
  const scenario = useMemo(() => pickScenario(), [nonce]);
  return <WhatsAppIntakeDemo key={nonce} scenario={scenario} onReset={() => setNonce((n) => n + 1)} />;
}

function WhatsAppIntakeDemo({
  scenario,
  onReset,
}: {
  scenario: Scenario;
  onReset: () => void;
}) {
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
      push("reporter", scenario.intro[0]);
      if (!(await wait(1300))) return;
      setTyping(true);
      if (!(await wait(1400))) return;
      setTyping(false);
      push("reporter", scenario.intro[1]);
      if (!(await wait(1300))) return;
      setTyping(true);
      if (!(await wait(1200))) return;
      setTyping(false);
      push("reporter", scenario.intro[2]);
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
    push("reporter", scenario.infoReply);
    setInfoComplete(true);
    setBusy(false);
  }

  async function requestConsent() {
    if (busy || closed || consentRecorded || consentRequested) return;
    setBusy(true);
    setConsentRequested(true);
    push(
      "staff",
      `Thank you, ${scenario.addressForm}. One more thing: do you consent to the information you have provided being used for drug safety monitoring and regulatory reporting, in line with the NDPR?`,
    );
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
          name: scenario.reporterFull,
          qualification: scenario.qualification,
          country: "Nigeria",
          contact: scenario.reporterNumber,
        },
        patient: {
          identifier: scenario.patientInitials,
          age: scenario.patientAge,
          sex: scenario.patientSex,
          weightKg: "",
          medicalHistory: scenario.medicalHistory,
        },
        product: {
          reportedName: scenario.product,
          dose: "",
          route: scenario.route,
          indication: scenario.indication,
          therapyStart: "",
          action: scenario.action,
          batchNumber: scenario.batchNumber,
          expiryDate: "",
        },
        reaction: {
          reportedTerm: scenario.reactionTerm,
          onsetDate: new Date(Date.now() - scenario.onsetDaysAgo * 86_400_000)
            .toISOString()
            .slice(0, 10),
          outcome: scenario.outcome,
        },
        narrative: scenario.narrative,
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

  const reporterName = infoComplete ? scenario.reporterFull : REPORTER_FIRST;

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
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {scenario.reporterNumber}
              </p>
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
                  {scenario.reporterNumber} · {scenario.qualificationLabel}
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
                  <span className="font-medium">{introDone ? scenario.product : "—"}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Suspected term: </span>
                  <span className="font-medium">{introDone ? scenario.reactionTerm : "—"}</span>
                </p>
              </div>
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">Draft narrative: </span>
                {introDone ? scenario.narrative : "Waiting for the reporter's opening messages…"}
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
