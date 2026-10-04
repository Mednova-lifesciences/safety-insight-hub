import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { usePermission } from "@/lib/auth";
import { Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PasteResearch, V4ResearchCard } from "@/components/pv/psur-assessment-memo";
import { ExposureEditor, RowsEditor, type Column } from "@/components/pv/psur-v4-tables";
import { EMPTY_EXPOSURE } from "@/services/psur/v4-prefill";
import { psur as psurApi } from "@/services/api/psur";
import { v4Field, type V4FieldId } from "@/services/psur/v4-fields";
import {
  aiSectionAssessment,
  latestV4PageText,
  NO_SIGNALS,
  SECTION_IDS,
  V4_DEFAULT_PAGE_TEXT,
  v4Ticks,
} from "@/services/psur/v4-report";
import {
  PSUR_V4_TEMPLATE_SECTIONS,
  type MemoCriterionId,
  type PsurDocument,
  type PsurFinding,
  type PsurV4SectionId,
  type PsurV4Tables,
  type V4AdrRow,
  type V4DiseaseRow,
  type V4ExposureTable,
  type V4Section1Row,
  type V4SignalRow,
} from "@/types/pv";
import { submissionDetailsOf } from "@/services/psur/memo-draft";

const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => SECTION_IDS[n]!);
const NAME = new Map(PSUR_V4_TEMPLATE_SECTIONS.map((s) => [s.id, s.name]));

/** Section 1's table, in the template's order. */
const S1_ROWS: [V4Section1Row | "indication", string][] = [
  ["dateOfReview", "Date of Review"],
  ["product", "Name of Product / Strength / Dosage Form"],
  ["mah", "Marketing Authorisation Holder (MAH)"],
  ["regNo", "NAFDAC Registration Number"],
  ["period", "Reporting Period"],
  ["ibd", "International Birth Date (IBD)"],
  ["nbd", "Nigerian Birth Date (NBD)"],
  ["indication", "Therapeutic Indication(s)"],
];

/** The sections whose fields are answered from outside research. */
const RESEARCH: Partial<Record<PsurV4SectionId, MemoCriterionId>> = {
  S2_WORLDWIDE_STATUS: "WORLDWIDE_ACTIONS",
  S4_RSI: "RSI_CHANGES",
  S6_LITERATURE: "RELEVANT_STUDIES",
  S7_AGGREGATE_SAFETY_DATA: "PATIENT_EXPOSURE",
};

/** Each section's free-text prompts, in the template's order. */
const FIELDS: Partial<Record<PsurV4SectionId, V4FieldId[]>> = {
  S2_WORLDWIDE_STATUS: ["S2_ACTIONS"],
  S3_THERAPEUTIC_CONTEXT: [
    "S3_INCIDENCE",
    "S3_DURATION",
    "S3_MORTALITY",
    "S3_TREATMENTS",
    "S3_QOL",
  ],
  S4_RSI: ["S4_TYPE_VERSION", "S4_CHANGES", "S4_RATIONALE"],
  S5_EXPOSURE_ACTIONS: ["S5_EXPOSURE", "S5_ACTIONS"],
  S6_LITERATURE: ["S6_STUDIES"],
  S7_AGGREGATE_SAFETY_DATA: ["S7_DIFFERENCES", "S7_VIGIFLOW"],
};
const ALL_FIELDS = Object.values(FIELDS).flat();

/** Which section's review a table belongs to. */
const TABLE_SECTION: Record<keyof PsurV4Tables, PsurV4SectionId> = {
  diseases: "S3_THERAPEUTIC_CONTEXT",
  exposure: "S5_EXPOSURE_ACTIONS",
  adrs: "S7_AGGREGATE_SAFETY_DATA",
  signals: "S8_SIGNAL_EVALUATION",
};

type Row<T> = T & Record<string, string>;

