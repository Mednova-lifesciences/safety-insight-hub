import type { ReportType } from "./types";

/**
 * Sender/receiver identifiers are trading-partner configuration, not
 * generic E2B constants — they are agreed bilaterally between MedNova and
 * NAFDAC/UMC (decision D4) and must never be invented by this codebase.
 * Every value here is a NAFDAC/Ondo/MedNova-leadership configuration
 * decision (see docs/E2B-R3-NAFDAC-VIGIFLOW.md), not something the E2B
 * engine is authorized to assume. This module exists so those decisions
 * live in exactly one place — never silently hard-coded into a UI onClick
 * handler, an export function's parameter, or a test fixture — and so the
 * UI/export path can honestly show whether they've actually been
 * confirmed yet.
 */

/** Sentinel meaning "nobody has confirmed this yet" — distinct from any
 *  value NAFDAC/Ondo could plausibly assign for real, so
 *  isTransmissionConfigConfirmed can never accidentally treat a real
 *  configuration as unconfirmed or vice versa. */
export const UNCONFIRMED_SENTINEL = "__UNCONFIRMED__";

/** C.3.1-4 and the message-level sender identifier (N.2.r.2) — also used
 *  as the batch-level sender identifier (N.1.3) unless a distinct value is
 *  ever needed. */
export interface SenderConfig {
  /** C.3.2 — sender organisation name, recorded on each case. */
  organization: string;
  /** C.3.1 — sender type (e.g. "Pharmaceutical company", "Regulatory
   *  authority", "Other"), per the E2B(R3) sender-type codelist. Left as a
   *  free string here (not yet coded) since the exact codelist value
   *  hasn't been confirmed either. */
  type?: string | undefined;
  address?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  /** C.3.3 — person responsible for sending the report. */
  personResponsible?: string | undefined;
  /** N.2.r.2 (message sender) / N.1.3 (batch sender) — the technical
   *  transmission-routing identifier NAFDAC/UMC assigns. Distinct from
   *  `organization`: that's the human-readable name recorded on the case
   *  itself; this is what actually routes the transmission. */
  identifier: string;
}

export interface ReceiverConfig {
  organization?: string | undefined;
  /** N.2.r.3 (message receiver) / N.1.4 (batch receiver) — NAFDAC/UMC's
   *  assigned technical identifier. */
  identifier: string;
}

export interface E2bTransmissionConfig {
  /** "uat" during testing (including any eventual VigiFlow UAT/test
   *  import); "production" only once NAFDAC/UMC have confirmed this is a
   *  live-submission configuration. Never silently assumed to be
   *  production. */
  environment: "uat" | "production";
  sender: SenderConfig;
  receiver: ReceiverConfig;
  /** C.1.3's raw value (decision D3). NEVER trust this field's mere
   *  presence as proof NAFDAC confirmed it — it still holds the "4"
   *  placeholder even in the shipped unconfirmed default, purely so this
   *  field always has a syntactically valid ReportType to carry. Whether
   *  it is actually authoritative is decided ONLY by `reportTypeConfirmed`
   *  below — see that field's doc comment for the bug this split fixes. */
  reportType: ReportType;
  /** True only once an admin has explicitly confirmed C.1.3 (decision D3)
   *  via persisted regulatory configuration — never inferred from
   *  `reportType` merely being set, and never implied by sender/receiver
   *  being confirmed. Before this flag existed, `isTransmissionConfigConfirmed`
   *  checked only sender/receiver identifiers, so a real deployment could
   *  confirm those and unknowingly have the "4" placeholder start flowing
   *  into produced PVCase.reportType/XML as if NAFDAC had signed off on
   *  it. See mapping.ts's reportType resolution and
   *  services/api/regulatory-config.ts's OrgRegulatoryConfig. */
  reportTypeConfirmed?: boolean | undefined;
  /** Global fallback case-id prefix, used only when the active
   *  SourceProfile doesn't define its own (see
   *  source-profiles/types.ts's SourceProfile.caseIdPrefix, which takes
   *  precedence when set). */
  caseIdPrefix?: string | undefined;
}

/**
 * The shipped default. Every identifier field is the unconfirmed
 * sentinel — this is NOT a working configuration, and nothing in this
 * codebase should ever present it to NAFDAC or load it into VigiFlow. It
 * exists only so the export pipeline has a well-typed value to start from
 * before a real one is supplied.
 */
export const UNCONFIRMED_DEFAULT_CONFIG: E2bTransmissionConfig = {
  environment: "uat",
  sender: {
    organization: UNCONFIRMED_SENTINEL,
    identifier: UNCONFIRMED_SENTINEL,
  },
  receiver: {
    identifier: UNCONFIRMED_SENTINEL,
  },
  reportType: "4", // "Not available to sender" — the one ReportType value that is itself an honest placeholder, not a guess about which real type applies
  reportTypeConfirmed: false,
};

/** True only when EVERY decision D3/D4 element is confirmed: sender
 *  organisation, sender identifier, receiver identifier, AND report type.
 *  Report type is checked via the explicit `reportTypeConfirmed` flag —
 *  never inferred from `reportType`'s mere presence, since that field
 *  always holds a syntactically valid value (the "4" placeholder in the
 *  unconfirmed default) whether or not NAFDAC has actually confirmed it. */
export function isTransmissionConfigConfirmed(config: E2bTransmissionConfig): boolean {
  return (
    config.sender.organization !== UNCONFIRMED_SENTINEL &&
    config.sender.identifier !== UNCONFIRMED_SENTINEL &&
    config.receiver.identifier !== UNCONFIRMED_SENTINEL &&
    config.reportTypeConfirmed === true
  );
}

/**
 * What's still missing from a given config, in plain language — for UI
 * banners and the final acceptance report. Never silently passes.
 */
export function describeUnconfirmedTransmissionConfig(config: E2bTransmissionConfig): string[] {
  const gaps: string[] = [];
  if (config.sender.organization === UNCONFIRMED_SENTINEL) {
    gaps.push("Sender organisation (C.3.2) — decision D4, confirm with NAFDAC/Ondo.");
  }
  if (config.sender.identifier === UNCONFIRMED_SENTINEL) {
    gaps.push(
      "Sender transmission identifier (N.2.r.2 / N.1.3) — decision D4, NAFDAC/UMC-assigned.",
    );
  }
  if (config.receiver.identifier === UNCONFIRMED_SENTINEL) {
    gaps.push(
      "Receiver transmission identifier (N.2.r.3 / N.1.4) — decision D4, NAFDAC/UMC-assigned.",
    );
  }
  if (config.reportTypeConfirmed !== true) {
    gaps.push(
      "Report type (C.1.3) — decision D3, confirm with NAFDAC before it can be emitted as a real value.",
    );
  }
  return gaps;
}
