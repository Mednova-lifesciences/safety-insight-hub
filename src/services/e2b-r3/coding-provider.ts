import type { CodedTerm, WhoDrugCodedProduct } from "./types";

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
  getVersion(): string | null;
  /** Verbatim reaction/event text -> a coded (or honestly unmapped/
   *  invalid/unavailable) term. Named to match the vocabulary this app's
   *  regulatory review settled on (resolve, not "guess-and-code"). */
  resolveReaction(verbatimText: string): Promise<CodedTerm>;
  /** Reverse lookup: a MedDRA LLT code -> its Preferred Term, when the
   *  provider actually has one. Returns null (never a guess) if the code
   *  isn't recognised by this provider's configured version — useful for
   *  displaying human-readable review context, never for producing new
   *  codes from source data. */
  resolvePreferredTerm(lltCode: string): Promise<{ preferredTerm: string; code: string } | null>;
}

export interface WhoDrugCodingProvider {
  /** WHODrug Global version this provider is licensed/configured for, if
   *  any — null when unconfigured. UMC releases WHODrug Global biannually;
   *  a real provider must expose which release it's actually using. */
  getVersion(): string | null;
  /** Verbatim product/vaccine text -> a coded (or honestly unmapped/
   *  invalid/unavailable) WHODrug Global C3 product — see
   *  WhoDrugCodedProduct for the richer shape (substance, strength, form,
   *  RID) this returns compared to a generic reaction CodedTerm. */
  resolveProduct(verbatimText: string): Promise<WhoDrugCodedProduct>;
}

function invalidValue(sourceValue: string): boolean {
  return !sourceValue || !sourceValue.trim();
}

function providerUnavailable(sourceValue: string): CodedTerm {
  return { sourceValue, status: "PROVIDER_UNAVAILABLE", mappingMethod: "NONE" };
}

function invalidTerm(sourceValue: string): CodedTerm {
  return { sourceValue, status: "INVALID", mappingMethod: "NONE" };
}

/**
 * The only MedDRA provider actually wired into this application right now.
 * No MedDRA license is configured anywhere, so this honestly reports
 * PROVIDER_UNAVAILABLE for every reaction rather than pretending an
 * attempt was made and simply found nothing — this is correct, intentional
 * fail-closed behaviour, not a bug or a placeholder to "eventually
 * improve" with guessing. Swap for a real licensed provider once one
 * exists; nothing else in the codebase needs to change.
 */
export const unavailableMedDraProvider: MedDraCodingProvider = {
  getVersion: () => null,
  async resolveReaction(verbatimText: string): Promise<CodedTerm> {
    return providerUnavailable(verbatimText);
  },
  async resolvePreferredTerm(): Promise<{ preferredTerm: string; code: string } | null> {
    return null;
  },
};

/** Same honesty, same reasoning, for WHODrug Global — see
 *  unavailableMedDraProvider above. */
export const unavailableWhoDrugProvider: WhoDrugCodingProvider = {
  getVersion: () => null,
  async resolveProduct(verbatimText: string): Promise<WhoDrugCodedProduct> {
    return providerUnavailable(verbatimText);
  },
};

export interface MedDraMappingTableEntry {
  code: string;
  preferredTerm: string;
}

/**
 * A real, functioning MedDraCodingProvider — but ONLY over a mapping table
 * explicitly supplied by the caller (spec section 2F of this task's
 * requirements: "support that mapping — but only if the mapping source is
 * explicitly supplied/configured"). This is deliberately NOT the same
 * trust level as a live licensed dictionary API — mappingMethod is always
 * "AUTHORIZED_MAPPING_TABLE" so downstream code and reviewers can tell the
 * difference. No table is populated anywhere in this codebase today: Ondo
 * State's own reaction codebook (what source values like "19", "8.19.21"
 * actually mean) has never been supplied — see
 * docs/E2B-R3-NAFDAC-VIGIFLOW.md's external-dependencies table. This class
 * exists purely as the plumbing for when one is.
 */
export class AuthorizedMappingTableMedDraProvider implements MedDraCodingProvider {
  constructor(
    private readonly version: string,
    private readonly table: Record<string, MedDraMappingTableEntry>,
  ) {}

  getVersion(): string | null {
    return this.version;
  }

  async resolveReaction(verbatimText: string): Promise<CodedTerm> {
    if (invalidValue(verbatimText)) return invalidTerm(verbatimText);
    const key = verbatimText.trim();
    const entry = this.table[key];
    if (!entry) {
      return { sourceValue: verbatimText, status: "UNMAPPED", mappingMethod: "NONE" };
    }
    return {
      sourceValue: verbatimText,
      status: "MAPPED",
      mappingMethod: "AUTHORIZED_MAPPING_TABLE",
      codedTerm: entry.preferredTerm,
      code: entry.code,
      dictionaryVersion: this.version,
    };
  }

  async resolvePreferredTerm(lltCode: string): Promise<{ preferredTerm: string; code: string } | null> {
    for (const entry of Object.values(this.table)) {
      if (entry.code === lltCode) return { preferredTerm: entry.preferredTerm, code: entry.code };
    }
    return null;
  }
}

export interface WhoDrugMappingTableEntry {
  mpid?: string;
  substanceName?: string;
  substanceId?: string;
  strength?: string;
  pharmaceuticalForm?: string;
  rid?: string;
  productName: string;
}

/** Same principle as AuthorizedMappingTableMedDraProvider, for WHODrug
 *  Global C3 — a real provider over an explicitly supplied table, never a
 *  fabricated RID/MPID. No table is populated anywhere in this codebase
 *  today. */
export class AuthorizedMappingTableWhoDrugProvider implements WhoDrugCodingProvider {
  constructor(
    private readonly version: string,
    private readonly table: Record<string, WhoDrugMappingTableEntry>,
  ) {}

  getVersion(): string | null {
    return this.version;
  }

  async resolveProduct(verbatimText: string): Promise<WhoDrugCodedProduct> {
    if (invalidValue(verbatimText)) return invalidTerm(verbatimText);
    const key = verbatimText.trim().toUpperCase();
    const entry = this.table[key];
    if (!entry) {
      return { sourceValue: verbatimText, status: "UNMAPPED", mappingMethod: "NONE" };
    }
    return {
      sourceValue: verbatimText,
      status: "MAPPED",
      mappingMethod: "AUTHORIZED_MAPPING_TABLE",
      codedTerm: entry.productName,
      code: entry.mpid,
      dictionaryVersion: this.version,
      mpid: entry.mpid,
      substanceName: entry.substanceName,
      substanceId: entry.substanceId,
      strength: entry.strength,
      pharmaceuticalForm: entry.pharmaceuticalForm,
      rid: entry.rid,
    };
  }
}

/**
 * WHODrug Global's own code system OID, per UMC's technical guidance for
 * WHODrug Global in E2B(R3) XML — recorded here now so the (currently
 * unmapped) CodedTerm shape and any future real provider stay consistent
 * with the one fixed identifier this doesn't depend on licensing to know.
 * This is metadata about the *coding system*, not a fabricated code for
 * any specific product.
 */
export const WHODRUG_GLOBAL_RID_OID = "2.16.840.1.113883.6.294";
