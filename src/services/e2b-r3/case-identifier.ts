/**
 * C.1.1 — Sender's (case) Safety Report Unique Identifier — and C.1.8.1,
 * the Worldwide Unique Case Identification Number, which carries the same
 * value for a case this organization is the first sender of.
 *
 * Shape, from the project's own developer spec (section 5.2, itself
 * written against the ICH E2B(R3) Implementation Guide):
 *
 *   "Concatenation of three segments separated by hyphens: country code –
 *    organisation – report number. Country code is the ISO 3166-1 alpha-2
 *    code of the primary source country (NG). No hyphen inside the
 *    organisation segment. Example: NG-MEDNOVA-000112. 100AN, namespace
 *    OID ...2.1.3.1"
 *
 * and, for C.1.8.1: "Same format as C.1.1. Must never change across any
 * retransmission. When MedNova creates the first electronic ICSR for a
 * case, C.1.1 and C.1.8.1 are identical."
 *
 * Nothing here knows any country, organization or source form: every
 * segment is supplied by the caller — the country from the case's own
 * primary source (C.2.r.3), the organisation from the configured sender
 * (C.3.2), the report number from the line list's own case identifier.
 * A segment that is not known is left out rather than invented, which is
 * why the country and organisation are optional: a fabricated country on
 * a regulatory identifier is worse than a shorter identifier.
 */

import { resolveCountryCode } from "./country";

/** 100AN (developer spec 5.2). */
export const MAX_CASE_SAFETY_REPORT_ID_LENGTH = 100;

/** Long enough for any real organisation name, short enough that the
 *  report number — the part uniqueness actually depends on — can never be
 *  squeezed out of a 100AN identifier. */
const MAX_ORGANISATION_SEGMENT_LENGTH = 40;

export interface CaseSafetyReportIdParts {
  /** C.2.r.3 — ISO 3166-1 alpha-2 country of the primary source. Anything
   *  that is not a two-letter code is treated as unknown. */
  country?: string | undefined;
  /** C.3.2 — the configured sender organisation's name. */
  organisation?: string | undefined;
  /** The sender's own case/report number: the line list's case identifier,
   *  or whatever the mapping layer assigned in its place. */
  caseNumber: string;
}

/** Placeholder configuration must never reach a regulatory identifier.
 *  Export is already gated on confirmed transmission configuration; this
 *  is the second line of defence. */
const UNCONFIRMED = "__UNCONFIRMED__";

function isUsable(value: string | undefined): value is string {
  const trimmed = value?.trim();
  return !!trimmed && trimmed !== UNCONFIRMED;
}

/** An assigned ISO 3166-1 alpha-2 code, or nothing. Two letters is not
 *  enough: "XX" and "ZZ" are user-assigned ranges and name no country, and
 *  a regulatory identifier should not carry them. */
function countrySegment(country: string | undefined): string | undefined {
  if (!isUsable(country)) return undefined;
  return resolveCountryCode(country);
}

/** The organisation, upper-cased with every separator removed — the spec
 *  forbids a hyphen here because the hyphen is what separates segments. */
function organisationSegment(organisation: string | undefined): string | undefined {
  if (!isUsable(organisation)) return undefined;
  const cleaned = organisation
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, MAX_ORGANISATION_SEGMENT_LENGTH) : undefined;
}

/** The case number as the source wrote it, minus anything that is not
 *  alphanumeric or a hyphen. Case is preserved: this is the one segment a
 *  person can trace back to a row of their own file. */
function reportNumberSegment(caseNumber: string): string {
  return caseNumber.trim().replace(/[^A-Za-z0-9-]/g, "");
}

/**
 * Builds the identifier. Pure and deterministic: the same case number,
 * country and organisation always produce the same value, so regenerating
 * an export never changes a case's C.1.1 — which is what VigiFlow's
 * follow-up matching depends on.
 */
export function buildCaseSafetyReportId(parts: CaseSafetyReportIdParts): string {
  const number = reportNumberSegment(parts.caseNumber);
  // Nothing sensible can be built without a report number; the caller's
  // own case identifier is returned untouched rather than a bare prefix.
  if (!number) return parts.caseNumber.trim();

  // A case number may already carry these segments: the mapping layer's
  // own caseIdPrefix (source profile or transmission configuration) is how
  // a row with no case id of its own gets a qualified number, and a source
  // may simply write qualified identifiers. Qualifying twice would produce
  // NG-NG-MEDNOVA-1, so leading segments already present are not repeated.
  // The function is therefore idempotent: applying it to its own output
  // returns that output, which is what keeps C.1.1 stable across repeated
  // generation of the same case.
  const wanted = [countrySegment(parts.country), organisationSegment(parts.organisation)].filter(
    (s): s is string => !!s,
  );
  // All of them, in order, or none: a case number that merely happens to
  // start with the country code ("NG-OG-901", where NG is a facility's own
  // prefix) is still qualified in full, so the country never goes missing
  // from the front of the identifier.
  const existing = number.split("-");
  const alreadyQualified =
    wanted.length > 0 &&
    wanted.every((segment, i) => existing[i]?.toUpperCase() === segment) &&
    existing.length > wanted.length;
  const missing = alreadyQualified ? [] : wanted;

  const segments = [...missing, number].join("-");

  if (segments.length <= MAX_CASE_SAFETY_REPORT_ID_LENGTH) return segments;

  // Over 100AN: shorten the organisation, never the report number.
  const country = missing.length === 2 ? missing[0] : undefined;
  const organisation = missing.length === 2 ? missing[1] : missing[0];
  const fixed = [country, number].filter(Boolean).join("-");
  const room = MAX_CASE_SAFETY_REPORT_ID_LENGTH - fixed.length - 1;
  const shortened = organisation && room > 0 ? organisation.slice(0, room) : undefined;
  return [country, shortened, number].filter(Boolean).join("-");
}
