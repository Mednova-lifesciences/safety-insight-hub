/**
 * D.2.3 — Patient Age Group.
 *
 * This module exists in a deliberately unfinished state, and the reason
 * matters more than the code.
 *
 * ## What ICH actually calls this element
 *
 * "Patient Age Group (**as per reporter**)" — the parenthesis is ICH's,
 * confirmed from the reference instance and from the ICH example
 * workbooks shipped in `regulatory-assets/e2b-r3/official-ich/`. D.2.3 is
 * a statement the REPORTER made, not a number this pipeline computes.
 * A value derived from D.2.2 and presented as D.2.3 asserts that a
 * reporter said something they never said.
 *
 * That is why `deriveAgeGroup` below is not wired into the mapper by
 * default: the derivation is available and tested, but a derived value is
 * a different fact from a reported one, and turning it on is an
 * organisational decision rather than a developer default.
 *
 * ## What is missing to emit it at all
 *
 * The codelist. ICH puts D.2.3 on OID 2.16.840.1.113883.3.989.2.1.1.9 —
 * that OID is confirmed present in the ICH reference instance and in the
 * clinical-trial example instance. What is NOT anywhere in this
 * repository is the list of codes that OID admits, or the age boundaries
 * that separate its groups. Searched, and not found in:
 *
 *   - ICH_ICSR_Reference_Instances_v3.1.zip   (uses the placeholder "D.2.3")
 *   - ICH_ICSR_XML_Schema_Set_v2.5.zip        (codelists are external to the XSDs)
 *   - ICH_ICSR_Example_Instances_v2.0.zip     (workbooks list field NAMES only)
 *   - Ondo_AEFI_E2B_R3_Developer_Spec.docx    (records only that D.2.3 is Optional)
 *
 * The single real data point available is from the ICH clinical-trial
 * example instance: a patient of `value="50" unit="a"` carries
 * `<value xsi:type="CE" code="5" codeSystem="...2.1.1.9"/>`. One point is
 * not a codelist, and it is recorded here as evidence rather than used as
 * a basis for inventing the other six.
 *
 * The Ondo reference file is not evidence either: it is E2B(R2), and its
 * `patientagegroup` is the constant "3" on all 91 reports regardless of
 * the patient's age — including patients recorded in weeks and months.
 * That is a fixed export value, not a derivation anyone can learn from.
 *
 * ## To finish this
 *
 * Supply an AgeGroupCodelist (below) from the ICH Implementation Guide's
 * D.2.3 codelist and pass it to `resolveAgeGroup`. Nothing else needs to
 * change: the derivation, the unit normalisation and the serializer entry
 * point are all implemented and tested against a codelist fixture.
 */

import type { PVPatient } from "./types";

/** One group in the codelist: an ICH code and the age band it covers. */
export interface AgeGroupBand {
  /** The ICH D.2.3 code, exactly as the codelist gives it. */
  code: string;
  /** Human label, for review screens and test readability. */
  label: string;
  /** Inclusive lower bound, in days. */
  minDays: number;
  /** EXCLUSIVE upper bound, in days. Omit for the open-ended top band. */
  maxDaysExclusive?: number | undefined;
}

export interface AgeGroupCodelist {
  /** Where these values came from — an ICH IG version, a regulator's
   *  published table. Recorded so a reviewer can check the source of a
   *  code that reaches a regulatory file. */
  provenance: string;
  /** The OID the codes are asserted against. */
  codeSystem: string;
  bands: AgeGroupBand[];
}

/**
 * D.2.3 — Patient Age Group. ICH E2B(R3) Implementation Guide v5.03.
 *
 * PROVENANCE, stated plainly because it matters for a regulatory value:
 * these seven codes were supplied by the organisation, citing ICH
 * E2B(R3) IG v5.03 for D.2.3 on OID 2.16.840.1.113883.3.989.2.1.1.9. The
 * IG itself is not in this repository, so this code has NOT independently
 * verified them against it. What IS independently confirmed from the
 * material under regulatory-assets/e2b-r3/official-ich/ is the OID, the
 * element's position, and one data point from the ICH clinical-trial
 * example instance — a patient of value="50" unit="a" carrying code "5",
 * which agrees with "5 = Adult" below.
 *
 * The day boundaries are NOT from the IG. ICH defines the code meanings,
 * not the ages that separate them, so the bands are this application's
 * own convention and are used only by `deriveAgeGroup`, which — see
 * `resolveAgeGroupForExport` — is deliberately NOT part of the export
 * path.
 */
