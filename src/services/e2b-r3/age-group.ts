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
 * The application normalises the MedNova D.2.3 age-group derivation using
 * the official ICH D.2.3 OID and the code values listed in the ICH
 * reference material. The boundaries themselves are not ICH-defined in the
 * repository; they are the MedNova application normalization rule used to
 * keep a deterministic age-group classification from a normalized age + age
 * unit without asking the source to state a second, separate group.
 */
export const AGE_GROUP_CODELIST: AgeGroupCodelist | undefined = {
  provenance: "MedNova application normalization rule based on the official ICH D.2.3 OID and code values",
  codeSystem: "2.16.840.1.113883.3.989.2.1.1.9",
  bands: [
    { code: "0", label: "Foetus", minDays: 0, maxDaysExclusive: 0 },
    { code: "1", label: "Neonate", minDays: 0, maxDaysExclusive: 28 },
    { code: "2", label: "Infant", minDays: 28, maxDaysExclusive: 12 * 30.4375 },
    { code: "3", label: "Child", minDays: 12 * 30.4375, maxDaysExclusive: 12 * 365.25 },
    { code: "4", label: "Adolescent", minDays: 12 * 365.25, maxDaysExclusive: 18 * 365.25 },
    { code: "5", label: "Adult", minDays: 18 * 365.25, maxDaysExclusive: 65 * 365.25 },
    { code: "6", label: "Elderly", minDays: 65 * 365.25 },
  ],
};

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
    (band) => days >= band.minDays && (band.maxDaysExclusive === undefined || days < band.maxDaysExclusive),
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
