import { usePvQuery } from "@/lib/data-source";
import { psur as psurApi } from "@/services/api/psur";
import { demoPsurDocuments } from "@/services/demo/dataset";
import type { PsurDocument } from "@/types/pv";

/**
 * The open report, in full. Lists carry only a summary of each report (no
 * full text, no AI working), so the report someone opens is read on its
 * own. `doc` is undefined until it has loaded, and never a different
 * report's data while switching.
 */
export function usePsurDocument(id: string | undefined) {
  const query = usePvQuery<PsurDocument | null>(
    ["psur", "document", id ?? "none"],
    async () => (id ? psurApi.document(id) : null),
    () => demoPsurDocuments.find((d) => d.id === id) ?? null,
  );
  const loaded = query.data?.data;
  return {
    doc: loaded && loaded.id === id ? loaded : undefined,
    loading: !!id && query.isLoading,
    error: query.error,
    refetch: () => query.refetch(),
  };
}
