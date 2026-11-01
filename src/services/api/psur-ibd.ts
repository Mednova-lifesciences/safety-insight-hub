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
// Each organisation has its own register row. The first one ever saved was
// called "psur-ibd-register" and is still read and written under that id; a
// fixed id for everyone, though, meant that row (primary key) belonged to the
// first organisation that saved, and every other organisation's save hit it
// and was refused. A new register therefore gets an id of its own.
const NEW_REGISTER_PREFIX = "psur-ibd-register";

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

interface Register {
  /** The row holding this organisation's register, or null before its first save. */
  rowId: string | null;
  entries: IbdRegisterEntry[];
}

/** This organisation's register. Row-level security limits the read to the
 *  caller's own organisation, so it is found by its kind, not a fixed id. */
async function read(): Promise<Register> {
  const { data, error } = await supabase
    .from("pv_psur_documents")
    .select("id, data")
    .eq("data->>kind", PSUR_IBD_REGISTER_KIND)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as { id: string; data: { entries?: IbdRegisterEntry[] } } | undefined;
  return { rowId: row?.id ?? null, entries: row?.data?.entries ?? [] };
}

async function write(register: Register, entries: IbdRegisterEntry[]): Promise<void> {
  const id = register.rowId ?? newId(NEW_REGISTER_PREFIX);
  const { error } = await supabase.from("pv_psur_documents").upsert(
    {
      id,
      data: toJson({
        kind: PSUR_IBD_REGISTER_KIND,
        id,
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
    (await read()).entries.sort((a, b) => a.activeSubstance.localeCompare(b.activeSubstance)),

  /** Adds an entry, or updates the one with this id. One entry per active
   *  substance: a second entry for the same substance is refused. */
  save: async (
    input: Omit<IbdRegisterEntry, "id" | "by" | "at"> & { id?: string },
  ): Promise<IbdRegisterEntry> => {
    const register = await read();
    const { entries } = register;
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
    await write(
      register,
      before ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry],
    );
    await recordAudit({
      action: before ? "PSUR_IBD_REGISTER_UPDATED" : "PSUR_IBD_REGISTER_ADDED",
      entity: "PsurIbdRegister",
      entityId: entry.id,
      previousValue: before ? describe(before) : null,
      newValue: `${describe(entry)} (source: ${entry.source || "not stated"})`,
    });
    return entry;
  },

  /** A person confirmed a report's product is this entry (usually after
   *  the AI suggested it despite a misspelling). The report's spellings are
   *  remembered on the entry, so this report and later ones match it
   *  without asking again. Who entered the IBD is unchanged; this is
   *  audited on its own. */
  addSpellings: async (
    id: string,
    spellings: { productName?: string; nafdacRegNo?: string },
  ): Promise<IbdRegisterEntry> => {
    const register = await read();
    const { entries } = register;
    const e = entries.find((x) => x.id === id);
    if (!e) throw new Error("That register entry no longer exists.");
    const has = (list: string[], v: string) =>
      list.some((x) => x.trim().toLowerCase() === v.trim().toLowerCase());
    const name = spellings.productName?.trim();
    const reg = spellings.nafdacRegNo?.trim();
    const next: IbdRegisterEntry = {
      ...e,
      productNames: name && !has(e.productNames, name) ? [...e.productNames, name] : e.productNames,
      nafdacRegNos: reg && !has(e.nafdacRegNos, reg) ? [...e.nafdacRegNos, reg] : e.nafdacRegNos,
    };
    await write(
      register,
      entries.map((x) => (x.id === id ? next : x)),
    );
    await recordAudit({
      action: "PSUR_IBD_REGISTER_SPELLING_ADDED",
      entity: "PsurIbdRegister",
      entityId: id,
      previousValue: describe(e),
      newValue: `confirmed as the same product: ${[name, reg].filter(Boolean).join(" / ")}`,
    });
    return next;
  },

  remove: async (id: string): Promise<void> => {
    const register = await read();
    const { entries } = register;
    const gone = entries.find((e) => e.id === id);
    if (!gone) return;
    await write(
      register,
      entries.filter((e) => e.id !== id),
    );
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
    const register = await read();
    const { entries } = register;
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
    await write(register, next);
    await recordAudit({
      action: "PSUR_IBD_REGISTER_IMPORTED",
      entity: "PsurIbdRegister",
      entityId: filename,
      newValue: `${added} added, ${updated} updated, ${unchanged} unchanged`,
    });
    return { added, updated, unchanged };
  },
};
