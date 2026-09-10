import type { DiscoveredSourceCodebook } from "./discovered-codebook";
import type { FieldCodebook, SourceProfile } from "./types";

/**
 * baseSourceProfile + discoveredCodebook = runtimeSourceProfile.
 *
 * A pure function: never mutates `base`, never mutates any shared
 * singleton. Each call produces an independent object, so two different
 * uploaded documents — even against the same base profile (e.g. two
 * different Ondo AEFI files from different reporting periods, each with
 * their own possibly-different codebook) — get their own runtime profile
 * and can never leak mappings into one another. The rest of the engine
 * (mapping.ts, validation.ts, serializer.ts, batching.ts) only ever sees
 * a plain SourceProfile and has no idea whether it came straight from
 * source-profiles/registry.ts or was built at runtime from a discovered
 * codebook — that distinction stops existing the moment this function
 * returns.
 *
 * Only VALIDATED entries (see legend-parser.ts's validateDiscoveredCodebook)
 * should ever be passed in here — this function itself does not
 * re-validate, since "was this codebook already validated" is a
 * different question from "does merging it into a profile work
 * correctly," and conflating the two would make failures harder to
 * localize.
 */
export function resolveRuntimeSourceProfile(base: SourceProfile, discovered: DiscoveredSourceCodebook): SourceProfile {
  let reactionCodebook = base.reactionCodebook;
  const fieldCodebooks: Record<string, FieldCodebook> = { ...(base.fieldCodebooks ?? {}) };

  const byField = new Map<string, DiscoveredSourceCodebook["entries"]>();
  for (const entry of discovered.entries) {
    const bucket = byField.get(entry.field) ?? [];
    bucket.push(entry);
    byField.set(entry.field, bucket);
  }

  for (const [field, entries] of byField) {
    if (field === "reaction") {
      const mergedEntries = { ...reactionCodebook.entries };
      for (const e of entries) {
        mergedEntries[e.sourceCode.trim().toUpperCase()] = {
          localCode: e.sourceCode,
          sourceTerm: e.meaning,
          effectiveFrom: reactionCodebook.entries[e.sourceCode]?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        };
      }
      reactionCodebook = {
        ...reactionCodebook,
        version: `${reactionCodebook.version}+discovered:${discovered.sourceId}`,
        entries: mergedEntries,
      };
      continue;
    }

    const existing = fieldCodebooks[field];
    const mergedEntries = { ...(existing?.entries ?? {}) };
    for (const e of entries) {
      mergedEntries[e.sourceCode.trim().toUpperCase()] = { sourceCode: e.sourceCode, meaning: e.meaning };
    }
    fieldCodebooks[field] = {
      field,
      version: existing ? `${existing.version}+discovered:${discovered.sourceId}` : `discovered:${discovered.sourceId}`,
      entries: mergedEntries,
    };
  }

  return { ...base, reactionCodebook, fieldCodebooks };
}
