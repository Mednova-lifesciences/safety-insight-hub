import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { IbdRegisterEntry } from "@/services/psur/ibd-register";

/**
 * Storage for the IBD register.
 *
 * One record in pv_psur_documents (`data.kind = "PSUR_IBD_REGISTER"`), so it
 * sits with the PSUR data, carries that table's per-organisation isolation,
 * is open to the three admin roles who use it, and needs no new table.
 * Every listing of PSUR documents leaves it out (isPsurRegisterRow). It is
 * not in pv_products: that table feeds the WhatsApp and public drug pickers.
 */

export const PSUR_IBD_REGISTER_KIND = "PSUR_IBD_REGISTER";
const REGISTER_ID = "psur-ibd-register";

export function isPsurRegisterRow(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === PSUR_IBD_REGISTER_KIND
  );
}

const substanceKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

async function read(): Promise<IbdRegisterEntry[]> {
  const { data, error } = await supabase
    .from("pv_psur_documents")
    .select("data")
    .eq("id", REGISTER_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data?.data as { entries?: IbdRegisterEntry[] } | undefined;
  return row?.entries ?? [];
}

async function write(entries: IbdRegisterEntry[]): Promise<void> {
  const { error } = await supabase.from("pv_psur_documents").upsert(
    {
      id: REGISTER_ID,
      data: toJson({
        kind: PSUR_IBD_REGISTER_KIND,
        id: REGISTER_ID,
        entries,
        updatedAt: new Date().toISOString(),
      }),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
}

const describe = (e: Pick<IbdRegisterEntry, "activeSubstance" | "ibd">) =>
  `${e.activeSubstance}: IBD ${e.ibd}`;

export const ibdRegister = {
  list: async (): Promise<IbdRegisterEntry[]> =>
    (await read()).sort((a, b) => a.activeSubstance.localeCompare(b.activeSubstance)),

  /** Adds an entry, or updates the one with this id. One entry per active
   *  substance: a second entry for the same substance is refused. */
  save: async (
    input: Omit<IbdRegisterEntry, "id" | "by" | "at"> & { id?: string },
  ): Promise<IbdRegisterEntry> => {
    const entries = await read();
    const actor = currentActor();
    const key = substanceKey(input.activeSubstance);
    const clash = entries.find((e) => substanceKey(e.activeSubstance) === key && e.id !== input.id);
    if (clash)
      throw new Error(
        `${clash.activeSubstance} is already in the register. Edit that entry instead.`,
      );
    const before = input.id ? entries.find((e) => e.id === input.id) : undefined;
    const entry: IbdRegisterEntry = {
      ...input,
      id: input.id ?? newId("ibd"),
      by: actor.name,
      at: new Date().toISOString(),
    };
    await write(before ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry]);
    await recordAudit({
      action: before ? "PSUR_IBD_REGISTER_UPDATED" : "PSUR_IBD_REGISTER_ADDED",
      entity: "PsurIbdRegister",
      entityId: entry.id,
      previousValue: before ? describe(before) : null,
      newValue: `${describe(entry)} (source: ${entry.source || "not stated"})`,
    });
    return entry;
  },

  remove: async (id: string): Promise<void> => {
    const entries = await read();
    const gone = entries.find((e) => e.id === id);
    if (!gone) return;
    await write(entries.filter((e) => e.id !== id));
    await recordAudit({
      action: "PSUR_IBD_REGISTER_REMOVED",
      entity: "PsurIbdRegister",
      entityId: id,
      previousValue: describe(gone),
      newValue: "removed",
    });
  },

  /** Adds new substances and updates existing ones (matched by active
   *  substance) from an imported file. */
  importRows: async (
    rows: Omit<IbdRegisterEntry, "id" | "by" | "at">[],
    filename: string,
  ): Promise<{ added: number; updated: number; unchanged: number }> => {
    const entries = await read();
    const actor = currentActor();
    const at = new Date().toISOString();
    let added = 0,
      updated = 0,
      unchanged = 0;
    const next = [...entries];
    for (const row of rows) {
      const i = next.findIndex(
        (e) => substanceKey(e.activeSubstance) === substanceKey(row.activeSubstance),
      );
      if (i < 0) {
        next.push({ ...row, id: newId("ibd"), by: actor.name, at });
        added++;
      } else if (
        next[i]!.ibd !== row.ibd ||
        next[i]!.source !== row.source ||
        next[i]!.productNames.join("|") !== row.productNames.join("|") ||
        next[i]!.nafdacRegNos.join("|") !== row.nafdacRegNos.join("|")
      ) {
        next[i] = { ...next[i]!, ...row, by: actor.name, at };
        updated++;
      } else unchanged++;
    }
    await write(next);
    await recordAudit({
      action: "PSUR_IBD_REGISTER_IMPORTED",
      entity: "PsurIbdRegister",
      entityId: filename,
      newValue: `${added} added, ${updated} updated, ${unchanged} unchanged`,
    });
    return { added, updated, unchanged };
  },
};
