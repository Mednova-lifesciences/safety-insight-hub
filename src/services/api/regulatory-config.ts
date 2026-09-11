import { supabase } from "@/integrations/supabase/client";
import { newId, recordAudit, toJson } from "./db";
import {
  unconfiguredOrgRegulatoryConfig,
  normalizeDesignationKey,
  type OrgRegulatoryConfig,
  type OrgQualificationMapping,
} from "@/services/e2b-r3/regulatory-config";
import { UNCONFIRMED_SENTINEL } from "@/services/e2b-r3/transmission-config";
import type { ReactionOutcome, ReportType } from "@/services/e2b-r3/types";

/**
 * Persistence for the org-scoped NAFDAC E2B(R3) regulatory configuration
 * (src/services/e2b-r3/regulatory-config.ts's OrgRegulatoryConfig) —
 * pv_regulatory_config (one row per org, decisions D3/D4 + the E.i.7
 * outcome codelist) and pv_reporter_qualification_mappings (open-ended
 * per-org designation -> code table). Org isolation is enforced by RLS
 * (see supabase/migrations/021_regulatory_config.sql) exactly like every
 * other pv_* table in this app — this module never filters by
 * organization_id itself.
 *
 * Every write here is audited via the existing recordAudit mechanism
 * (previous value, new value, actor, timestamp) — configuration this
 * consequential must never change silently. See docs/E2B-R3-NAFDAC-VIGIFLOW.md.
 */

interface RegulatoryConfigRow {
  environment: "uat" | "production";
  sender_organization: string | null;
  sender_identifier: string | null;
  sender_type: string | null;
  sender_person_responsible: string | null;
  receiver_organization: string | null;
  receiver_identifier: string | null;
  report_type: string | null;
  report_type_confirmed: boolean;
  case_id_prefix: string | null;
  outcome_codes: unknown;
}

interface QualificationMappingRow {
  id: string;
  designation: string;
  designation_key: string;
  qualification_code: string | null;
}

function mappingFromRow(row: QualificationMappingRow): OrgQualificationMapping {
  return {
    id: row.id,
    designation: row.designation,
    designationKey: row.designation_key,
    code: (row.qualification_code as OrgQualificationMapping["code"]) ?? undefined,
  };
}

function configFromRows(
  configRow: RegulatoryConfigRow | null,
  mappingRows: QualificationMappingRow[],
): OrgRegulatoryConfig {
  const reporterQualificationMappings = mappingRows.map(mappingFromRow);
  if (!configRow) {
    return { ...unconfiguredOrgRegulatoryConfig(), reporterQualificationMappings };
  }
  const outcomeCodes =
    configRow.outcome_codes && typeof configRow.outcome_codes === "object"
      ? (configRow.outcome_codes as Partial<Record<ReactionOutcome, string>>)
      : {};
  return {
    transmission: {
      environment: configRow.environment,
      sender: {
        organization: configRow.sender_organization || UNCONFIRMED_SENTINEL,
        identifier: configRow.sender_identifier || UNCONFIRMED_SENTINEL,
        type: configRow.sender_type ?? undefined,
        personResponsible: configRow.sender_person_responsible ?? undefined,
      },
      receiver: {
        organization: configRow.receiver_organization ?? undefined,
        identifier: configRow.receiver_identifier || UNCONFIRMED_SENTINEL,
      },
      reportType: (configRow.report_type as ReportType | null) ?? "4",
      reportTypeConfirmed: configRow.report_type_confirmed === true,
      caseIdPrefix: configRow.case_id_prefix ?? undefined,
    },
    outcomeCodes,
    reporterQualificationMappings,
  };
}

async function fetchConfigRow(): Promise<RegulatoryConfigRow | null> {
  const { data, error } = await supabase.from("pv_regulatory_config").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data as RegulatoryConfigRow | null;
}

