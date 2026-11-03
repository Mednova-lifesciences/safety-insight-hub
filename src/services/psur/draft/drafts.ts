import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "@/services/api/db";
import { isMissingTable } from "@/services/api/branches";
import { SECTIONS, SECTION_BY_ID, INPUTS, type DraftSectionId, type InputKey } from "./template";
import type { DraftFacts } from "./facts";

/** A PSUR being written by the organisation for one of its own products. */
export interface SectionState {
  /** Marked not applicable by the author, with the reason printed. */
  notApplicable?: { reason: string } | undefined;
  /** A person has read the section as it will print and accepted it. */
  reviewed?: { by: string; at: string } | undefined;
}

export interface PsurDraft {
  id: string;
  productId: string;
  productName: string;
  /** The reporting interval: after periodStart, up to and including the DLP. */
  periodStart: string;
  dlp: string;
  intervalMonths: number;
  ibd?: string | undefined;
  status: "DRAFT" | "SENT_TO_QC" | "ARCHIVED";
  inputs: Partial<Record<InputKey, string>>;
  sections: Partial<Record<DraftSectionId, SectionState>>;
  /** Facts from the safety database, as last refreshed. */
  facts?: DraftFacts | undefined;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentToQc?: { by: string; at: string; documentId?: string | undefined } | undefined;
}

export class DraftsNotSetUpError extends Error {
  constructor() {
    super("PSUR drafting has not been set up on this database yet.");
  }
}

function fromRow(row: { id: string; data: unknown }): PsurDraft {
  const d = row.data as PsurDraft;
  return { ...d, id: row.id, inputs: d.inputs ?? {}, sections: d.sections ?? {} };
}

async function save(draft: PsurDraft): Promise<void> {
  const { id, ...data } = draft;
  const { error } = await supabase
    .from("pv_psur_drafts")
    .update({ data: toJson(data), updated_at: draft.updatedAt })
    .eq("id", id);
  if (isMissingTable(error)) throw new DraftsNotSetUpError();
  if (error) throw new Error(error.message);
}

export const psurDrafts = {
  list: async (): Promise<PsurDraft[]> => {
    const { data, error } = await supabase.from("pv_psur_drafts").select("id,data");
    if (isMissingTable(error)) throw new DraftsNotSetUpError();
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get: async (id: string): Promise<PsurDraft> => {
    const { data, error } = await supabase
      .from("pv_psur_drafts")
      .select("id,data")
      .eq("id", id)
      .maybeSingle();
    if (isMissingTable(error)) throw new DraftsNotSetUpError();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("That draft could not be found.");
    return fromRow(data);
  },

  create: async (input: {
    productId: string;
    productName: string;
    periodStart: string;
    dlp: string;
    intervalMonths: number;
    ibd?: string | undefined;
    inputs?: Partial<Record<InputKey, string>>;
  }): Promise<PsurDraft> => {
    const actor = currentActor();
    const now = new Date().toISOString();
    const draft: PsurDraft = {
      id: newId("psurdraft"),
      ...input,
      status: "DRAFT",
      inputs: input.inputs ?? {},
      sections: {},
      createdBy: actor.name,
      createdAt: now,
      updatedAt: now,
    };
    const { id, ...data } = draft;
    const { error } = await supabase.from("pv_psur_drafts").insert({ id, data: toJson(data) });
    if (isMissingTable(error)) throw new DraftsNotSetUpError();
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "PSUR_DRAFT_CREATED",
      entity: "PsurDraft",
      entityId: id,
      newValue: `${draft.productName}, DLP ${draft.dlp}`,
      reason: "PSUR draft started",
    });
    return draft;
  },

  /** Saves author inputs. Editing a section clears its "reviewed" mark, since
   *  what was reviewed is no longer what will print. */
  saveInputs: async (
    draft: PsurDraft,
    changes: Partial<Record<InputKey, string>>,
  ): Promise<PsurDraft> => {
    const changedKeys = (Object.keys(changes) as InputKey[]).filter(
      (k) => (changes[k] ?? "") !== (draft.inputs[k] ?? ""),
    );
    if (changedKeys.length === 0) return draft;
    const sections = { ...draft.sections };
    for (const s of SECTIONS) {
      if (s.inputs.some((k) => changedKeys.includes(k)) && sections[s.id]?.reviewed) {
        sections[s.id] = { ...sections[s.id], reviewed: undefined };
      }
    }
    const next: PsurDraft = {
      ...draft,
      inputs: { ...draft.inputs, ...changes },
      sections,
      updatedAt: new Date().toISOString(),
    };
    await save(next);
    await recordAudit({
      action: "PSUR_DRAFT_EDITED",
      entity: "PsurDraft",
      entityId: draft.id,
      newValue: changedKeys.map((k) => INPUTS[k].label).join(", "),
      reason: "Author inputs saved",
    });
    return next;
  },

  setSection: async (
    draft: PsurDraft,
    id: DraftSectionId,
    state: SectionState,
    reason: string,
  ): Promise<PsurDraft> => {
    const next: PsurDraft = {
      ...draft,
      sections: { ...draft.sections, [id]: state },
      updatedAt: new Date().toISOString(),
    };
    await save(next);
    await recordAudit({
      action: "PSUR_DRAFT_SECTION_UPDATED",
      entity: "PsurDraft",
      entityId: draft.id,
      newValue: `${SECTION_BY_ID[id].title}: ${reason}`,
    });
    return next;
  },

  saveFacts: async (draft: PsurDraft, facts: DraftFacts): Promise<PsurDraft> => {
    const next: PsurDraft = { ...draft, facts, updatedAt: new Date().toISOString() };
    await save(next);
    await recordAudit({
      action: "PSUR_DRAFT_DATA_REFRESHED",
      entity: "PsurDraft",
      entityId: draft.id,
      newValue: `${facts.interval.total} case(s) in the interval, extracted ${facts.takenAt}`,
    });
    return next;
  },

  update: async (
    draft: PsurDraft,
    changes: Partial<PsurDraft>,
    audit: string,
  ): Promise<PsurDraft> => {
    const next: PsurDraft = { ...draft, ...changes, updatedAt: new Date().toISOString() };
    await save(next);
    await recordAudit({
      action: "PSUR_DRAFT_UPDATED",
      entity: "PsurDraft",
      entityId: draft.id,
      newValue: audit,
    });
    return next;
  },
};
