import { supabase } from "@/integrations/supabase/client";
import { currentActor, recordAudit, pushNotification, toJson } from "./db";
import type { CaseDetail, SeriousnessAssessment } from "@/types/pv";

const ICH_CRITERIA = [
  { criterion: "Death", markers: ["died", "death", "fatal"] },
  { criterion: "Life-threatening", markers: ["life-threatening", "anaphyla", "collapse"] },
  { criterion: "Hospitalisation", markers: ["hospital", "admitted", "admission", "icu"] },
  { criterion: "Disability / incapacity", markers: ["disab", "incapacit", "permanent"] },
  { criterion: "Congenital anomaly", markers: ["congenital", "birth defect"] },
  { criterion: "Other medically important", markers: ["emergency", "intervention", "seizure"] },
];

function analyse(detail: CaseDetail): SeriousnessAssessment {
  const text = `${detail.narrative} ${detail.reaction}`.toLowerCase();
  const criteria = ICH_CRITERIA.map((c) => {
    const hits = c.markers.filter((m) => text.includes(m));
    return {
      criterion: c.criterion,
      detected: hits.length > 0,
      evidence: hits.map((h) => `Narrative mentions “${h}”.`),
    };
  });
  const detected = criteria.some((c) => c.detected);
  const narrativeAssessment = detected ? ("SERIOUS" as const) : ("NON_SERIOUS" as const);
  return {
    caseId: detail.id,
    reportedSeriousness: detail.seriousness,
    narrativeAssessment,
    mismatch: detail.seriousness !== "UNASSESSED" && detail.seriousness !== narrativeAssessment,
    criteria,
    rationale: detected
      ? "One or more ICH E2D seriousness criteria are supported by narrative evidence. Reviewer confirmation is required."
      : "No ICH E2D seriousness criterion was supported by the narrative. Reviewer confirmation is required.",
    engineVersion: "pv_assist.seriousness 1.0",
    reviewState: "PENDING_REVIEW",
  };
}

async function read(caseId: string): Promise<SeriousnessAssessment | null> {
  const { data, error } = await supabase
    .from("pv_seriousness")
    .select("data")
    .eq("case_id", caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.data as unknown as SeriousnessAssessment) : null;
}

async function save(assessment: SeriousnessAssessment) {
  const { error } = await supabase
    .from("pv_seriousness")
    .upsert({ case_id: assessment.caseId, data: toJson(assessment) }, { onConflict: "case_id" });
  if (error) throw new Error(error.message);
}

/** Assistive only: the official case value is never changed by an analysis. */
export const seriousness = {
  get: async (caseId: string): Promise<SeriousnessAssessment> => {
    const existing = await read(caseId);
    if (existing) return existing;
    const { cases } = await import("./cases");
    return analyse(await cases.get(caseId));
  },

  analyzeCase: async (caseId: string): Promise<SeriousnessAssessment> => {
    const { cases } = await import("./cases");
    const assessment = analyse(await cases.get(caseId));
    await save(assessment);
    await recordAudit({
      action: "SERIOUSNESS_ANALYSED",
      entity: "Case",
      entityId: caseId,
      newValue: assessment.narrativeAssessment,
      reason: "Assistive seriousness analysis requested",
    });
    if (assessment.mismatch) {
      await pushNotification({
        type: "SERIOUSNESS_MISMATCH",
        title: `Seriousness mismatch on ${caseId}`,
        body: `Reported ${assessment.reportedSeriousness}, narrative suggests ${assessment.narrativeAssessment}.`,
        link: `/cases/${caseId}`,
      });
    }
    return assessment;
  },

  recordDecision: async (
    caseId: string,
    decision: "ACCEPT_REPORTED" | "MARK_SERIOUS" | "REQUEST_INFO",
    rationale: string,
  ): Promise<SeriousnessAssessment> => {
    const actor = currentActor();
    const base = await seriousness.get(caseId);
    const next: SeriousnessAssessment = {
      ...base,
      reviewState: "REVIEWED",
      reviewedBy: actor.name,
      reviewDecision: decision,
      rationale,
    };
    await save(next);

    if (decision === "MARK_SERIOUS") {
      const { cases } = await import("./cases");
      const detail = await cases.get(caseId);
      const updated: CaseDetail = { ...detail, seriousness: "SERIOUS" };
      await supabase.from("pv_cases").update({ data: toJson(updated) }).eq("id", caseId);
    }

    await recordAudit({
      action: "SERIOUSNESS_DECISION",
      entity: "Case",
      entityId: caseId,
      previousValue: base.reportedSeriousness,
      newValue: decision,
      reason: rationale,
    });
    return next;
  },
};
