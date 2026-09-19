import { supabase } from "@/integrations/supabase/client";
import { newId, toJson } from "@/services/api/db";
import type { PVCase } from "./types";
import {
  E2B_C17_ASSESSMENT_TYPE,
  type E2bAssessmentDecision,
  type E2bRegulatoryAssessment,
} from "./assessment-types";
import { c17SourceHash, evaluateProvisionalC17 } from "./assessment-rules";
import type { C17AiAssessmentRecord } from "./ai-assessment-types";

export function canFinalizeC17Assessment(actor: { role?: string } | undefined): boolean {
  const role = actor?.role?.toUpperCase();
  return role === "REVIEW_OFFICER" || role === "EVALUATOR" || role === "PEER_REVIEWER";
}

async function getTrustedFinalizationActor(): Promise<{
  id: string;
  name: string;
  role: string;
  organizationId: string;
}> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("You must be signed in to finalize the C.1.7 decision.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, organization_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile) {
    throw new Error("Your profile could not be loaded for finalization.");
  }

  const role = typeof profile.role === "string" ? profile.role.toUpperCase() : "";
  const organizationId = typeof profile.organization_id === "string" ? profile.organization_id : "";
  if (!role || !organizationId) {
    throw new Error("Your account is not authorized to finalize the C.1.7 decision.");
  }

  return {
    id: userData.user.id,
    name:
      typeof profile.full_name === "string" && profile.full_name.trim().length > 0
        ? profile.full_name.trim()
        : (userData.user.email ?? "Signed-in user"),
    role,
    organizationId,
  };
}

export function assertC17FinalizationPreconditions(
  assessment: E2bRegulatoryAssessment,
  actor: { role?: string } | undefined,
  decision: E2bAssessmentDecision,
): void {
  if (!canFinalizeC17Assessment(actor)) {
    throw new Error("Only a qualified NAFDAC assessor may finalize the C.1.7 decision.");
  }
  if (assessment.status === "FINALIZED") {
    throw new Error("This C.1.7 decision has already been finalized and cannot be overwritten.");
  }
  if (assessment.finalDecision && assessment.finalDecision !== decision) {
    throw new Error("A finalized C.1.7 decision cannot be changed by a new override.");
  }
}

function fromRow(row: {
  id: string;
  organization_id?: string | null;
  data: unknown;
}): E2bRegulatoryAssessment {
  const data = row.data as E2bRegulatoryAssessment;
  const orgId = row.organization_id ?? data.organizationId;
  const next: E2bRegulatoryAssessment = {
    ...data,
    id: row.id,
  };
  if (orgId) {
    next.organizationId = orgId;
  }
  return next;
}

/** The newest assessment per case — the one preflight and export act on.
 *  Superseded versions stay in the database as history but must never be
 *  shown as pending or finalized in their place. */
export function latestC17AssessmentsByCase(
  assessments: E2bRegulatoryAssessment[],
): E2bRegulatoryAssessment[] {
  const latest = new Map<string, E2bRegulatoryAssessment>();
  for (const assessment of assessments) {
    const current = latest.get(assessment.caseId);
    if (!current || (assessment.assessmentVersion ?? 1) >= (current.assessmentVersion ?? 1)) {
      latest.set(assessment.caseId, assessment);
    }
  }
  return [...latest.values()];
}

/** Ids of the latest per-case assessments still awaiting a human decision. */
export function pendingC17AssessmentIds(assessments: E2bRegulatoryAssessment[]): string[] {
  return latestC17AssessmentsByCase(assessments)
    .filter((assessment) => assessment.status !== "FINALIZED" && assessment.id)
    .map((assessment) => assessment.id!);
}

export function assessC17(
  pvCase: PVCase,
  context: { jobId: string; jurisdiction?: string; configurationRevision?: string },
): E2bRegulatoryAssessment {
  return evaluateProvisionalC17(pvCase, context);
}

export function applyFinalizedC17(
  pvCase: PVCase,
  assessment: E2bRegulatoryAssessment | undefined,
): PVCase {
  if (
    assessment?.status !== "FINALIZED" ||
    !assessment.finalDecision ||
    !assessment.sourceSnapshot.snapshot ||
    assessment.sourceSnapshot.caseHash !== c17SourceHash(pvCase)
  )
    return pvCase;
  return {
    ...pvCase,
    fulfilsExpeditedCriteria: {
      present: true,
      value: assessment.finalDecision === "YES",
    },
  };
}

