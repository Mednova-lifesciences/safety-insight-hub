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
  /** Marketing authorisation holder — whoever holds the NAFDAC registration. */
  holder?: string | undefined;
  /** The organisation itself holds the registration (e.g. a private label). */
  ownBrand?: boolean | undefined;
  /** PSUR schedule, for own-brand products. */
  psur?: PsurSchedule | undefined;
}

export interface PsurSchedule {
  /** International birth date (YYYY-MM-DD). */
  ibd?: string | undefined;
  /** Reporting interval in months: 6, 12 or 36. */
  intervalMonths?: number | undefined;
  /** Data lock point of the last PSUR submitted (YYYY-MM-DD). */
  lastDlp?: string | undefined;
  /** When that PSUR was submitted, if recorded. */
  lastSubmittedOn?: string | undefined;
}

export interface CatalogDrugInput {
  name: string;
  activeIngredient?: string | undefined;
  strength?: string | undefined;
  doseUnit?: string | undefined;
  route?: string | undefined;
  holder?: string | undefined;
  ownBrand?: boolean | undefined;
  psur?: PsurSchedule | undefined;
}

function describeHolder(d: {
  name: string;
  holder?: string | undefined;
  ownBrand?: boolean | undefined;
}) {
  return `${d.name} — ${d.ownBrand ? "own brand" : d.holder ? `holder ${d.holder}` : "holder not recorded"}`;
}

function fromRow(row: { id: string; data: unknown }): CatalogDrug {
  return { id: row.id, ...(row.data as Omit<CatalogDrug, "id">) };
}

/** The manager's own drug catalog — org isolation is enforced entirely by
 *  `pv_products` RLS (see 012_org_codes_and_public_intake.sql), so these
 *  calls never filter by organization_id themselves. */
export const products = {
  list: async (): Promise<CatalogDrug[]> => {
    const { data, error } = await supabase.from("pv_products").select("id,data").order("id");
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

  /** Merges `input` over the stored entry, so fields a caller does not send
   *  (e.g. the PSUR schedule when editing the name) are kept. A key sent as
   *  undefined clears that field. */
  update: async (
    id: string,
    input: Partial<CatalogDrugInput>,
    audit?: { action: string; previousValue: string; newValue: string; reason: string },
  ): Promise<CatalogDrug> => {
    const { data: existing, error: readError } = await supabase
      .from("pv_products")
      .select("id,data")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) throw new Error("That drug could no longer be found.");
    const before = fromRow(existing);
    const { id: _id, ...beforeData } = before;
    const merged = { ...beforeData, ...input };
    const { error } = await supabase
      .from("pv_products")
      .update({ data: toJson(merged) })
      .eq("id", id);
    if (error) throw new Error(error.message);
    await recordAudit({
      entity: "Product",
      entityId: id,
      ...(audit ?? {
        action: "PRODUCT_UPDATED",
        previousValue: describeHolder(before),
        newValue: describeHolder(merged),
        reason: `Catalog entry for ${merged.name} edited`,
      }),
    });
    return { id, ...merged };
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
