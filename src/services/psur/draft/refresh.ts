import { cases as casesApi } from "@/services/api/cases";
import { products as productsApi } from "@/services/api/products";
import { signals as signalsApi } from "@/services/api/signals";
import {
  registrations as registrationsApi,
  RegistrationsNotSetUpError,
  type Registration,
} from "@/services/api/registrations";
import { apiRequest } from "@/services/api/client";
import {
  buildDraftFacts,
  codedReactionCodes,
  isProductCase,
  type CaseRecord,
  type MeddraLookup,
} from "./facts";
import { psurDrafts, type PsurDraft } from "./drafts";

/** Re-reads the records and stores a fresh facts snapshot on the draft. */
export async function refreshDraftFacts(
  draft: PsurDraft,
  organisation: string,
): Promise<PsurDraft> {
  const [catalog, allCases, signalList, regs] = await Promise.all([
    productsApi.list(),
    casesApi.list(),
    signalsApi.list(),
    registrationsApi.list().catch((err: unknown): Registration[] => {
      if (err instanceof RegistrationsNotSetUpError) return [];
      throw err;
    }),
  ]);
  const drug = catalog.find((d) => d.id === draft.productId);
  if (!drug) throw new Error(`${draft.productName} is no longer in the Drug Catalog.`);
  const meddra = await meddraLookup(
    codedReactionCodes((allCases as CaseRecord[]).filter((c) => isProductCase(c, drug))),
  );
  const facts = buildDraftFacts({
    drug,
    periodStart: draft.periodStart,
    dlp: draft.dlp,
    cases: allCases as CaseRecord[],
    signals: signalList,
    registrations: regs,
    organisation,
    meddra,
  });
  return psurDrafts.saveFacts(draft, facts);
}

/** PT and primary SOC for each LLT code. A code the dictionary service cannot
 *  resolve (or an unreachable service) is left out, so its row is tabulated
 *  as coded, under "SOC not resolved". */
async function meddraLookup(codes: string[]): Promise<MeddraLookup> {
  const lookup: MeddraLookup = new Map();
  await Promise.all(
    codes.map(async (code) => {
      try {
        const r = await apiRequest<{
          status: string;
          term?: { preferred_term: string; hierarchy?: { soc?: string } };
        }>("/api/coding/meddra/resolve", { method: "POST", body: { text: code } });
        if (r.status === "MAPPED" && r.term?.hierarchy?.soc)
          lookup.set(code, { preferredTerm: r.term.preferred_term, soc: r.term.hierarchy.soc });
      } catch {
        // Left unresolved; the tabulation says so.
      }
    }),
  );
  return lookup;
}
