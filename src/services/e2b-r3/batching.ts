import type { PVCase } from "./types";

/** VigiFlow's documented eReporting for Industry import limit. */
export const MAX_ICSRS_PER_BATCH = 100;

export interface Batch {
  batchNumber: number;
  totalBatches: number;
  cases: PVCase[];
  /** Unique per batch — a real transmission/message identifier, distinct
   *  from any individual case's own sendersCaseId (see PVCase docs on why
   *  those must never be conflated). */
  transmissionId: string;
}

/** Splits cases into batches of at most MAX_ICSRS_PER_BATCH, preserving
 *  input order. 231 cases -> 3 batches (100/100/31), matching the task
 *  spec's worked example exactly. Never produces a batch larger than the
 *  limit, and never silently drops a case. */
export function splitIntoBatches(cases: PVCase[], transmissionIdPrefix: string): Batch[] {
  if (cases.length === 0) return [];
  const totalBatches = Math.ceil(cases.length / MAX_ICSRS_PER_BATCH);
  const batches: Batch[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const start = i * MAX_ICSRS_PER_BATCH;
    const slice = cases.slice(start, start + MAX_ICSRS_PER_BATCH);
    batches.push({
      batchNumber: i + 1,
      totalBatches,
      cases: slice,
      transmissionId: `${transmissionIdPrefix}-batch${String(i + 1).padStart(3, "0")}`,
    });
  }
  return batches;
}

/** MEDNOVA_E2B_R3_NAFDAC_<YYYYMMDD>_BATCH_<NNN>.xml — deterministic,
 *  professional, never contains a patient name or an internal random job
 *  id as the only identifying information (task spec §42). */
export function batchFilename(batch: Batch, generatedAt: Date): string {
  const y = generatedAt.getUTCFullYear();
  const m = String(generatedAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(generatedAt.getUTCDate()).padStart(2, "0");
  const batchNum = String(batch.batchNumber).padStart(3, "0");
  return `MEDNOVA_E2B_R3_NAFDAC_${y}${m}${d}_BATCH_${batchNum}.xml`;
}
