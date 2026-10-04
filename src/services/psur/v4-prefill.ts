import type { AiPsurV4PrefillResponse } from "@/services/api/ai";
import type { PsurV4Prefill, PsurV4Tables, V4ExposureTable } from "@/types/pv";
import type { V4FieldId } from "./v4-fields";

/** The AI's field names, and the V4 form field each one answers. */
export const PREFILL_FIELD: Record<string, V4FieldId> = {
  worldwide_actions: "S2_ACTIONS",
  incidence_prevalence: "S3_INCIDENCE",
  disease_duration: "S3_DURATION",
  mortality_severity: "S3_MORTALITY",
  treatment_options: "S3_TREATMENTS",
  quality_of_life: "S3_QOL",
  rsi_type_version: "S4_TYPE_VERSION",
  rsi_changes: "S4_CHANGES",
  rsi_rationale: "S4_RATIONALE",
  exposure_detail: "S5_EXPOSURE",
  safety_actions: "S5_ACTIONS",
  studies: "S6_STUDIES",
  nigeria_vs_global: "S7_DIFFERENCES",
};

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * The AI's reading of the submission, in the V4 form's own shape. Fields
 * the AI did not find stay absent, so the report says "Not assessed"
 * rather than printing an empty answer; table rows with nothing in them
 * are dropped. VigiFlow is never pre-filled: the submission is not where
 * VigiFlow's figures come from.
 */
export function prefillFromAi(r: AiPsurV4PrefillResponse, at: string): PsurV4Prefill {
  if (!r.ai_used || r.error) {
    return {
      fields: {},
      tables: {},
      generatedAt: at,
      error: r.error ?? "The AI could not read the submission.",
    };
  }
  const fields: Partial<Record<V4FieldId, string>> = {};
  for (const [key, field] of Object.entries(PREFILL_FIELD)) {
    const v = clean(r.fields?.[key]);
    if (v) fields[field] = v;
  }
  const tables: PsurV4Tables = {};
  const diseases = (r.diseases ?? [])
    .map((d) => ({
      disease: clean(d.disease),
      mortality: clean(d.mortality),
      severity: clean(d.severity),
    }))
    .filter((d) => d.disease || d.mortality || d.severity);
  if (diseases.length) tables.diseases = diseases;
  const e = r.exposure;
  if (e && Object.values(e).some((v) => clean(v))) {
    tables.exposure = {
      global: { interval: clean(e.global_interval), cumulative: clean(e.global_cumulative) },
      nigerian: { interval: clean(e.nigerian_interval), cumulative: clean(e.nigerian_cumulative) },
      otherRegion: clean(e.other_region),
      other: { interval: clean(e.other_interval), cumulative: clean(e.other_cumulative) },
    };
  }
  const adrs = (r.adrs ?? [])
    .map((a) => ({
      soc: clean(a.soc),
      interval: clean(a.interval),
      cumulative: clean(a.cumulative),
      nigerian: clean(a.nigerian),
      // The reviewer's assessment column is the evaluator's, never the AI's.
      assessment: "",
    }))
    .filter((a) => a.soc);
  if (adrs.length) tables.adrs = adrs;
  const signals = (r.signals ?? [])
    .map((x) => ({
      signal: clean(x.signal),
      source: clean(x.source),
      status: clean(x.status),
      method: clean(x.method),
      outcome: clean(x.outcome),
      dateClosed: clean(x.date_closed),
      action: clean(x.action),
    }))
    .filter((x) => x.signal);
  if (signals.length) tables.signals = signals;
  return { fields, tables, generatedAt: at, model: r.model ?? undefined };
}

/** Section 5's exposure table with nothing in it. */
export const EMPTY_EXPOSURE: V4ExposureTable = {
  global: { interval: "", cumulative: "" },
  nigerian: { interval: "", cumulative: "" },
  otherRegion: "",
  other: { interval: "", cumulative: "" },
};
