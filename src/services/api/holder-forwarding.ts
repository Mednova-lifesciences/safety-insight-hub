import type { CaseDetail, CaseSummary, HolderForward } from "@/types/pv";
import type { CatalogDrug } from "./products";

/**
 * Third-party product reports. A pharmacy chain sells products other
 * companies hold the NAFDAC registration for; a report about one of those
 * belongs to its marketing authorisation holder and is passed on to them.
 * Who holds what is read from the drug catalog, never guessed.
 */

export type HolderStatus = "OWN_BRAND" | "THIRD_PARTY" | "UNKNOWN";

export interface ProductHolder {
  productName: string;
  status: HolderStatus;
  holder?: string | undefined;
  drug?: CatalogDrug | undefined;
  forwards: HolderForward[];
}

export const FORWARD_METHOD_LABELS: Record<HolderForward["method"], string> = {
  EMAIL: "Email",
  PORTAL: "Holder's safety portal",
  PHONE: "Phone",
  LETTER: "Letter / courier",
  OTHER: "Other",
};

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** The catalog drug for a product: by catalog id when the case has one,
 *  otherwise by exact name, ignoring case. */
export function findCatalogDrug(
  catalog: CatalogDrug[],
  productName: string,
  catalogId?: string | undefined,
): CatalogDrug | undefined {
  if (catalogId) {
    const byId = catalog.find((d) => d.id === catalogId);
    if (byId) return byId;
  }
  const name = norm(productName);
  return name ? catalog.find((d) => norm(d.name) === name) : undefined;
}

export function holderOf(drug: CatalogDrug | undefined): {
  status: HolderStatus;
  holder?: string | undefined;
} {
  if (!drug) return { status: "UNKNOWN" };
  if (drug.ownBrand) return { status: "OWN_BRAND", holder: drug.holder };
  const holder = drug.holder?.trim();
  return holder ? { status: "THIRD_PARTY", holder } : { status: "UNKNOWN" };
}

function forwardsFor(forwards: HolderForward[] | undefined, productName: string) {
  return (forwards ?? []).filter((f) => norm(f.productName) === norm(productName));
}

/** Holder status of every suspect product on a case, with forwards made. */
export function caseProductHolders(
  c: Pick<CaseDetail, "suspectProducts" | "productId" | "holderForwards">,
  catalog: CatalogDrug[],
): ProductHolder[] {
  return c.suspectProducts.map((p, i) => {
    const drug = findCatalogDrug(catalog, p.reportedName, i === 0 ? c.productId : undefined);
    return {
      productName: p.reportedName,
      ...holderOf(drug),
      drug,
      forwards: forwardsFor(c.holderForwards, p.reportedName),
    };
  });
}

export type ForwardState = "AWAITING" | "FORWARDED" | "OWN_BRAND" | "UNKNOWN";

/** Forwarding state of a case's primary suspect product, for the Cases list. */
export function primaryForwardState(
  c: Pick<CaseSummary, "product" | "productId" | "holderForwards">,
  catalog: CatalogDrug[],
): ForwardState {
  const { status } = holderOf(findCatalogDrug(catalog, c.product, c.productId));
  if (status !== "THIRD_PARTY") return status;
  return forwardsFor(c.holderForwards, c.product).length > 0 ? "FORWARDED" : "AWAITING";
}

export const FORWARD_STATE_LABELS: Record<ForwardState, string> = {
  AWAITING: "Third-party — not yet forwarded",
  FORWARDED: "Third-party — forwarded",
  OWN_BRAND: "Own brand",
  UNKNOWN: "Holder not recorded",
};

export interface ForwardInput {
  productName: string;
  holder: string;
  contact?: string | undefined;
  method: HolderForward["method"];
  sentOn: string;
  note?: string | undefined;
}

/** Problems with a forward before it is saved; empty when it can be saved. */
export function validateForward(input: ForwardInput, today: string): string[] {
  const problems: string[] = [];
  if (!input.productName.trim()) problems.push("Choose the product.");
  if (!input.holder.trim()) problems.push("Enter the holder the report was sent to.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sentOn)) problems.push("Enter the date it was sent.");
  else if (input.sentOn > today) problems.push("The date sent cannot be in the future.");
  return problems;
}
