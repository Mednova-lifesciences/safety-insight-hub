/**
 * D.2.2b — the user correction path.
 *
 * The application may propose an age unit (the years default), but only a
 * person can confirm one. This module is the single place a person's
 * decision is applied, and it enforces the one rule that matters:
 *
 *   The source's own value is never overwritten.
 *
 * Nothing here mutates the row, the file, or the stored source record. It
 * takes a patient and returns a new patient, with the full trail —
 * original, proposed, final, basis, reason, confidence, confirmation —
 * preserved on `ageUnitCorrection` so an auditor can see what a person
 * changed, from what, and when.
 */

import type { AgeUnitCorrection, PVPatient } from "./types";
import { AGE_UNIT_UCUM } from "./types";

export type AgeUnitCode = NonNullable<PVPatient["ageUnit"]>;

/** Labels for the units a person may choose between, in the order a
 *  reviewer would expect to see them. */
export const AGE_UNIT_CHOICES: readonly { code: AgeUnitCode; label: string; ucum: string }[] = [
  { code: "801", label: "Years", ucum: AGE_UNIT_UCUM["801"] },
  { code: "802", label: "Months", ucum: AGE_UNIT_UCUM["802"] },
  { code: "803", label: "Weeks", ucum: AGE_UNIT_UCUM["803"] },
  { code: "804", label: "Days", ucum: AGE_UNIT_UCUM["804"] },
  { code: "805", label: "Hours", ucum: AGE_UNIT_UCUM["805"] },
  { code: "800", label: "Decades", ucum: AGE_UNIT_UCUM["800"] },
];

export function isAgeUnitCode(value: string): value is AgeUnitCode {
  return AGE_UNIT_CHOICES.some((c) => c.code === value);
}

/**
 * True when a reviewer should be asked about this patient's age unit:
 * there is an age, the unit was assumed rather than stated, and nobody
 * has confirmed it yet. Everything else needs no one's attention.
 */
export function needsAgeUnitConfirmation(patient: PVPatient): boolean {
  return (
    !!patient.age && !!patient.ageUnitAssumed && patient.ageUnitCorrection?.confirmedByUser !== true
  );
}

/**
 * Applies a person's decision about D.2.2b.
 *
 * `chosen` may equal what was already proposed — that is a confirmation,
 * not a no-op, and it is recorded as one: an age unit a person has looked
 * at and agreed with is materially different from one the application
 * assumed and nobody checked.
 *
 * Returns the patient unchanged when there is no age to qualify; there is
 * nothing to confirm about a unit for an age that does not exist.
 */
export function applyAgeUnitCorrection(
  patient: PVPatient,
  chosen: AgeUnitCode,
  options: { confirmedAt: string; reason?: string | undefined },
): PVPatient {
  if (!patient.age) return patient;

  const previous: AgeUnitCorrection | undefined = patient.ageUnitCorrection;
  const proposed = previous?.proposed ?? patient.ageUnit ?? chosen;
  const isConfirmationOfProposal = chosen === proposed;

  const correction: AgeUnitCorrection = {
    // The source's own words, carried forward untouched. This is the
    // field that must survive every correction.
    ...(previous?.original ? { original: previous.original } : {}),
    proposed,
    final: chosen,
    basis: "user",
    reason:
      options.reason ??
      (isConfirmationOfProposal
        ? `A reviewer confirmed the proposed unit (${labelFor(proposed)}).`
        : `A reviewer changed the unit from ${labelFor(proposed)} to ${labelFor(chosen)}.`),
    // A person looked at it, so this is no longer a guess — whichever way
    // they decided.
    confidence: "high",
    confirmedByUser: true,
    confirmedAt: options.confirmedAt,
  };

  return {
    ...patient,
    ageUnit: chosen,
    // The assumption flag is cleared because the value is no longer an
    // assumption. The fact that it once was stays visible in the
    // correction's `basis`/`proposed`.
    ageUnitAssumed: false,
    ageUnitCorrection: correction,
  };
}

function labelFor(code: AgeUnitCode): string {
  return AGE_UNIT_CHOICES.find((c) => c.code === code)?.label ?? code;
}
