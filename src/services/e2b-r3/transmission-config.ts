import type { ReportType } from "./types";

/**
 * Every value here is a NAFDAC/Ondo/MedNova-leadership configuration
 * decision (D2-D4 in docs/E2B-R3-NAFDAC-VIGIFLOW.md), not something this
 * codebase is authorized to invent. This module exists so those decisions
 * live in exactly one place — never silently hard-coded into a UI onClick
 * handler or a test fixture — and so the UI/export path can honestly show
 * whether they've actually been confirmed yet.
 */
export interface E2bTransmissionConfig {
  /** C.3.2 — this case's sending organisation (decision D4). */
  senderOrganisation: string;
  /** N.2.r.2 — the transmission-level sender device identifier NAFDAC/UMC
   *  assigns for message routing (decision D4). Distinct from
   *  senderOrganisation: that's the human-readable org name recorded on
   *  the case itself; this is the technical routing identifier. */
  senderIdentifier: string;
  /** N.2.r.3 — the transmission-level receiver device identifier NAFDAC
   *  assigns (decision D4). */
  receiverIdentifier: string;
  /** C.1.3 — report type for routine AEFI surveillance (decision D3). */
  reportType: ReportType;
  /** C.2.r.4 — explicit, human-confirmed mapping from this dataset's
   *  free-text reporter designation (e.g. "CHEW") to one of the five
   *  Appendix I(F) qualification codes (decision D2). Keys are matched
   *  case-insensitively against the source designation. */
  reporterQualificationMap: Record<string, "1" | "2" | "3" | "4" | "5">;
}

/** Sentinel values that mean "nobody has confirmed this yet" — distinct
 *  from any value NAFDAC/Ondo could plausibly assign for real, so
 *  isTransmissionConfigConfirmed can never accidentally treat a real
 *  configuration as unconfirmed or vice versa. */
export const UNCONFIRMED_SENTINEL = "__UNCONFIRMED__";

/**
 * The shipped default. Every field is the unconfirmed sentinel — this is
 * NOT a working configuration, and nothing in this codebase should ever
 * present it to NAFDAC or load it into VigiFlow. It exists only so the
 * export pipeline has a well-typed value to start from before a real one
 * is supplied, and so isTransmissionConfigConfirmed() has something
 * concrete to say "not confirmed" about.
 *
 * reporterQualificationMap is deliberately left EMPTY (not populated with
 * a guess like {"CHEW": "4"}) — binding a free-text designation to a
 * specific Appendix I(F) code is exactly the kind of value this codebase
 * must never invent (task section 4: "Do NOT invent values").
 */
export const UNCONFIRMED_DEFAULT_CONFIG: E2bTransmissionConfig = {
  senderOrganisation: UNCONFIRMED_SENTINEL,
  senderIdentifier: UNCONFIRMED_SENTINEL,
  receiverIdentifier: UNCONFIRMED_SENTINEL,
  reportType: "4", // "Not available to sender" — the one ReportType value that is itself an honest placeholder, not a guess about which real type applies
  reporterQualificationMap: {},
};

export function isTransmissionConfigConfirmed(config: E2bTransmissionConfig): boolean {
  return (
    config.senderOrganisation !== UNCONFIRMED_SENTINEL &&
    config.senderIdentifier !== UNCONFIRMED_SENTINEL &&
    config.receiverIdentifier !== UNCONFIRMED_SENTINEL
  );
}

/**
 * What's still missing from a given config, in plain language — for UI
 * banners and the final acceptance report. Never silently passes.
 */
export function describeUnconfirmedTransmissionConfig(config: E2bTransmissionConfig): string[] {
  const gaps: string[] = [];
  if (config.senderOrganisation === UNCONFIRMED_SENTINEL) {
    gaps.push("Sender organisation (C.3.2) — decision D4, confirm with NAFDAC/Ondo.");
  }
  if (config.senderIdentifier === UNCONFIRMED_SENTINEL) {
    gaps.push("Sender transmission identifier (N.2.r.2) — decision D4, NAFDAC/UMC-assigned.");
  }
  if (config.receiverIdentifier === UNCONFIRMED_SENTINEL) {
    gaps.push("Receiver transmission identifier (N.2.r.3) — decision D4, NAFDAC/UMC-assigned.");
  }
  if (Object.keys(config.reporterQualificationMap).length === 0) {
    gaps.push("Reporter qualification code mapping (C.2.r.4) — decision D2, at least one designation (e.g. \"CHEW\") needs a confirmed Appendix I(F) code.");
  }
  return gaps;
}