export async function saveC17Recommendation(
  assessment: E2bRegulatoryAssessment,
): Promise<E2bRegulatoryAssessment> {
  const id = assessment.id ?? newId("e2b-assessment");
  const data = { ...assessment, id, updatedAt: new Date().toISOString() };
  const { data: saved, error } = await supabase.rpc("save_e2b_c17_recommendation", {
    p_assessment: toJson(data),
    p_assessment_id: id,
    p_case_id: assessment.caseId,
    p_job_id: assessment.jobId,
    p_supersedes_id: assessment.supersedesAssessmentId ?? null,
  });
  if (error) throw new Error(error.message);
  return saved as unknown as E2bRegulatoryAssessment;
}

export async function listC17Assessments(jobId: string): Promise<E2bRegulatoryAssessment[]> {
  const { data, error } = await supabase
    .from("pv_e2b_regulatory_assessments")
    .select("id,organization_id,data")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => fromRow(row));
}

export async function finalizeC17Assessment(
  assessmentId: string,
  decision: E2bAssessmentDecision,
  rationale: string,
): Promise<E2bRegulatoryAssessment> {
  if (!rationale.trim()) throw new Error("A rationale is required for the C.1.7 decision.");
  const { data, error } = await supabase.rpc("finalize_e2b_c17_assessment", {
    p_assessment_id: assessmentId,
    p_decision: decision,
    p_rationale: rationale.trim(),
  });
  if (error) throw new Error(error.message);
  return data as unknown as E2bRegulatoryAssessment;
}

/** Finalizes several cases with one decision and rationale, atomically:
 *  if any case cannot be finalized, none are. Each case still goes through
 *  the same server-side role check, immutability guard and audit event as
 *  finalizeC17Assessment. */
export async function finalizeC17AssessmentsBulk(
  assessmentIds: string[],
  decision: E2bAssessmentDecision,
  rationale: string,
): Promise<E2bRegulatoryAssessment[]> {
  if (assessmentIds.length === 0) throw new Error("There are no C.1.7 decisions to finalize.");
  if (!rationale.trim()) throw new Error("A rationale is required for the C.1.7 decision.");
  const { data, error } = await supabase.rpc("finalize_e2b_c17_assessments_bulk", {
    p_assessment_ids: assessmentIds,
    p_decision: decision,
    p_rationale: rationale.trim(),
  });
  if (error) throw new Error(error.message);
  return data as unknown as E2bRegulatoryAssessment[];
}

export async function saveC17AiAssessment(
  record: C17AiAssessmentRecord,
  regulatoryAssessmentId?: string,
): Promise<C17AiAssessmentRecord> {
  const { data, error } = await supabase.rpc("save_e2b_c17_ai_assessment", {
    p_ai_assessment_id: record.id,
    p_regulatory_assessment_id: regulatoryAssessmentId ?? null,
    p_case_id: record.caseId,
    p_input_snapshot_hash: record.inputSnapshotHash,
    p_input_version: record.inputVersion,
    p_rule_id: record.rule.id,
    p_rule_version: record.rule.version,
    p_provider: record.provider,
    p_model: record.model ?? null,
    p_model_version: record.modelVersion ?? null,
    p_prompt_version: record.promptVersion,
    p_status: record.status,
    p_data: toJson(record),
  });
  if (error) throw new Error(error.message);
  return data as unknown as C17AiAssessmentRecord;
}

/** AI records for one case or many. Many are fetched in chunks rather than
 *  one request per case, which for a full line list was hundreds of calls
 *  on every preflight. */
export async function listC17AiAssessments(
  caseIds: string | string[],
): Promise<C17AiAssessmentRecord[]> {
  const ids = [...new Set(Array.isArray(caseIds) ? caseIds : [caseIds])];
  const records: C17AiAssessmentRecord[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("pv_e2b_c17_ai_assessments")
      .select("data")
      .in("case_id", ids.slice(i, i + 100))
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    records.push(...(data ?? []).map((row) => row.data as unknown as C17AiAssessmentRecord));
  }
  return records;
}
