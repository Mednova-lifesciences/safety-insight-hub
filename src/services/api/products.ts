import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { newId, recordAudit, toJson } from "./db";

export interface CatalogDrug {
  id: string;
  name: string;
  activeIngredient?: string | undefined;
  strength?: string | undefined;
  doseUnit?: string | undefined;
  route?: string | undefined;
}

export interface CatalogDrugInput {
  name: string;
  activeIngredient?: string | undefined;
  strength?: string | undefined;
  doseUnit?: string | undefined;
  route?: string | undefined;
}

function fromRow(row: { id: string; data: unknown }): CatalogDrug {
  return { id: row.id, ...(row.data as Omit<CatalogDrug, "id">) };
}

/** The manager's own drug catalog — org isolation is enforced entirely by
 *  `pv_products` RLS (see 012_org_codes_and_public_intake.sql), so these
 *  calls never filter by organization_id themselves. */
export const products = {
  list: async (): Promise<CatalogDrug[]> => {
    const { data, error } = await supabase
      .from("pv_products")
      .select("id,data")
      .order("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).sort((a, b) => a.name.localeCompare(b.name));
  },

  create: async (input: CatalogDrugInput): Promise<CatalogDrug> => {
    const drug: CatalogDrug = { id: newId("drug"), ...input };
    const { error } = await supabase
      .from("pv_products")
      .insert({ id: drug.id, data: toJson({ ...input }) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "PRODUCT_CREATED",
      entity: "Product",
      entityId: drug.id,
      newValue: drug.name,
      reason: "Drug added to catalog",
    });
    return drug;
  },

  /** Inserts every row not already present (case-insensitive name match),
   *  skipping the rest as duplicates. Returns counts for the upload
   *  summary — never throws for individual duplicate rows. */
  bulkCreate: async (
    rows: CatalogDrugInput[],
    filename: string,
  ): Promise<{ created: number; skipped: number }> => {
    const existing = await products.list();
    const existingNames = new Set(existing.map((d) => d.name.trim().toLowerCase()));
    const toInsert: { id: string; data: Json }[] = [];
    let skipped = 0;
    for (const row of rows) {
      const name = row.name.trim();
      if (!name || existingNames.has(name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      existingNames.add(name.toLowerCase());
      toInsert.push({ id: newId("drug"), data: toJson({ ...row, name }) });
    }
    if (toInsert.length > 0) {
      const { error } = await supabase.from("pv_products").insert(toInsert);
      if (error) throw new Error(error.message);
    }
    await recordAudit({
      action: "PRODUCT_BULK_IMPORT",
      entity: "Product",
      entityId: filename,
      newValue: `${toInsert.length} drug(s) imported`,
      reason: `Imported from ${filename} (${skipped} skipped as duplicates/invalid)`,
    });
    return { created: toInsert.length, skipped };
  },

  /** Read-only, unauthenticated lookup for the public field-associate
   *  drug picker — scoped explicitly to one company, since anon has no
   *  session-derived organization to rely on. */
  listPublic: async (organizationId: string): Promise<CatalogDrug[]> => {
    const { data, error } = await supabase
      .from("pv_products")
      .select("id,data")
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).sort((a, b) => a.name.localeCompare(b.name));
  },
};