async function fetchMappingRows(): Promise<QualificationMappingRow[]> {
  const { data, error } = await supabase
    .from("pv_reporter_qualification_mappings")
    .select("id,designation,designation_key,qualification_code")
    .order("designation", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QualificationMappingRow[];
}

export interface TransmissionConfigPatch {
  environment?: "uat" | "production";
  senderOrganization?: string | null;
  senderIdentifier?: string | null;
  senderType?: string | null;
  senderPersonResponsible?: string | null;
  receiverOrganization?: string | null;
  receiverIdentifier?: string | null;
  reportType?: ReportType | null;
  reportTypeConfirmed?: boolean;
  caseIdPrefix?: string | null;
}

export const regulatoryConfig = {
  /** Always returns a usable OrgRegulatoryConfig, even for a brand-new
   *  org with no row yet — never throws on "not configured", since that
   *  is an expected, common, honestly-represented state (see
   *  unconfiguredOrgRegulatoryConfig). */
  get: async (): Promise<OrgRegulatoryConfig> => {
    const [configRow, mappingRows] = await Promise.all([fetchConfigRow(), fetchMappingRows()]);
    return configFromRows(configRow, mappingRows);
  },

  /** Partial update — only the fields present in `patch` change. Reads
   *  the current row first so the audit trail records real previous ->
   *  new values, never just "updated". */
  saveTransmission: async (patch: TransmissionConfigPatch): Promise<void> => {
    const before = await fetchConfigRow();
    const merged = {
      environment: patch.environment ?? before?.environment ?? "uat",
      sender_organization:
        patch.senderOrganization !== undefined
          ? patch.senderOrganization
          : (before?.sender_organization ?? null),
      sender_identifier:
        patch.senderIdentifier !== undefined
          ? patch.senderIdentifier
          : (before?.sender_identifier ?? null),
      sender_type:
        patch.senderType !== undefined ? patch.senderType : (before?.sender_type ?? null),
      sender_person_responsible:
        patch.senderPersonResponsible !== undefined
          ? patch.senderPersonResponsible
          : (before?.sender_person_responsible ?? null),
      receiver_organization:
        patch.receiverOrganization !== undefined
          ? patch.receiverOrganization
          : (before?.receiver_organization ?? null),
      receiver_identifier:
        patch.receiverIdentifier !== undefined
          ? patch.receiverIdentifier
          : (before?.receiver_identifier ?? null),
      report_type:
        patch.reportType !== undefined ? patch.reportType : (before?.report_type ?? null),
      report_type_confirmed:
        patch.reportTypeConfirmed !== undefined
          ? patch.reportTypeConfirmed
          : (before?.report_type_confirmed ?? false),
      case_id_prefix:
        patch.caseIdPrefix !== undefined ? patch.caseIdPrefix : (before?.case_id_prefix ?? null),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("pv_regulatory_config")
      .upsert(merged, { onConflict: "organization_id" });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "REGULATORY_CONFIG_TRANSMISSION_UPDATED",
      entity: "RegulatoryConfig",
      entityId: "transmission",
      previousValue: before
        ? `sender=${before.sender_organization ?? "—"}/${before.sender_identifier ?? "—"}, receiver=${before.receiver_identifier ?? "—"}, reportType=${before.report_type ?? "—"} (confirmed=${before.report_type_confirmed})`
        : "not configured",
      newValue: `sender=${merged.sender_organization ?? "—"}/${merged.sender_identifier ?? "—"}, receiver=${merged.receiver_identifier ?? "—"}, reportType=${merged.report_type ?? "—"} (confirmed=${merged.report_type_confirmed})`,
    });
  },

  /** Sets one outcome's confirmed E.i.7 code — merges into the existing
   *  outcome_codes jsonb rather than replacing the whole object, so
   *  configuring one outcome never clobbers another admin's earlier
   *  entry for a different one. */
  saveOutcomeCode: async (outcome: ReactionOutcome, code: string): Promise<void> => {
    const before = await fetchConfigRow();
    const previousCodes =
      before?.outcome_codes && typeof before.outcome_codes === "object"
        ? (before.outcome_codes as Partial<Record<ReactionOutcome, string>>)
        : {};
    const nextCodes = { ...previousCodes, [outcome]: code };
    const { error } = await supabase.from("pv_regulatory_config").upsert(
      {
        environment: before?.environment ?? "uat",
        sender_organization: before?.sender_organization ?? null,
        sender_identifier: before?.sender_identifier ?? null,
        sender_type: before?.sender_type ?? null,
        sender_person_responsible: before?.sender_person_responsible ?? null,
        receiver_organization: before?.receiver_organization ?? null,
        receiver_identifier: before?.receiver_identifier ?? null,
        report_type: before?.report_type ?? null,
        report_type_confirmed: before?.report_type_confirmed ?? false,
        case_id_prefix: before?.case_id_prefix ?? null,
        outcome_codes: toJson(nextCodes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "REGULATORY_CONFIG_OUTCOME_CODE_UPDATED",
      entity: "RegulatoryConfig",
      entityId: `outcome:${outcome}`,
      previousValue: previousCodes[outcome] ?? "not configured",
      newValue: code,
    });
  },

  listReporterQualificationMappings: async (): Promise<OrgQualificationMapping[]> => {
    return (await fetchMappingRows()).map(mappingFromRow);
  },

  /** Admin sets/edits the code for one designation. Upserts on the
   *  (organization_id, designation_key) unique constraint, so mapping an
   *  already-discovered-but-unconfigured designation (see
   *  discoverReporterDesignations) fills in its code rather than creating
   *  a duplicate row. */
  upsertReporterQualificationMapping: async (
    designation: string,
    code: "1" | "2" | "3" | "4" | "5",
  ): Promise<void> => {
    const designationKey = normalizeDesignationKey(designation);
    const existing = (await fetchMappingRows()).find((m) => m.designation_key === designationKey);
    const { error } = await supabase.from("pv_reporter_qualification_mappings").upsert(
      {
        id: existing?.id ?? newId("rqm"),
        designation,
        designation_key: designationKey,
        qualification_code: code,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,designation_key" },
    );
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "REGULATORY_CONFIG_QUALIFICATION_MAPPING_UPDATED",
      entity: "ReporterQualificationMapping",
      entityId: designationKey,
      previousValue: existing?.qualification_code ?? "not configured",
      newValue: code,
      reason: `Designation "${designation}"`,
    });
  },

  deleteReporterQualificationMapping: async (id: string): Promise<void> => {
    const { data } = await supabase
      .from("pv_reporter_qualification_mappings")
      .select("designation,designation_key,qualification_code")
      .eq("id", id)
      .maybeSingle();
    const { error } = await supabase
      .from("pv_reporter_qualification_mappings")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "REGULATORY_CONFIG_QUALIFICATION_MAPPING_REMOVED",
      entity: "ReporterQualificationMapping",
      entityId: (data?.designation_key as string | undefined) ?? id,
      previousValue: (data?.qualification_code as string | undefined) ?? null,
      reason: data?.designation ? `Designation "${data.designation}" removed` : null,
    });
  },
};

/** Passive discovery: inserts a "seen but not yet configured" row (null
 *  code) for any designation not already present for this org — never
 *  overwrites an existing row, configured or not (ignoreDuplicates: true
 *  on the (organization_id, designation_key) unique constraint means a
 *  conflicting insert is silently skipped rather than touching the
 *  existing row). Called from export.ts's runValidatedPreflightForJob so
 *  a new designation shows up on the Settings page automatically. Never
 *  audited as a "configuration change" — nothing was actually configured,
 *  only observed. */
export async function discoverReporterDesignations(designations: string[]): Promise<void> {
  const rows = designations.map((designation) => ({
    id: newId("rqm"),
    designation,
    designation_key: normalizeDesignationKey(designation),
    qualification_code: null,
  }));
  const { error } = await supabase
    .from("pv_reporter_qualification_mappings")
    .upsert(rows, { onConflict: "organization_id,designation_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
