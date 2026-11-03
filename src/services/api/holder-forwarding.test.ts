import { describe, expect, it } from "vitest";
import {
  caseProductHolders,
  findCatalogDrug,
  holderOf,
  needsForward,
  primaryForwardState,
  validateForward,
} from "./holder-forwarding";
import { buildCaseDetail } from "./cases";
import type { CatalogDrug } from "./products";
import type { HolderForward } from "@/types/pv";

const catalog: CatalogDrug[] = [
  { id: "d1", name: "Modia Paracetamol", ownBrand: true, holder: "MedPlus" },
  { id: "d2", name: "Brand X Amoxicillin", holder: "Example Pharma" },
  { id: "d3", name: "Unlabelled Syrup" },
];

const fwd = (productName: string): HolderForward => ({
  id: "f1",
  productName,
  holder: "Example Pharma",
  method: "EMAIL",
  sentOn: "2026-11-02",
  recordedBy: "Cora",
  recordedAt: "2026-11-02T10:00:00Z",
});

describe("findCatalogDrug", () => {
  it("prefers the catalog id, then falls back to the name ignoring case", () => {
    expect(findCatalogDrug(catalog, "renamed", "d2")?.id).toBe("d2");
    expect(findCatalogDrug(catalog, " brand x amoxicillin ")?.id).toBe("d2");
    expect(findCatalogDrug(catalog, "renamed", "gone")).toBeUndefined();
    expect(findCatalogDrug(catalog, "")).toBeUndefined();
  });
});

describe("holderOf", () => {
  it("reads own brand, third party, or unknown from the catalog", () => {
    expect(holderOf(catalog[0]).status).toBe("OWN_BRAND");
    expect(holderOf(catalog[1])).toEqual({ status: "THIRD_PARTY", holder: "Example Pharma" });
    expect(holderOf(catalog[2]).status).toBe("UNKNOWN");
    expect(holderOf(undefined).status).toBe("UNKNOWN");
  });
});

describe("primaryForwardState", () => {
  it("flags a third-party product until a forward is recorded for it", () => {
    const c = { product: "Brand X Amoxicillin", productId: "d2" };
    expect(primaryForwardState(c, catalog)).toBe("AWAITING");
    expect(
      primaryForwardState({ ...c, holderForwards: [fwd("Brand X Amoxicillin")] }, catalog),
    ).toBe("FORWARDED");
  });
  it("does not count a forward made for a different product", () => {
    const c = { product: "Brand X Amoxicillin", holderForwards: [fwd("Something else")] };
    expect(primaryForwardState(c, catalog)).toBe("AWAITING");
  });
  it("leaves own-brand and unknown products alone", () => {
    expect(primaryForwardState({ product: "Modia Paracetamol" }, catalog)).toBe("OWN_BRAND");
    expect(primaryForwardState({ product: "Not in catalog" }, catalog)).toBe("UNKNOWN");
  });
});

describe("caseProductHolders", () => {
  it("covers every suspect product, using the catalog id only for the primary", () => {
    const holders = caseProductHolders(
      {
        productId: "d1",
        suspectProducts: [
          { reportedName: "Modia Paracetamol" },
          { reportedName: "brand x amoxicillin" },
        ],
        holderForwards: [fwd("Brand X Amoxicillin")],
      },
      catalog,
    );
    expect(holders.map((h) => h.status)).toEqual(["OWN_BRAND", "THIRD_PARTY"]);
    expect(holders[1]?.forwards).toHaveLength(1);
  });
});

describe("validateForward", () => {
  const ok = {
    productName: "Brand X Amoxicillin",
    holder: "Example Pharma",
    method: "EMAIL" as const,
    sentOn: "2026-11-03",
  };
  it("accepts a complete forward", () => {
    expect(validateForward(ok, "2026-11-03")).toEqual([]);
  });
  it("needs a product, a holder and a past or present date", () => {
    expect(validateForward({ ...ok, productName: " " }, "2026-11-03")).toHaveLength(1);
    expect(validateForward({ ...ok, holder: "" }, "2026-11-03")).toHaveLength(1);
    expect(validateForward({ ...ok, sentOn: "" }, "2026-11-03")).toHaveLength(1);
    expect(validateForward({ ...ok, sentOn: "2026-11-04" }, "2026-11-03")).toHaveLength(1);
  });
});

describe("buildCaseDetail", () => {
  it("keeps the catalog id of the picked product", () => {
    const c = buildCaseDetail(
      "MN-1",
      {
        reporter: {},
        patient: {},
        product: { reportedName: "Brand X Amoxicillin", catalogId: "d2" },
        reaction: { reportedTerm: "Rash" },
        narrative: "",
        reportedSeriousness: "NON_SERIOUS",
        seriousnessCriteria: [],
      },
      "x",
    );
    expect(c.productId).toBe("d2");
  });
});

describe("unlisted products", () => {
  const base = {
    reporter: {},
    patient: {},
    reaction: { reportedTerm: "Rash" },
    narrative: "",
    reportedSeriousness: "NON_SERIOUS",
    seriousnessCriteria: [],
  };

  it("marks the case unlisted and keeps the holder the reporter gave", () => {
    const c = buildCaseDetail(
      "MN-1",
      {
        ...base,
        product: { reportedName: "Foreign Syrup", unlisted: true, reportedHolder: " Acme " },
      },
      "x",
    );
    expect(c.unlistedProduct).toBe(true);
    expect(c.reportedHolder).toBe("Acme");
  });

  it("ignores the unlisted flag when a catalog drug was picked", () => {
    const c = buildCaseDetail(
      "MN-1",
      { ...base, product: { reportedName: "Brand X", unlisted: true, catalogId: "d2" } },
      "x",
    );
    expect(c).not.toHaveProperty("unlistedProduct");
  });

  it("stays flagged until forwarded", () => {
    const c = { product: "Foreign Syrup", unlistedProduct: true };
    expect(primaryForwardState(c, catalog)).toBe("UNLISTED");
    expect(needsForward(primaryForwardState(c, catalog))).toBe(true);
    expect(primaryForwardState({ ...c, holderForwards: [fwd("Foreign Syrup")] }, catalog)).toBe(
      "FORWARDED",
    );
  });

  it("lets the catalog decide once the product is added to it", () => {
    const withDrug = [...catalog, { id: "d9", name: "Foreign Syrup", holder: "Acme" }];
    expect(primaryForwardState({ product: "Foreign Syrup", unlistedProduct: true }, withDrug)).toBe(
      "AWAITING",
    );
  });

  it("shows the reporter's holder on the case panel", () => {
    const [h] = caseProductHolders(
      {
        suspectProducts: [{ reportedName: "Foreign Syrup" }],
        unlistedProduct: true,
        reportedHolder: "Acme",
      },
      catalog,
    );
    expect(h).toMatchObject({ status: "UNLISTED", holder: "Acme" });
  });
});
