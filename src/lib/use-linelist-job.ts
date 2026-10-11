import { useQuery } from "@tanstack/react-query";
import { linelist, type ParsedRow } from "@/services/api/linelist";
import type { LineListJob } from "@/types/pv";

export type FullLineListJob = LineListJob & { parsedRows?: ParsedRow[] };

/**
 * A listed job in full, rows included. Lists leave the rows out; the case
 * IDs shown beside each issue and change come from them. Read again
 * whenever the job is rechecked or fixed (its data may have changed), and
 * the previous copy is kept on screen meanwhile so the IDs do not blink.
 * Undefined until loaded — callers fall back to the listed job.
 */
export function useLineListJob(job: LineListJob | undefined): FullLineListJob | undefined {
  const query = useQuery({
    queryKey: ["linelist", "job", job?.id ?? "none", job?.checkedAt ?? "", job?.fixedAt ?? ""],
    queryFn: () => linelist.job(job!.id),
    enabled: !!job,
    retry: false,
    placeholderData: (previous) => previous,
  });
  return query.data && query.data.id === job?.id ? query.data : undefined;
}
