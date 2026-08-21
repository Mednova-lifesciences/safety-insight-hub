import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, ImageUp, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { ai } from "@/services/api/ai";
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
      {
        name: "description",
        content:
          "Capture a new individual case safety report with the minimum criteria required for a valid ICSR.",
      },
      { property: "og:title", content: "New ICSR — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Structured ICSR intake with validation, triage and coding hand-off.",
      },
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

const PIPELINE = [
  "New ICSR",
  "Validation",
  "Triage",
  "Coding",
  "Review",
  "QC",
  "Regulatory readiness",
];

const QUALIFICATIONS = [
  "Physician",
  "Pharmacist",
  "Nurse",
  "Other health professional",
  "Consumer/patient",
  "Lawyer",
];
const ACTIONS = [
  "Drug withdrawn",
  "Dose reduced",
  "Dose increased",
  "Dose not changed",
  "Unknown",
  "Not applicable",
];
const OUTCOMES: [string, string][] = [
  ["RECOVERED", "Recovered/resolved"],
  ["RECOVERING", "Recovering/resolving"],
  ["NOT_RECOVERED", "Not recovered"],
  ["RECOVERED_WITH_SEQUELAE", "Recovered with sequelae"],
  ["FATAL", "Fatal"],
  ["UNKNOWN", "Unknown"],
];

const FIELD_LABELS: Record<string, string> = {
  reporterName: "Reporter name",
  reporterQual: "Reporter qualification",
  reporterCountry: "Reporter country",
  reporterContact: "Reporter contact",
  patientId: "Patient identifier",
  patientAge: "Patient age",
  patientSex: "Patient sex",
  patientWeight: "Patient weight",
  patientHistory: "Medical history",
  productName: "Product name",
  productDose: "Dose",
  productRoute: "Route",
  productIndication: "Indication",
  therapyStart: "Therapy start date",
  productAction: "Action taken",
  productBatch: "Batch/lot number",
  productExpiry: "Expiry date",
  reactionTerm: "Reaction",
  onsetDate: "Onset date",
  endDate: "End date",
  outcome: "Outcome",
  reportedSeriousness: "Seriousness",
  narrative: "Narrative",
  additional: "Additional information",
};

interface DrugRow {
  reportedName: string;
  dose: string;
  route: string;
  indication: string;
  therapyStart: string;
  action: string;
  batchNumber: string;
  expiryDate: string;
}

interface ConcomitantRow {
  name: string;
  dose: string;
  indication: string;
}

function emptyDrugRow(): DrugRow {
  return {
    reportedName: "",
    dose: "",
    route: "",
    indication: "",
    therapyStart: "",
    action: "",
    batchNumber: "",
    expiryDate: "",
  };
}