export const AGE_GROUP_CODELIST: AgeGroupCodelist | undefined = {
  provenance:
    "ICH E2B(R3) Implementation Guide v5.03, D.2.3 codelist — supplied by the organisation; " +
    "boundaries are a MedNova convention and are not used for export",
  codeSystem: "2.16.840.1.113883.3.989.2.1.1.9",
  bands: [
    // A foetus has no positive post-natal age, so no age band can select
    // this code. It exists so a REPORTER who states "foetus" can be
    // mapped to it, which is the only route by which it is ever emitted.
    { code: "0", label: "Foetus", minDays: -1, maxDaysExclusive: -1 },
    { code: "1", label: "Neonate", minDays: 0, maxDaysExclusive: 28 },
    { code: "2", label: "Infant", minDays: 28, maxDaysExclusive: 12 * 30.4375 },
    { code: "3", label: "Child", minDays: 12 * 30.4375, maxDaysExclusive: 12 * 365.25 },
    { code: "4", label: "Adolescent", minDays: 12 * 365.25, maxDaysExclusive: 18 * 365.25 },
    { code: "5", label: "Adult", minDays: 18 * 365.25, maxDaysExclusive: 65 * 365.25 },
    { code: "6", label: "Elderly", minDays: 65 * 365.25 },
  ],
};

/**
 * The words reporters actually write, mapped to the D.2.3 code they mean.
 * Matching is on letters only, so case, spacing and punctuation do not
 * matter ("New-born", "NEWBORN", "new born" are one key).
 *
 * Deliberately conservative. "Paediatric" is absent: it spans neonate
 * through adolescent and names no single D.2.3 group, so a reporter who
 * writes it has not told us which one — that is a review item, not a
 * mapping. Same for "minor" and "young".
 */
const AGE_GROUP_SYNONYMS: Readonly<Record<string, string>> = {
  // 0 Foetus
  foetus: "0",
  fetus: "0",
  foetal: "0",
  fetal: "0",
  unborn: "0",
  // 1 Neonate
  neonate: "1",
  neonatal: "1",
  newborn: "1",
  newlyborn: "1",
  // 2 Infant
  infant: "2",
  infancy: "2",
  baby: "2",
  toddler: "2",
  // 3 Child
  child: "3",
  children: "3",
  childhood: "3",
  // 4 Adolescent
  adolescent: "4",
  adolescence: "4",
  teenager: "4",
  teen: "4",
  youth: "4",
  // 5 Adult
  adult: "5",
  adulthood: "5",
  // 6 Elderly
  elderly: "6",
  elder: "6",
  senior: "6",
  geriatric: "6",
  aged: "6",
  oldage: "6",
};

/**
 * A reporter's own words (or a bare D.2.3 code) resolved to a band.
 * Returns nothing when the words name no single group — which is the
 * correct outcome for "paediatric" or anything unrecognised, since D.2.3
 * carries what the reporter said and there is nothing here to say.
 */
export function normalizeReportedAgeGroup(
  value: string | undefined,
  codelist: AgeGroupCodelist | undefined = AGE_GROUP_CODELIST,
): AgeGroupBand | undefined {
  if (!codelist) return undefined;
  const raw = value?.trim();
  if (!raw) return undefined;
  // A bare code, as a source that already speaks E2B may write.
  const byCode = codelist.bands.find((b) => b.code === raw);
  if (byCode) return byCode;
  const letters = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return undefined;
  const code =
    codelist.bands.find((b) => b.label.toLowerCase() === letters)?.code ??
    AGE_GROUP_SYNONYMS[letters];
  return code ? codelist.bands.find((b) => b.code === code) : undefined;
}

/**
 * The ONLY path by which D.2.3 reaches the XML.
 *
 * Two rules from ICH, and both are restrictions rather than permissions:
 *
 *  1. D.2.3 is the age group "as per reporter". It is what a reporter
 *     stated, so it is never computed here. `deriveAgeGroup` exists and is
 *     tested, but is not called from the export path.
 *
 *  2. D.2.3 is the LEAST precise of the three age elements. Where D.2.1
 *     (date of birth) or D.2.2 (age at onset) is available, the precise
 *     value is what should be transmitted, and the group is redundant. So
 *     a case carrying either of those emits no D.2.3 even when the
 *     reporter also stated a group.
 *
 * The reporter's words are never lost either way: they stay on
 * PVPatient.ageGroupVerbatim and remain visible for review.
 */
