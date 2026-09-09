import type { CodedTerm } from "./types";

/**
 * Boundary between this app and licensed medical terminology dictionaries
 * (MedDRA for reactions, WHODrug Global for products). Neither dictionary
 * is bundled in this repository — both are commercially licensed (MedDRA
 * through MSSO, WHODrug Global through UMC) and cannot be fabricated,
 * approximated, or downloaded by this codebase. See
 * docs/E2B-R3-NAFDAC-VIGIFLOW.md for what that means for export readiness.
 *
 * This interface exists so a real licensed provider can be plugged in
 * later (a paid API, a licensed local dictionary file, whatever the actual
 * license grants) without touching any mapping/validation code that
 * depends on it — every call site here only ever sees a CodedTerm, never
 * cares how (or whether) coding actually happened.
 */
export interface MedDraCodingProvider {
  /** MedDRA version this provider is licensed/configured for, if any —
   *  null when unconfigured. */
  readonly version: string | null;
  codeReaction(verbatimText: string): Promise<CodedTerm>;
}

export interface WhoDrugCodingProvider {
  /** WHODrug Global version this provider is licensed/configured for, if
   *  any — null when unconfigured. UMC releases WHODrug Global biannually;
   *  a real provider must expose which release it's actually using. */
  readonly version: string | null;
  codeProduct(verbatimText: string): Promise<CodedTerm>;
}

function unmapped(sourceValue: string): CodedTerm {
  return { sourceValue, status: "UNMAPPED", mappingMethod: "NONE" };
}

/**
 * The only implementation that exists right now. No MedDRA license is
 * configured anywhere in this application, so this honestly reports every
 * reaction as UNMAPPED rather than inventing a code — this is correct,
 * intentional fail-closed behaviour, not a bug or a placeholder to
 * "eventually improve" with guessing. Swap for a real licensed provider
 * once one exists; nothing else in the codebase needs to change.
 */
export const unlicensedMedDraProvider: MedDraCodingProvider = {
  version: null,
  async codeReaction(verbatimText: string): Promise<CodedTerm> {
    return unmapped(verbatimText);
  },
};

/** Same honesty, same reasoning, for WHODrug Global — see
 *  unlicensedMedDraProvider above. */
export const unlicensedWhoDrugProvider: WhoDrugCodingProvider = {
  version: null,
  async codeProduct(verbatimText: string): Promise<CodedTerm> {
    return unmapped(verbatimText);
  },
};

/**
 * WHODrug Global's own code system OID, per UMC's technical guidance for
 * WHODrug Global in E2B(R3) XML — recorded here now so the (currently
 * unmapped) CodedTerm shape and any future real provider stay consistent
 * with the one fixed identifier this doesn't depend on licensing to know.
 * This is metadata about the *coding system*, not a fabricated code for
 * any specific product.
 */
export const WHODRUG_GLOBAL_RID_OID = "2.16.840.1.113883.6.294";
