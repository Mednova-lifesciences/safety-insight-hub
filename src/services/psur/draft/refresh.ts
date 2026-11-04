import { cases as casesApi } from "@/services/api/cases";
import { products as productsApi } from "@/services/api/products";
import { signals as signalsApi } from "@/services/api/signals";
import {
  registrations as registrationsApi,
  RegistrationsNotSetUpError,
  type Registration,
} from "@/services/api/registrations";
import { buildDraftFacts, type CaseRecord } from "./facts";
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
  const facts = buildDraftFacts({
    drug,
    periodStart: draft.periodStart,
    dlp: draft.dlp,
    cases: allCases as CaseRecord[],
    signals: signalList,
    registrations: regs,
    organisation,
  });
  return psurDrafts.saveFacts(draft, facts);
}