export function resolveAgeGroupForExport(input: {
  reportedVerbatim?: string | undefined;
  /** D.2.1 — a date of birth on the case. */
  hasDateOfBirth?: boolean | undefined;
  /** D.2.2 — a numeric age WITH a unit, i.e. an actually usable age. */
  hasPreciseAge?: boolean | undefined;
  codelist?: AgeGroupCodelist | undefined;
}): { band: AgeGroupBand; from: "reported" } | undefined {
  if (input.hasDateOfBirth || input.hasPreciseAge) return undefined;
  const band = normalizeReportedAgeGroup(
    input.reportedVerbatim,
    input.codelist ?? AGE_GROUP_CODELIST,
  );
  return band ? { band, from: "reported" } : undefined;
}

/** The OID D.2.3 codes are asserted against, confirmed from the ICH
 *  reference instance. Known independently of the codelist's contents. */
export const AGE_GROUP_CODE_SYSTEM = "2.16.840.1.113883.3.989.2.1.1.9";

/**
 * Days per E2B age unit. Months and years use the conventional 30.4375
 * and 365.25 so that a band boundary expressed in years lands in the same
 * place whichever unit the source used. Deliberately NOT calendar-exact:
 * this converts a band boundary, not a date, and no date arithmetic is
 * performed anywhere in this module.
 */
const DAYS_PER_UNIT: Readonly<Record<NonNullable<PVPatient["ageUnit"]>, number>> = {
  "800": 3652.5, // decade
  "801": 365.25, // year
  "802": 30.4375, // month
  "803": 7, // week
  "804": 1, // day
  "805": 1 / 24, // hour
};

/** An age and its unit expressed in days, or nothing when the age is not
 *  a number this code can reason about. Never guesses a unit. */
export function ageInDays(age: string | undefined, unit: PVPatient["ageUnit"]): number | undefined {
  if (!age || !unit) return undefined;
  const n = Number(age.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n * DAYS_PER_UNIT[unit];
}

/**
 * Derives the age group from an age and its unit against a supplied
 * codelist. Deterministic and total: the same inputs always give the same
 * band, and an age outside every band returns nothing rather than the
 * nearest one.
 *
 * Never consults a date of birth — D.2.1 and D.2.2 are independent source
 * facts, and this module does no date arithmetic at all.
 */
export function deriveAgeGroup(
  age: string | undefined,
  unit: PVPatient["ageUnit"],
  codelist: AgeGroupCodelist | undefined,
): AgeGroupBand | undefined {
  if (!codelist) return undefined;
  const days = ageInDays(age, unit);
  if (days === undefined || days === 0) return undefined;
  return codelist.bands.find(
    (band) =>
      days >= band.minDays && (band.maxDaysExclusive === undefined || days < band.maxDaysExclusive),
  );
}

/**
 * The single entry point the mapper/serializer use.
 *
 * Resolution order, and the order matters:
 *
 *   1. What the REPORTER stated, when the source has an age-group column
 *      and the codelist recognises the words. This is what D.2.3 means,
 *      so it always wins.
 *   2. A derivation from age + unit — ONLY when `allowDerivation` is set,
 *      because a derived value is not a reported one.
 *
 * Returns nothing when no codelist is configured, which is the state this
 * application ships in.
 */
export function resolveAgeGroup(input: {
  reportedVerbatim?: string | undefined;
  age?: string | undefined;
  ageUnit?: PVPatient["ageUnit"];
  codelist?: AgeGroupCodelist | undefined;
  allowDerivation?: boolean | undefined;
}): { band: AgeGroupBand; from: "reported" | "derived" } | undefined {
  const codelist = input.codelist ?? AGE_GROUP_CODELIST;
  if (!codelist) return undefined;

  const stated = input.reportedVerbatim?.trim().toLowerCase();
  if (stated) {
    const match = codelist.bands.find(
      (b) => b.label.toLowerCase() === stated || b.code.toLowerCase() === stated,
    );
    if (match) return { band: match, from: "reported" };
    // The reporter said something the codelist does not contain. That is
    // a review item, not a licence to compute a different answer, so the
    // derivation below is deliberately not reached.
    return undefined;
  }

  if (!input.allowDerivation) return undefined;
  const derived = deriveAgeGroup(input.age, input.ageUnit, codelist);
  return derived ? { band: derived, from: "derived" } : undefined;
}