const DISEASE_COLUMNS: Column<Row<V4DiseaseRow>>[] = [
  { key: "disease", label: "Disease", width: 1.2 },
  { key: "mortality", label: "Mortality" },
  { key: "severity", label: "Severity" },
];
const ADR_COLUMNS: Column<Row<V4AdrRow>>[] = [
  { key: "soc", label: "SOC / Event", width: 1.6 },
  { key: "interval", label: "Reporting interval" },
  { key: "cumulative", label: "Cumulative" },
  { key: "nigerian", label: "Nigerian cases" },
  { key: "assessment", label: "Reviewer assessment", width: 1.6 },
];
const SIGNAL_COLUMNS: Column<Row<V4SignalRow>>[] = [
  { key: "signal", label: "Signal / Term", width: 1.3 },
  { key: "source", label: "Source" },
  { key: "status", label: "Status (New/Ongoing/Closed)" },
  { key: "method", label: "Method of Evaluation" },
  { key: "outcome", label: "Outcome" },
  { key: "dateClosed", label: "Date Closed" },
  { key: "action", label: "Regulatory action" },
];

/** The form's tables while being edited: always present, never undefined. */
interface FormTables {
  diseases: V4DiseaseRow[];
  exposure: V4ExposureTable;
  adrs: V4AdrRow[];
  signals: V4SignalRow[];
}

interface SectionDraft {
  assessment: string;
  /** Ticked by the evaluator, or set by editing anything in the section. */
  reviewed: boolean;
}

function initialFields(doc: PsurDocument): Record<string, string> {
  const saved = doc.v4SectionAnswers?.fields ?? {};
  const ai = doc.v4Prefill?.fields ?? {};
  return Object.fromEntries(ALL_FIELDS.map((f) => [f, saved[f] ?? ai[f] ?? ""]));
}

function initialTables(doc: PsurDocument): FormTables {
  const saved = doc.v4SectionAnswers?.tables ?? {};
  const ai = doc.v4Prefill?.tables ?? {};
  return {
    diseases: saved.diseases ?? ai.diseases ?? [],
    exposure: saved.exposure ?? ai.exposure ?? EMPTY_EXPOSURE,
    adrs: saved.adrs ?? ai.adrs ?? [],
    signals: saved.signals ?? ai.signals ?? [],
  };
}

/**
 * Sections 1-8 of the V4 evaluation form, as the template lays them out:
 * each prompt with a box for the answer, the form's tables and tick boxes,
 * the research behind the fields answered from outside sources (Sections 2,
 * 4, 6 and 7), and the evaluator's own assessment of each section.
 *
 * The AI pre-fills the prompts and tables from the submission. Until the
 * evaluator reviews a section — by ticking it, or by changing anything in
 * it — the V4 report prints the AI's values marked as not yet reviewed.
 * Research saves as it is accepted; everything else saves with the button.
 */