function emptyConcomitantRow(): ConcomitantRow {
  return { name: "", dose: "", indication: "" };
}

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
        {required ? (
          <Req />
        ) : (
          <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
        )}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function NewIcsrPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [seriousnessValue, setSeriousnessValue] = useState("NON_SERIOUS");
  const [form, setForm] = useState<Record<string, string>>({});
  const [additionalProducts, setAdditionalProducts] = useState<DrugRow[]>([]);
  const [concomitantMeds, setConcomitantMeds] = useState<ConcomitantRow[]>([]);
  const [lowConfidenceFields, setLowConfidenceFields] = useState<string[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [aiUnavailableNote, setAiUnavailableNote] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setField = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const minimumCriteria = [
    { label: "Identifiable reporter", ok: !!form["reporterName"] },
    { label: "Identifiable patient", ok: !!form["patientId"] },
    { label: "Suspect product", ok: !!form["productName"] },
    { label: "Adverse event / reaction", ok: !!form["reactionTerm"] },
  ];
  const valid = minimumCriteria.every((c) => c.ok);

  async function extractFromImage(file: File) {
    setExtracting(true);
    setAiUnavailableNote(null);
    setImagePreview(URL.createObjectURL(file));
    try {
      const result = await ai.icsr.extractImage(file);
      if (!result.ai_used || !result.extracted) {
        setAiUnavailableNote(
          result.error ?? "AI extraction is unavailable. Enter case details manually below.",
        );
        return;
      }
      const e = result.extracted;
      const mapped: Record<string, string> = {};
      if (e.reporterName) mapped["reporterName"] = e.reporterName;
      if (e.reporterQualification) mapped["reporterQual"] = e.reporterQualification;
      if (e.reporterCountry) mapped["reporterCountry"] = e.reporterCountry;
      if (e.reporterContact) mapped["reporterContact"] = e.reporterContact;
      if (e.patientIdentifier) mapped["patientId"] = e.patientIdentifier;
      if (e.patientAge) mapped["patientAge"] = e.patientAge;
      if (e.patientSex) mapped["patientSex"] = e.patientSex;
      if (e.patientWeightKg) mapped["patientWeight"] = e.patientWeightKg;
      if (e.patientMedicalHistory) mapped["patientHistory"] = e.patientMedicalHistory;
      if (e.productName) mapped["productName"] = e.productName;
      if (e.productDose) mapped["productDose"] = e.productDose;
      if (e.productRoute) mapped["productRoute"] = e.productRoute;
      if (e.productIndication) mapped["productIndication"] = e.productIndication;
      if (e.therapyStartDate) mapped["therapyStart"] = e.therapyStartDate;
      if (e.productAction) mapped["productAction"] = e.productAction;
      if (e.reactionTerm) mapped["reactionTerm"] = e.reactionTerm;
      if (e.onsetDate) mapped["onsetDate"] = e.onsetDate;
      if (e.endDate) mapped["endDate"] = e.endDate;
      if (e.outcome) mapped["outcome"] = e.outcome;
      if (e.narrative) mapped["narrative"] = e.narrative;
      if (e.additionalInformation) mapped["additional"] = e.additionalInformation;

      const drugs = e.suspectedDrugs ?? [];
      if (drugs[0]?.batchNumber) mapped["productBatch"] = drugs[0].batchNumber;
      if (drugs[0]?.expiryDate) mapped["productExpiry"] = drugs[0].expiryDate;

      setForm((f) => ({ ...f, ...mapped }));
      if (e.reportedSeriousness) setSeriousnessValue(e.reportedSeriousness);
      setLowConfidenceFields(e.lowConfidenceFields ?? []);

      if (drugs.length > 1) {
        setAdditionalProducts(
          drugs.slice(1).map((d) => ({
            reportedName: d.productName ?? "",
            dose: d.productDose ?? "",
            route: d.productRoute ?? "",
            indication: d.productIndication ?? "",
            therapyStart: d.therapyStartDate ?? "",
            action: d.productAction ?? "",
            batchNumber: d.batchNumber ?? "",
            expiryDate: d.expiryDate ?? "",
          })),
        );
      }
      if (e.concomitantMedicines && e.concomitantMedicines.length > 0) {
        setConcomitantMeds(
          e.concomitantMedicines.map((m) => ({
            name: m.name ?? "",
            dose: m.dose ?? "",
            indication: m.indication ?? "",
          })),
        );
      }
      if (e.seriousnessCriteria && e.seriousnessCriteria.length > 0) {
        const matched = SERIOUSNESS_CRITERIA.filter((c) => e.seriousnessCriteria!.includes(c));
        if (matched.length > 0) setCriteria(matched);
      }

      const populatedCount =
        Object.keys(mapped).length + drugs.slice(1).length + (e.concomitantMedicines?.length ?? 0);
      if (populatedCount === 0) {
        toast.info(
          "No fields could be confidently extracted from this image. Enter details manually.",
        );
      } else {
        toast.success(
          `${populatedCount} field(s) populated from the image. Review everything before submitting.`,
        );
      }
    } catch {
      setAiUnavailableNote("AI extraction failed. Enter case details manually below.");
    } finally {
      setExtracting(false);
    }
  }

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
          batchNumber: form["productBatch"],
          expiryDate: form["productExpiry"],
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
        additionalProducts: additionalProducts.filter((p) => p.reportedName.trim().length > 0),
        concomitantMedicines: concomitantMeds.filter((m) => m.name.trim().length > 0),
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
                    i === 0
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {s}
                </span>
                {i < PIPELINE.length - 1 ? (
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="Extract from an image"
          description="Upload a scanned form, handwritten note, or supporting document. OpenAI extracts what it can confidently read into the fields below — review and correct everything before submitting."
        >
          <div className="flex flex-wrap items-start gap-4">
            <label className="flex w-full max-w-sm cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center hover:bg-muted/50">
              <ImageUp className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                {extracting ? "Extracting with AI…" : "Upload Image"}
              </span>
              <span className="text-xs text-muted-foreground">PNG, JPEG, WEBP or GIF.</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) extractFromImage(f);
                }}
              />
            </label>
            {imagePreview ? (
              <div className="space-y-2">
                <img
                  src={imagePreview}
                  alt="Uploaded document preview"
                  className="max-h-48 rounded-md border border-border object-contain"
                />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5" /> Extracted information requires your review
                  before submission.
                </p>
              </div>
            ) : null}
          </div>
          {aiUnavailableNote ? (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
              {aiUnavailableNote}
            </div>
          ) : null}
          {lowConfidenceFields.length > 0 ? (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
              <span className="font-medium">
                Low-confidence extraction — double-check these fields:{" "}
              </span>
              {lowConfidenceFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
            </div>
          ) : null}
        </Section>

        <Section
          title="Minimum ICSR criteria"
          description="A valid case requires all four elements."
        >
          <div className="grid gap-2 sm:grid-cols-4">
            {minimumCriteria.map((c) => (
              <div
                key={c.label}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <StatusPill tone={c.ok ? "success" : "warning"}>
                  {c.ok ? "Captured" : "Required"}
                </StatusPill>
                <span className="text-sm">{c.label}</span>
              </div>
            ))}
          </div>
        </Section>

        <form onSubmit={submit} className="space-y-4">
          <Section title="Reporter information">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FieldRow id="reporterName" label="Reporter name" required>
                <Input
                  id="reporterName"
                  required
                  value={form["reporterName"] ?? ""}
                  onChange={set("reporterName")}
                />
              </FieldRow>
              <FieldRow id="reporterQual" label="Qualification" required>
                <Select value={form["reporterQual"] ?? ""} onValueChange={setField("reporterQual")}>
                  <SelectTrigger id="reporterQual">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALIFICATIONS.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow id="reporterCountry" label="Country" required>
                <Input
                  id="reporterCountry"
                  required
                  value={form["reporterCountry"] ?? ""}
                  onChange={set("reporterCountry")}
                />
              </FieldRow>
              <FieldRow
                id="reporterContact"
                label="Contact"
                hint="Stored server-side; masked in listings."
              >
                <Input
                  id="reporterContact"
                  value={form["reporterContact"] ?? ""}
                  onChange={set("reporterContact")}
                />
              </FieldRow>
            </div>
          </Section>

          <Section
            title="Patient information"
            description="Use a pseudonymised identifier — do not enter direct identifiers."
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <FieldRow id="patientId" label="Patient identifier" required>
                <Input
                  id="patientId"
                  required
                  placeholder="PT-0000"
                  value={form["patientId"] ?? ""}
                  onChange={set("patientId")}
                />
              </FieldRow>
              <FieldRow id="patientAge" label="Age">
                <Input
                  id="patientAge"
                  value={form["patientAge"] ?? ""}
                  onChange={set("patientAge")}
                />
              </FieldRow>
              <FieldRow id="patientSex" label="Sex">
                <Select value={form["patientSex"] ?? ""} onValueChange={setField("patientSex")}>
                  <SelectTrigger id="patientSex">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="UNKNOWN">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow id="patientWeight" label="Weight (kg)">
                <Input
                  id="patientWeight"
                  value={form["patientWeight"] ?? ""}
                  onChange={set("patientWeight")}
                />
              </FieldRow>
              <FieldRow id="patientHistory" label="Relevant medical history">
                <Input
                  id="patientHistory"
                  value={form["patientHistory"] ?? ""}
                  onChange={set("patientHistory")}
                />
              </FieldRow>
            </div>
          </Section>

          <Section title="Suspect product">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <FieldRow
                id="productName"
                label="Product as reported"
                required
                hint="Coding candidates are retrieved from WHODrug after submission."
              >
                <Input
                  id="productName"
                  required
                  value={form["productName"] ?? ""}
                  onChange={set("productName")}
                />
              </FieldRow>
              <FieldRow id="productDose" label="Dose">
                <Input
                  id="productDose"
                  value={form["productDose"] ?? ""}
                  onChange={set("productDose")}
                />
              </FieldRow>
              <FieldRow id="productRoute" label="Route">
                <Input
                  id="productRoute"
                  value={form["productRoute"] ?? ""}
                  onChange={set("productRoute")}
                />
              </FieldRow>
              <FieldRow id="productIndication" label="Indication">
                <Input
                  id="productIndication"
                  value={form["productIndication"] ?? ""}
                  onChange={set("productIndication")}
                />
              </FieldRow>
              <FieldRow id="therapyStart" label="Therapy start date">
                <Input
                  id="therapyStart"
                  type="date"
                  value={form["therapyStart"] ?? ""}
                  onChange={set("therapyStart")}
                />
              </FieldRow>
              <FieldRow id="productAction" label="Action taken with product">
                <Select
                  value={form["productAction"] ?? ""}
                  onValueChange={setField("productAction")}
                >
                  <SelectTrigger id="productAction">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow id="productBatch" label="Batch / lot number">
                <Input
                  id="productBatch"
                  value={form["productBatch"] ?? ""}
                  onChange={set("productBatch")}
                />
              </FieldRow>
              <FieldRow id="productExpiry" label="Expiry date">
                <Input
                  id="productExpiry"
                  type="date"
                  value={form["productExpiry"] ?? ""}
                  onChange={set("productExpiry")}
                />
              </FieldRow>
            </div>
          </Section>

          <Section
            title="Additional suspect drugs"
            description="Only needed when more than one product is suspected in causing the reaction."
          >
            <div className="space-y-3">
              {additionalProducts.map((row, idx) => (
                <div
                  key={idx}
                  className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 xl:grid-cols-4"
                >
                  <FieldRow id={`extraProduct-${idx}-name`} label="Product as reported">
                    <Input
                      id={`extraProduct-${idx}-name`}
                      value={row.reportedName}
                      onChange={(e) =>
                        setAdditionalProducts((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, reportedName: e.target.value } : r)),
                        )
                      }
                    />
                  </FieldRow>
                  <FieldRow id={`extraProduct-${idx}-dose`} label="Dose">
                    <Input
                      id={`extraProduct-${idx}-dose`}
                      value={row.dose}
                      onChange={(e) =>
                        setAdditionalProducts((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, dose: e.target.value } : r)),
                        )
                      }
                    />
                  </FieldRow>
                  <FieldRow id={`extraProduct-${idx}-batch`} label="Batch / lot number">
                    <Input
                      id={`extraProduct-${idx}-batch`}
                      value={row.batchNumber}
                      onChange={(e) =>
                        setAdditionalProducts((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, batchNumber: e.target.value } : r)),
                        )
                      }
                    />
                  </FieldRow>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAdditionalProducts((rows) => rows.filter((_, i) => i !== idx))
                      }
                    >
                      <Trash2 className="size-4" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdditionalProducts((rows) => [...rows, emptyDrugRow()])}
              >
                <Plus className="size-4" /> Add another suspect drug
              </Button>
            </div>
          </Section>

          <Section
            title="Concomitant medications"
            description="Non-suspect medication the patient was also taking at the time of the reaction."
          >
            <div className="space-y-3">
              {concomitantMeds.map((row, idx) => (
                <div
                  key={idx}
                  className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3"
                >
                  <FieldRow id={`concomitant-${idx}-name`} label="Medicine name">
                    <Input
                      id={`concomitant-${idx}-name`}
                      value={row.name}
                      onChange={(e) =>
                        setConcomitantMeds((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)),
                        )
                      }
                    />
                  </FieldRow>
                  <FieldRow id={`concomitant-${idx}-dose`} label="Dose">
                    <Input
                      id={`concomitant-${idx}-dose`}
                      value={row.dose}
                      onChange={(e) =>
                        setConcomitantMeds((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, dose: e.target.value } : r)),
                        )
                      }
                    />
                  </FieldRow>
                  <div className="flex items-end justify-between gap-2">
                    <FieldRow id={`concomitant-${idx}-indication`} label="Indication" className="flex-1">
                      <Input
                        id={`concomitant-${idx}-indication`}
                        value={row.indication}
                        onChange={(e) =>
                          setConcomitantMeds((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, indication: e.target.value } : r)),
                          )
                        }
                      />
                    </FieldRow>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConcomitantMeds((rows) => rows.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConcomitantMeds((rows) => [...rows, emptyConcomitantRow()])}
              >
                <Plus className="size-4" /> Add concomitant medication
              </Button>
            </div>
          </Section>

          <Section title="Adverse event / reaction">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FieldRow id="reactionTerm" label="Reaction as reported" required>
                <Input
                  id="reactionTerm"
                  required
                  value={form["reactionTerm"] ?? ""}
                  onChange={set("reactionTerm")}
                />
              </FieldRow>
              <FieldRow id="onsetDate" label="Onset date" required>
                <Input
                  id="onsetDate"
                  type="date"
                  required
                  value={form["onsetDate"] ?? ""}
                  onChange={set("onsetDate")}
                />
              </FieldRow>
              <FieldRow id="endDate" label="End date">
                <Input
                  id="endDate"
                  type="date"
                  value={form["endDate"] ?? ""}
                  onChange={set("endDate")}
                />
              </FieldRow>
              <FieldRow id="outcome" label="Outcome" required>
                <Select value={form["outcome"] ?? ""} onValueChange={setField("outcome")}>
                  <SelectTrigger id="outcome">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
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
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NON_SERIOUS">Non-serious</SelectItem>
                  <SelectItem value="SERIOUS">Serious</SelectItem>
                  <SelectItem value="UNASSESSED">Unassessed</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {SERIOUSNESS_CRITERIA.map((c) => (
                  <label
                    key={c}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
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

          <Section
            title="Narrative"
            description="Free-text clinical narrative. Used by the seriousness engine for evidence extraction."
          >
            <Textarea
              rows={6}
              placeholder="Chronological description of the case."
              value={form["narrative"] ?? ""}
              onChange={set("narrative")}
            />
          </Section>

          <Section title="Additional information">
            <Textarea
              rows={3}
              placeholder="Concomitant medication, laboratory data, dechallenge/rechallenge, other relevant detail."
              value={form["additional"] ?? ""}
              onChange={set("additional")}
            />
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
