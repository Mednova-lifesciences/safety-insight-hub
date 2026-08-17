import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Save } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { isNotConfigured } from "@/services/api/client";
import { PageHeader, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/icsr/new")({
  head: () => ({
    meta: [
      { title: "New ICSR — MedNova PV Assist" },
      { name: "description", content: "Capture a new individual case safety report with the minimum criteria required for a valid ICSR." },
      { property: "og:title", content: "New ICSR — MedNova PV Assist" },
      { property: "og:description", content: "Structured ICSR intake with validation, triage and coding hand-off." },
    ],
  }),
  component: NewIcsrPage,
});

const SERIOUSNESS_CRITERIA = [
  "Results in death",
  "Life-threatening",
  "Requires or prolongs hospitalisation",
  "Persistent or significant disability/incapacity",
  "Congenital anomaly/birth defect",
  "Other medically important condition",
];

const PIPELINE = ["New ICSR", "Validation", "Triage", "Coding", "Review", "QC", "Regulatory readiness"];

function Req() {
  return <span className="ml-1 text-critical">*</span>;
}

function FieldRow({
  id,
  label,
  required,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <Req /> : <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function NewIcsrPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [seriousnessValue, setSeriousnessValue] = useState("NON_SERIOUS");
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const minimumCriteria = [
    { label: "Identifiable reporter", ok: !!form["reporterName"] },
    { label: "Identifiable patient", ok: !!form["patientId"] },
    { label: "Suspect product", ok: !!form["productName"] },
    { label: "Adverse event / reaction", ok: !!form["reactionTerm"] },
  ];
  const valid = minimumCriteria.every((c) => c.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error("All four minimum ICSR criteria must be captured before submission.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await casesApi.create({
        reporter: {
          name: form["reporterName"],
          qualification: form["reporterQual"],
          country: form["reporterCountry"],
          contact: form["reporterContact"],
        },
        patient: {
          identifier: form["patientId"],
          age: form["patientAge"],
          sex: form["patientSex"],
          weightKg: form["patientWeight"],
          medicalHistory: form["patientHistory"],
        },
        product: {
          reportedName: form["productName"],
          dose: form["productDose"],
          route: form["productRoute"],
          indication: form["productIndication"],
          therapyStart: form["therapyStart"],
          action: form["productAction"],
        },
        reaction: {
          reportedTerm: form["reactionTerm"],
          onsetDate: form["onsetDate"],
          outcome: form["outcome"] ?? "UNKNOWN",
        },
        narrative: form["narrative"] ?? "",
        reportedSeriousness: seriousnessValue,
        seriousnessCriteria: criteria,
        additionalInformation: form["additional"] ?? "",
      });
      toast.success(`Case ${created.caseId} created.`);
      navigate({ to: "/cases/$caseId", params: { caseId: created.caseId } });
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the case was not created. Connect the FastAPI layer to persist ICSRs."
          : "The case could not be created. Nothing was saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New ICSR"
        description="Capture the information required to establish a valid individual case safety report. Nothing is saved until the backend confirms creation."
      />

      <div className="space-y-4 p-6">
        <Section title="Workflow" description="Where this report goes after submission.">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {PIPELINE.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-md border px-2.5 py-1",
                    i === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {s}
                </span>
                {i < PIPELINE.length - 1 ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="Minimum ICSR criteria"
          description="A valid case requires all four elements."
        >
          <div className="grid gap-2 sm:grid-cols-4">
            {minimumCriteria.map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <StatusPill tone={c.ok ? "success" : "warning"}>{c.ok ? "Captured" : "Required"}</StatusPill>
                <span className="text-sm">{c.label}</span>
              </div>
            ))}
          </div>
        </Section>

        <form onSubmit={submit} className="space-y-4">
          <Section title="Reporter information">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FieldRow id="reporterName" label="Reporter name" required>
                <Input id="reporterName" required onChange={set("reporterName")} />
              </FieldRow>
              <FieldRow id="reporterQual" label="Qualification" required>
                <Select onValueChange={(v) => setForm((f) => ({ ...f, reporterQual: v }))}>
                  <SelectTrigger id="reporterQual"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {["Physician", "Pharmacist", "Nurse", "Other health professional", "Consumer/patient", "Lawyer"].map((q) => (
                      <SelectItem key={q} value={q}>{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow id="reporterCountry" label="Country" required>
                <Input id="reporterCountry" required onChange={set("reporterCountry")} />
              </FieldRow>
              <FieldRow id="reporterContact" label="Contact" hint="Stored server-side; masked in listings.">
                <Input id="reporterContact" onChange={set("reporterContact")} />
              </FieldRow>
            </div>
          </Section>

          <Section title="Patient information" description="Use a pseudonymised identifier — do not enter direct identifiers.">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <FieldRow id="patientId" label="Patient identifier" required>
                <Input id="patientId" required placeholder="PT-0000" onChange={set("patientId")} />
              </FieldRow>
              <FieldRow id="patientAge" label="Age">
                <Input id="patientAge" onChange={set("patientAge")} />
              </FieldRow>
              <FieldRow id="patientSex" label="Sex">
                <Select onValueChange={(v) => setForm((f) => ({ ...f, patientSex: v }))}>
                  <SelectTrigger id="patientSex"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="UNKNOWN">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow id="patientWeight" label="Weight (kg)">
                <Input id="patientWeight" onChange={set("patientWeight")} />
              </FieldRow>
              <FieldRow id="patientHistory" label="Relevant medical history">
                <Input id="patientHistory" onChange={set("patientHistory")} />
              </FieldRow>
            </div>
          </Section>

          <Section title="Suspect product">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <FieldRow id="productName" label="Product as reported" required hint="Coding candidates are retrieved from WHODrug after submission.">
                <Input id="productName" required onChange={set("productName")} />
              </FieldRow>
              <FieldRow id="productDose" label="Dose">
                <Input id="productDose" onChange={set("productDose")} />
              </FieldRow>
              <FieldRow id="productRoute" label="Route">
                <Input id="productRoute" onChange={set("productRoute")} />
              </FieldRow>
              <FieldRow id="productIndication" label="Indication">
                <Input id="productIndication" onChange={set("productIndication")} />
              </FieldRow>
              <FieldRow id="therapyStart" label="Therapy start date">
                <Input id="therapyStart" type="date" onChange={set("therapyStart")} />
              </FieldRow>
              <FieldRow id="productAction" label="Action taken with product">
                <Select onValueChange={(v) => setForm((f) => ({ ...f, productAction: v }))}>
                  <SelectTrigger id="productAction"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {["Drug withdrawn", "Dose reduced", "Dose increased", "Dose not changed", "Unknown", "Not applicable"].map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            </div>
          </Section>

          <Section title="Adverse event / reaction">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FieldRow id="reactionTerm" label="Reaction as reported" required>
                <Input id="reactionTerm" required onChange={set("reactionTerm")} />
              </FieldRow>
              <FieldRow id="onsetDate" label="Onset date" required>
                <Input id="onsetDate" type="date" required onChange={set("onsetDate")} />
              </FieldRow>
              <FieldRow id="endDate" label="End date">
                <Input id="endDate" type="date" onChange={set("endDate")} />
              </FieldRow>
              <FieldRow id="outcome" label="Outcome" required>
                <Select onValueChange={(v) => setForm((f) => ({ ...f, outcome: v }))}>
                  <SelectTrigger id="outcome"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {[
                      ["RECOVERED", "Recovered/resolved"],
                      ["RECOVERING", "Recovering/resolving"],
                      ["NOT_RECOVERED", "Not recovered"],
                      ["RECOVERED_WITH_SEQUELAE", "Recovered with sequelae"],
                      ["FATAL", "Fatal"],
                      ["UNKNOWN", "Unknown"],
                    ].map(([v, l]) => (
                      <SelectItem key={v} value={v!}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            </div>
          </Section>

          <Section
            title="Seriousness (as reported)"
            description="Record what the reporter stated. The seriousness engine reviews the narrative separately and never overrides this value."
          >
            <div className="space-y-3">
              <Select value={seriousnessValue} onValueChange={setSeriousnessValue}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NON_SERIOUS">Non-serious</SelectItem>
                  <SelectItem value="SERIOUS">Serious</SelectItem>
                  <SelectItem value="UNASSESSED">Unassessed</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {SERIOUSNESS_CRITERIA.map((c) => (
                  <label key={c} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <Checkbox
                      checked={criteria.includes(c)}
                      onCheckedChange={(v) =>
                        setCriteria((prev) => (v ? [...prev, c] : prev.filter((x) => x !== c)))
                      }
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Narrative" description="Free-text clinical narrative. Used by the seriousness engine for evidence extraction.">
            <Textarea rows={6} placeholder="Chronological description of the case." onChange={set("narrative")} />
          </Section>

          <Section title="Additional information">
            <Textarea rows={3} placeholder="Concomitant medication, laboratory data, dechallenge/rechallenge, other relevant detail." onChange={set("additional")} />
          </Section>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting}>
              <Save className="size-4" /> Submit ICSR
            </Button>
            <p className="text-xs text-muted-foreground">
              Submission creates an auditable case record and moves it to validation and triage.
            </p>
          </div>
        </form>
      </div>
    </>
  );
}