export function V4SectionsPanel({
  doc,
  findings,
  canResearch,
  onChanged,
}: {
  doc: PsurDocument;
  findings: PsurFinding[];
  canResearch: boolean;
  onChanged: () => void;
}) {
  const canEvaluate = usePermission("psur.evaluate");
  const initialTicks = v4Ticks(doc, findings);
  const a = doc.v4SectionAnswers;
  const [s2Inconsistent, setS2Inconsistent] = useState(initialTicks.s2Inconsistent);
  const [s2Explanation, setS2Explanation] = useState(a?.s2Explanation ?? "");
  const [indication, setIndication] = useState(
    a?.therapeuticIndication ?? doc.memoDraft?.therapeuticCategory ?? "",
  );
  const details = submissionDetailsOf(doc);
  /** What each Section 1 row prints when the evaluator leaves it alone. */
  const s1Default: Record<V4Section1Row, string> = {
    dateOfReview: "",
    product: details.productName,
    mah: details.mah,
    regNo: details.nafdacRegNo,
    period: details.intervalCovered,
    ibd: details.ibd,
    nbd: details.firstNafdacRegistrationDate,
  };
  const [s1, setS1] = useState<Record<V4Section1Row, string>>(() => ({
    ...s1Default,
    ...(a?.s1 ?? {}),
  }));
  const [s7AdrTabulation, setS7AdrTabulation] = useState(initialTicks.s7AdrTabulation);
  const [s7VigiflowChecked, setS7VigiflowChecked] = useState(initialTicks.s7VigiflowChecked);
  const [noSignals, setNoSignals] = useState(a?.noSignals ?? false);
  const [fields, setFields] = useState<Record<string, string>>(() => initialFields(doc));
  const [tables, setTables] = useState<FormTables>(() => initialTables(doc));
  const [drafts, setDrafts] = useState<Record<string, SectionDraft>>(() =>
    Object.fromEntries(
      SECTIONS.map((id) => {
        const saved = a?.assessments?.[id];
        return [
          id,
          { assessment: saved?.text ?? aiSectionAssessment(doc, id) ?? "", reviewed: !!saved },
        ];
      }),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);

  const markReviewed = (id: PsurV4SectionId) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, reviewed: true } }));
  const setField = (section: PsurV4SectionId, f: V4FieldId, v: string) => {
    setFields((prev) => ({ ...prev, [f]: v }));
    markReviewed(section);
  };
  function setTable<K extends keyof FormTables>(key: K, v: FormTables[K]) {
    setTables((prev) => ({ ...prev, [key]: v }));
    markReviewed(TABLE_SECTION[key]);
  }

  // A newly arrived AI reading fills only what nobody has reviewed or typed.
  const prefillAt = doc.v4Prefill?.generatedAt;
  const seenPrefill = useRef(prefillAt);
  useEffect(() => {
    if (prefillAt === seenPrefill.current) return;
    seenPrefill.current = prefillAt;
    const ai = doc.v4Prefill;
    if (!ai) return;
    const open = (s: PsurV4SectionId) => !drafts[s]?.reviewed;
    setFields((prev) => {
      const next = { ...prev };
      for (const [section, list] of Object.entries(FIELDS) as [PsurV4SectionId, V4FieldId[]][]) {
        if (!open(section)) continue;
        for (const f of list) if (!next[f]?.trim() && ai.fields[f]) next[f] = ai.fields[f]!;
      }
      return next;
    });
    setTables((prev) => ({
      diseases:
        open("S3_THERAPEUTIC_CONTEXT") && !prev.diseases.length
          ? (ai.tables.diseases ?? [])
          : prev.diseases,
      exposure:
        open("S5_EXPOSURE_ACTIONS") && ai.tables.exposure ? ai.tables.exposure : prev.exposure,
      adrs:
        open("S7_AGGREGATE_SAFETY_DATA") && !prev.adrs.length ? (ai.tables.adrs ?? []) : prev.adrs,
      signals:
        open("S8_SIGNAL_EVALUATION") && !prev.signals.length
          ? (ai.tables.signals ?? [])
          : prev.signals,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAt]);

  async function readSubmission() {
    setReading(true);
    try {
      const next = await psurApi.runV4Prefill(doc.id);
      if (next.v4Prefill?.error) toast.error(next.v4Prefill.error);
      else toast.success("The form has been pre-filled from the submission. Review each section.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The submission could not be read.");
    } finally {
      setReading(false);
    }
  }

  // Read the submission once, the first time an evaluator opens the form.
  const triedPrefill = useRef(false);
  useEffect(() => {
    if (triedPrefill.current || !canEvaluate || doc.v4Prefill || !doc.extractedText?.trim()) return;
    triedPrefill.current = true;
    void readSubmission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEvaluate, doc.id]);

  async function save() {
    setSaving(true);
    try {
      const reviewed = (s: PsurV4SectionId) => drafts[s]!.reviewed;
      const assessments: Partial<Record<PsurV4SectionId, string>> = {};
      const savedFields: Partial<Record<V4FieldId, string>> = {};
      for (const id of SECTIONS) {
        if (!reviewed(id)) continue;
        assessments[id] = drafts[id]!.assessment;
        for (const f of FIELDS[id] ?? []) savedFields[f] = fields[f] ?? "";
      }
      const savedTables: PsurV4Tables = {};
      if (reviewed("S3_THERAPEUTIC_CONTEXT")) savedTables.diseases = tables.diseases;
      if (reviewed("S5_EXPOSURE_ACTIONS")) savedTables.exposure = tables.exposure;
      if (reviewed("S7_AGGREGATE_SAFETY_DATA")) savedTables.adrs = tables.adrs;
      if (reviewed("S8_SIGNAL_EVALUATION")) savedTables.signals = tables.signals;
      await psurApi.updateV4SectionAnswers(doc.id, {
        s2Inconsistent,
        s2Explanation,
        therapeuticIndication: indication,
        // Only what the evaluator changed: the rest keeps following the
        // administrative screening.
        s1: Object.fromEntries(
          (Object.keys(s1) as V4Section1Row[])
            .filter((k) => s1[k].trim() !== (s1Default[k] ?? "").trim())
            .map((k) => [k, s1[k]]),
        ),
        s7AdrTabulation,
        s7VigiflowChecked,
        assessments,
        fields: savedFields,
        tables: savedTables,
        noSignals,
      });
      toast.success("Sections 1-8 saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const tick = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={!canEvaluate}
        aria-label={label}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <span>{label}</span>
    </label>
  );

  const prompt = (section: PsurV4SectionId, f: V4FieldId) => (
    <label key={f} className="block">
      <span className="text-sm font-medium">{v4Field(f).label}:</span>
      <Textarea
        className="mt-1"
        aria-label={v4Field(f).label}
        rows={2}
        value={fields[f] ?? ""}
        disabled={!canEvaluate}
        placeholder="Not assessed — write the answer here, or add research below."
        onChange={(e) => setField(section, f, e.target.value)}
      />
    </label>
  );

  const prefill = doc.v4Prefill;
  const prefillDate = prefill
    ? new Date(prefill.generatedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <Section
      id="v4-sections-1-8"
      title="Sections 1-8 — V4 evaluation form"
      description="Each prompt of the V4 form with a box for its answer, the form's tables and tick boxes, and the research behind the answers. The AI pre-fills what the submission states; until you review a section, the V4 report prints those values marked as not yet reviewed."
      actions={
        canEvaluate ? (
          <Button size="sm" disabled={saving || reading} onClick={save}>
            {saving ? "Saving…" : "Save sections 1-8"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <span role="status">
            {reading
              ? "Reading the submission to pre-fill the form…"
              : prefill?.error
                ? `The AI could not pre-fill the form: ${prefill.error}`
                : prefill
                  ? `Pre-filled by AI from the submission on ${prefillDate}. Check each value against the PSUR.`
                  : doc.extractedText?.trim()
                    ? "Not yet pre-filled from the submission."
                    : "This report has no extracted text, so the form cannot be pre-filled."}
          </span>
          {canEvaluate && doc.extractedText?.trim() ? (
            <Button size="sm" variant="outline" disabled={reading} onClick={readSubmission}>
              <Sparkles className="size-4" />{" "}
              {prefill ? "Read the submission again" : "Pre-fill from the submission"}
            </Button>
          ) : null}
        </div>

        {canResearch ? <PasteResearch doc={doc} onChanged={onChanged} /> : null}

        {SECTIONS.map((id) => {
          const d = drafts[id]!;
          const saved = a?.assessments?.[id];
          return (
            <div
              key={id}
              id={`v4-${id}`}
              className="scroll-mt-4 space-y-3 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{NAME.get(id) ?? id}</p>
                {d.reviewed ? (
                  <StatusPill tone="success">
                    {saved?.by ? `Reviewed by ${saved.by}` : "Reviewed — not yet saved"}
                  </StatusPill>
                ) : (
                  <StatusPill tone="assist">AI draft — not yet reviewed</StatusPill>
                )}
              </div>

              {id === "S1_PRODUCT_REGULATORY" ? (
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {S1_ROWS.map(([key, label]) => (
                        <tr key={key} className="border-b border-border last:border-0">
                          <th className="w-2/5 bg-muted/40 p-2 text-left align-middle font-medium">
                            {label}
                          </th>
                          <td className="p-1">
                            <Input
                              aria-label={label}
                              value={key === "indication" ? indication : s1[key]}
                              disabled={!canEvaluate}
                              placeholder={
                                key === "dateOfReview"
                                  ? "Filled automatically from your sign-off date"
                                  : "Not stated in the submission"
                              }
                              onChange={(e) => {
                                if (key === "indication") setIndication(e.target.value);
                                else setS1((p) => ({ ...p, [key]: e.target.value }));
                                markReviewed(id);
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {id === "S2_WORLDWIDE_STATUS" ? (
                <>
                  {prompt(id, "S2_ACTIONS")}
                  {tick(
                    "Any action inconsistent with, or not yet reflected in, NAFDAC's current position on this product?",
                    s2Inconsistent,
                    setS2Inconsistent,
                  )}
                  {s2Inconsistent ? (
                    <label className="block">
                      <span className="text-sm font-medium">If yes, explain:</span>
                      <Textarea
                        className="mt-1"
                        aria-label="If yes, explain"
                        value={s2Explanation}
                        disabled={!canEvaluate}
                        rows={2}
                        onChange={(e) => setS2Explanation(e.target.value)}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              {id === "S3_THERAPEUTIC_CONTEXT" ? (
                <>
                  {prompt(id, "S3_INCIDENCE")}
                  {prompt(id, "S3_DURATION")}
                  {prompt(id, "S3_MORTALITY")}
                  <RowsEditor
                    label="Disease mortality and severity"
                    columns={DISEASE_COLUMNS}
                    rows={tables.diseases as Row<V4DiseaseRow>[]}
                    blank={{ disease: "", mortality: "", severity: "" }}
                    disabled={!canEvaluate}
                    onChange={(rows) => setTable("diseases", rows)}
                  />
                  {prompt(id, "S3_TREATMENTS")}
                  {prompt(id, "S3_QOL")}
                </>
              ) : null}

              {id === "S4_RSI" ? (FIELDS.S4_RSI ?? []).map((f) => prompt(id, f)) : null}

              {id === "S5_EXPOSURE_ACTIONS" ? (
                <>
                  <ExposureEditor
                    value={tables.exposure as V4ExposureTable}
                    disabled={!canEvaluate}
                    onChange={(v) => setTable("exposure", v)}
                  />
                  {prompt(id, "S5_EXPOSURE")}
                  {prompt(id, "S5_ACTIONS")}
                </>
              ) : null}

              {id === "S6_LITERATURE" ? prompt(id, "S6_STUDIES") : null}

              {id === "S7_AGGREGATE_SAFETY_DATA" ? (
                <>
                  {tick(
                    "Attach or reproduce the MAH's summary tabulation of ADRs and identify any SOCs requiring specific regulatory assessment (add more rows to table below as required)",
                    s7AdrTabulation,
                    setS7AdrTabulation,
                  )}
                  <RowsEditor
                    label="Summary tabulation of ADRs"
                    columns={ADR_COLUMNS}
                    rows={tables.adrs as Row<V4AdrRow>[]}
                    blank={{ soc: "", interval: "", cumulative: "", nigerian: "", assessment: "" }}
                    disabled={!canEvaluate}
                    onChange={(rows) => setTable("adrs", rows)}
                  />
                  {prompt(id, "S7_DIFFERENCES")}
                  {tick(
                    "Check VigiFlow for the Nigerian component of the product's safety data. Document the number of ICSRs received during the reporting interval and cumulatively, including the number of serious cases. Where relevant, compare the VigiFlow data with the Nigerian cases reported by the MAH and document any discrepancies.",
                    s7VigiflowChecked,
                    setS7VigiflowChecked,
                  )}
                  {prompt(id, "S7_VIGIFLOW")}
                </>
              ) : null}

              {id === "S8_SIGNAL_EVALUATION" ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    List every signal that was new, ongoing, or closed during this reporting
                    interval. This section should not be left blank.
                  </p>
                  <RowsEditor
                    label="Signal evaluation log"
                    columns={SIGNAL_COLUMNS}
                    rows={tables.signals as Row<V4SignalRow>[]}
                    blank={{
                      signal: "",
                      source: "",
                      status: "",
                      method: "",
                      outcome: "",
                      dateClosed: "",
                      action: "",
                    }}
                    disabled={!canEvaluate}
                    onChange={(rows) => setTable("signals", rows)}
                  />
                  {tables.signals.length === 0
                    ? tick(NO_SIGNALS, noSignals, (v) => {
                        setNoSignals(v);
                        markReviewed(id);
                      })
                    : null}
                </>
              ) : null}

              {RESEARCH[id] ? (
                <V4ResearchCard
                  doc={doc}
                  criterion={RESEARCH[id]!}
                  canEdit={canResearch}
                  onChanged={onChanged}
                />
              ) : null}

              <label className="block">
                <span className="text-sm font-medium">Reviewer's assessment of this section:</span>
                <Textarea
                  className="mt-1"
                  aria-label={`Reviewer's assessment of ${NAME.get(id) ?? id}`}
                  value={d.assessment}
                  disabled={!canEvaluate}
                  rows={3}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [id]: { assessment: e.target.value, reviewed: true },
                    }))
                  }
                />
              </label>
              {canEvaluate ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={d.reviewed}
                    aria-label={`I have reviewed ${NAME.get(id) ?? id}`}
                    onCheckedChange={(c) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id]!, reviewed: c === true },
                      }))
                    }
                  />
                  I have reviewed this section
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * The V4 report's page header and footer. Pre-filled with this report's
 * own, else the last one saved on any report, else the template's; saving
 * it makes it the one later reports start from.
 */
export function V4PageTextEditor({
  doc,
  allDocs,
  onChanged,
}: {
  doc: PsurDocument;
  allDocs: PsurDocument[];
  onChanged: () => void;
}) {
  const canEvaluate = usePermission("psur.evaluate");
  const start = doc.v4PageText ?? latestV4PageText(allDocs) ?? V4_DEFAULT_PAGE_TEXT;
  const [text, setText] = useState({
    annexure: start.annexure,
    sopRef: start.sopRef,
    title: start.title,
    footer: start.footer,
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = (key: keyof typeof text, label: string) => (
    <label className="block">
      <span className="label-caps">{label}</span>
      <Input
        className="mt-1"
        aria-label={label}
        value={text[key]}
        disabled={!canEvaluate}
        onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
      />
    </label>
  );
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide" : "Edit"} the page header and footer
      </button>
      {open ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_1.5fr_2fr]">
            {input("annexure", "Header: annexure")}
            {input("sopRef", "Header: SOP reference")}
            {input("title", "Header: title of annexure")}
          </div>
          {input("footer", "Footer")}
          <p className="text-xs text-muted-foreground">
            “Page X of Y” is added after the footer automatically. Saved text carries forward to the
            next report.
          </p>
          {canEvaluate ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await psurApi.updateV4PageText(doc.id, text);
                    toast.success("Header and footer saved.");
                    onChanged();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not save.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save header and footer"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setText({
                    annexure: V4_DEFAULT_PAGE_TEXT.annexure,
                    sopRef: V4_DEFAULT_PAGE_TEXT.sopRef,
                    title: V4_DEFAULT_PAGE_TEXT.title,
                    footer: V4_DEFAULT_PAGE_TEXT.footer,
                  })
                }
              >
                Reset to the template's
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
