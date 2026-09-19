import type { SourceProfile } from "./source-profiles/types";
import type { ReactionOutcome } from "./types";
import { applyOrgOutcomeTerms, type OrgTermMapping } from "./term-mappings";
import { UNCONFIRMED_SENTINEL, type E2bTransmissionConfig } from "./transmission-config";

/**
 * The persistent, org-scoped NAFDAC E2B(R3) regulatory configuration this
 * module's callers actually operate on — the runtime shape produced by
 * services/api/regulatory-config.ts from the pv_regulatory_config /
 * pv_reporter_qualification_mappings tables. This file is deliberately
 * free of any Supabase/DB import: everything here is a pure type or pure
 * function, testable without a database, exactly like transmission-config.ts
 * and source-profiles/runtime-profile.ts.
 *
 * Four org-level regulatory decisions, all previously either hardcoded,
 * function-parameter-only, or embedded in a source profile — now unified
 * under one persistent, admin-configured, audited object:
 *   - sender/receiver transmission identifiers + C.1.3 report type
 *     (transmission-config.ts's E2bTransmissionConfig — reused as-is)
 *   - the E.i.7 outcome codelist (canonical ReactionOutcome -> NAFDAC-
 *     confirmed numeric code)
 *   - the C.2.r.4 reporter-qualification designation -> code mapping
 *     (previously hardcoded per-source-profile in ondo-aefi.ts; that
 *     hardcoded map is now treated as a SEED/fallback only — see
 *     mergeOrgRegulatoryConfigIntoProfile below — never the authoritative
 *     source once an org has its own persisted mappings).
 */
export interface OrgRegulatoryConfig {
  transmission: E2bTransmissionConfig;
  /** Legacy database field retained for backward compatibility only.
   * E2B generation never reads it; E.i.7 is application-controlled. */
  outcomeCodes: Partial<Record<ReactionOutcome, string>>;
  /** C.2.r.4 free-text designation (raw, as an admin typed it) -> Appendix
   *  I(F) qualification code, keyed by the SAME normalization
   *  mapping.ts/ondo-aefi.ts already use (trimmed, uppercased). A
   *  designation present in this map with `code: undefined` means it has
   *  been ENCOUNTERED in real case data but no admin has mapped it yet —
   *  distinct from a designation nobody has ever seen (which never gets a
   *  row at all). See services/api/regulatory-config.ts's discovery flow. */
  reporterQualificationMappings: OrgQualificationMapping[];
  /** Outcome words and reaction corrections this organization has decided
   *  (see term-mappings.ts). Optional so configs built before this existed
   *  still type-check; absent means none. */
  termMappings?: OrgTermMapping[] | undefined;
}

/** Legacy UI/test compatibility; numeric values are defined in outcome-codes.ts. */
export const ALL_REACTION_OUTCOMES: ReactionOutcome[] = [
  "RECOVERED",
  "RECOVERING",
  "NOT_RECOVERED",
  "RECOVERED_WITH_SEQUELAE",
  "FATAL",
  "UNKNOWN",
];

export interface OrgQualificationMapping {
  id: string;
  /** As typed/discovered, for display. */
  designation: string;
  /** Normalized (trim + uppercase) — the actual lookup key. */
  designationKey: string;
  code?: "1" | "2" | "3" | "4" | "5" | undefined;
}

/** The six fixed ICH E2B(R3) outcome concepts, in the developer spec's own
 *  order — used to drive "N/6 configured" readiness displays. Not a
 *  claim about numeric codes (see OrgRegulatoryConfig.outcomeCodes's doc
 *  comment); purely the enumeration of ReactionOutcome. */
/** The honest, fully-unconfigured starting point — mirrors
 *  transmission-config.ts's UNCONFIRMED_DEFAULT_CONFIG for the rest of
 *  this module's domain. Used whenever an org has no pv_regulatory_config
 *  row yet (a brand-new organization), so callers never have to
 *  special-case "no row" vs. "row with everything blank." */
export function unconfiguredOrgRegulatoryConfig(): OrgRegulatoryConfig {
  return {
    transmission: {
      environment: "uat",
      sender: { organization: UNCONFIRMED_SENTINEL, identifier: UNCONFIRMED_SENTINEL },
      receiver: { identifier: UNCONFIRMED_SENTINEL },
      reportType: "4",
      reportTypeConfirmed: false,
    },
    outcomeCodes: {},
    reporterQualificationMappings: [],
    termMappings: [],
  };
}

/** Normalizes a reporter designation exactly the way mapping.ts/
 *  ondo-aefi.ts already do (trim + uppercase) — the single shared
 *  normalization rule so a lookup here always agrees with the one in
 *  mapping.ts's qualificationCode resolution. */
/** "Nurse", " nurse ", "NURSE." and "Community  Health  Officer" all
 *  resolve to the same designation, whichever line list they came from. */
export function normalizeDesignationKey(designation: string): string {
  return designation
    .trim()
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Builds the plain designation-key -> code lookup mapSourceRecordToPVCase
 *  needs, from the org's persisted mapping rows. Entries with no code yet
 *  (discovered-but-unconfigured) are simply absent from the resulting
 *  map — exactly like a designation with no source-profile entry at all,
 *  so validation.ts's existing E2B-REPORTER-QUALIFICATION-UNRESOLVED
 *  check fires correctly without any change to that check itself. */
export function reporterQualificationLookup(
  mappings: OrgQualificationMapping[],
): Record<string, "1" | "2" | "3" | "4" | "5"> {
  const lookup: Record<string, "1" | "2" | "3" | "4" | "5"> = {};
  for (const m of mappings) {
    // Re-normalized from the designation text, so rows stored under an
    // older key format still match.
    if (m.code) lookup[normalizeDesignationKey(m.designation)] = m.code;
  }
  return lookup;
}

/**
 * baseSourceProfile + orgRegulatoryConfig = runtimeSourceProfile, for the
 * reporter-qualification dimension only — the same "pure merge, never
 * mutate base" pattern source-profiles/runtime-profile.ts established for
 * discovered codebooks. The base profile's own hardcoded
 * reporterQualificationMap (e.g. ondo-aefi.ts's MedNova-supplied example
 * mappings) is kept as a SEED so a fresh org isn't blocked on every
 * designation Ondo already resolved; the org's own persisted mappings are
 * layered ON TOP and win on any conflict, since they are the actual
 * regulatory decision-of-record an admin can review/correct — never the
 * reverse. Call this BEFORE resolveRuntimeSourceProfile (order does not
 * matter between the two — they touch disjoint fields — but keeping org
 * config application co-located with the rest of this module is clearer
 * than splitting it across two call sites).
 */
export function mergeOrgRegulatoryConfigIntoProfile(
  base: SourceProfile,
  config: OrgRegulatoryConfig,
): SourceProfile {
  const orgOverrides = reporterQualificationLookup(config.reporterQualificationMappings);
  const seed: Record<string, "1" | "2" | "3" | "4" | "5"> = {};
  for (const [designation, code] of Object.entries(base.reporterQualificationMap)) {
    seed[normalizeDesignationKey(designation)] = code;
  }
  return applyOrgOutcomeTerms(
    { ...base, reporterQualificationMap: { ...seed, ...orgOverrides } },
    config.termMappings,
  );
}
