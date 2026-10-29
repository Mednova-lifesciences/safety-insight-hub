/** Types for psur-seed-data.mjs (read by the vitest suite). Each entry is a
 *  stored PSUR document (a PsurDocument without its analysis fields). */
export function buildPsurSeed(today?: Date): Record<string, unknown>[];
