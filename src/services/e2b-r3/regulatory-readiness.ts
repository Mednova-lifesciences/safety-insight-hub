import { UNCONFIRMED_SENTINEL, senderSameAsReceiver } from "./transmission-config";
import type { OrgRegulatoryConfig } from "./regulatory-config";
import type { CaseValidationResult } from "./validation";

/**
 * The two-tier E2B(R3) generation readiness check the task requires:
 * ORGANIZATION-level configuration gaps (sender/receiver identifiers,
 * report type, outcome codelist — resolved once, in Settings, by an
 * admin) are a structurally different kind of blocker from CASE-level
 * data gaps (this specific job's rows have an unmapped reporter
 * designation, an outcome the codelist doesn't cover yet, ...). Collapsing
 * both into one generic "generation failed" message is exactly what this
 * module exists to prevent — see docs/E2B-R3-NAFDAC-VIGIFLOW.md and the
 * UI at routes/_app/e2b.tsx and routes/_app/settings.tsx, both of which
 * render these two lists separately, never merged.
 */

export type OrganizationReadinessKey = "SENDER" | "RECEIVER" | "REPORT_TYPE";

export interface OrganizationReadinessItem {
  key: OrganizationReadinessKey;
  label: string;
  status: "CONFIGURED" | "MISSING" | "NOT_VERIFIED";
  detail: string;
}

/** Pure function of the org's persisted regulatory config — no DB access,
 *  independently testable. Never infers "configured" from anything other
 *  than an explicit, non-sentinel value (sender/receiver) or an explicit
 *  confirmed flag / non-empty codelist (report type / outcome codelist). */
export function computeOrganizationReadiness(
  config: OrgRegulatoryConfig,
): OrganizationReadinessItem[] {
  const items: OrganizationReadinessItem[] = [];

  items.push(
    senderSameAsReceiver(config.transmission)
      ? {
          key: "SENDER",
          label: "Sender transmission identifier",
          status: "NOT_VERIFIED",
          detail: `The sender identifier is the same as the receiver's ("${config.transmission.sender.identifier}"). Enter your own organization's identifier as the sender.`,
        }
      : config.transmission.sender.identifier !== UNCONFIRMED_SENTINEL &&
          config.transmission.sender.organization !== UNCONFIRMED_SENTINEL
        ? {
            key: "SENDER",
            label: "Sender transmission identifier",
            status: "CONFIGURED",
            detail: `Sender organisation "${config.transmission.sender.organization}", identifier "${config.transmission.sender.identifier}".`,
          }
        : {
            key: "SENDER",
            label: "Sender transmission identifier",
            status: "MISSING",
            detail:
              "Not yet supplied by NAFDAC/Ondo. Configure under Settings → Regulatory Profiles.",
          },
  );

  items.push(
    config.transmission.receiver.identifier !== UNCONFIRMED_SENTINEL
      ? {
          key: "RECEIVER",
          label: "Receiver transmission identifier",
          status: "CONFIGURED",
          detail: `Receiver identifier "${config.transmission.receiver.identifier}".`,
        }
      : {
          key: "RECEIVER",
          label: "Receiver transmission identifier",
          status: "MISSING",
          detail:
            "Not yet supplied by NAFDAC/Ondo. Configure under Settings → Regulatory Profiles.",
        },
  );

  items.push(
    config.transmission.reportTypeConfirmed === true
      ? {
          key: "REPORT_TYPE",
          label: "C.1.3 report type",
          status: "CONFIGURED",
          detail: `Confirmed value "${config.transmission.reportType}".`,
        }
      : {
          key: "REPORT_TYPE",
          label: "C.1.3 report type",
          status: "NOT_VERIFIED",
          detail:
            "Decision D3 has not been confirmed with NAFDAC. Configure under Settings → Regulatory Profiles.",
        },
  );

  return items;
}

export function isOrganizationReady(items: OrganizationReadinessItem[]): boolean {
  return items.every((i) => i.status === "CONFIGURED");
}

export interface CaseLevelBlockerSummary {
  /** One entry per DISTINCT unmapped designation, so a caller can render
   *  "7 cases have unmapped reporter designation: CHO" per the task's own
   *  example — never a flat count that hides which designation(s) are
   *  responsible. */
  unmappedReporterDesignations: { designation: string; caseCount: number }[];
}

/** Rolls up case-level validation results into the counts/labels the E2B
 *  page's readiness panel renders — pure, and independent of whichever
 *  validation codes happen to produce these findings (E2B-REPORTER-
 *  QUALIFICATION-UNRESOLVED / VIGIFLOW-REPORTER-QUALIFICATION-UNRESOLVED
 *  for designations). E.i.7 outcomes are the fixed ICH codelist and can
 *  never be an organization-configuration gap, so they are not counted. */
export function summarizeCaseLevelBlockers(
  results: CaseValidationResult[],
): CaseLevelBlockerSummary {
  const designationCounts = new Map<string, number>();

  for (const result of results) {
    const designationsThisCase = new Set<string>();
    for (const e of result.errors) {
      if (
        (e.code === "E2B-REPORTER-QUALIFICATION-UNRESOLVED" ||
          e.code === "VIGIFLOW-REPORTER-QUALIFICATION-UNRESOLVED") &&
        e.sourceValue
      ) {
        designationsThisCase.add(e.sourceValue);
      }
    }
    for (const d of designationsThisCase) {
      designationCounts.set(d, (designationCounts.get(d) ?? 0) + 1);
    }
  }

  return {
    unmappedReporterDesignations: [...designationCounts.entries()]
      .map(([designation, caseCount]) => ({ designation, caseCount }))
      .sort((a, b) => b.caseCount - a.caseCount),
  };
}
