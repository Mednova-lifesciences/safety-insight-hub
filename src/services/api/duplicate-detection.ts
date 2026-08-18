import { apiRequest } from './client';

/**
 * Duplicate Detection - Phase 2.1
 * Identifies potentially duplicate cases within an organization
 */

export interface MatchedFields {
  product: number;
  reaction: number;
  patient: number;
  dobMatch: boolean;
}

export interface DuplicateEvidence {
  product: string;
  reaction: string;
  patient: string;
}

export interface DuplicateCandidate {
  id: string;
  caseId: string;
  caseNumber: string;
  confidence: number;
  matchedFields: MatchedFields;
  evidence: DuplicateEvidence;
  createdAt: string;
  status: 'OPEN' | 'REVIEWED' | 'MERGED' | 'KEEP_SEPARATE';
}

export interface DuplicatesSummary {
  total: number;
  open: number;
  resolved: number;
  merged: number;
  details: Array<any>;
}

/**
 * Check a case for potential duplicates.
 * Analyzes product, patient, and reaction information to find similar cases.
 * Returns a ranked list of candidates sorted by confidence score.
 */
export async function checkForDuplicates(
  caseId: string,
): Promise<DuplicateCandidate[]> {
  return client.post(
    `/api/cases/${caseId}/duplicate-check`,
  ) as Promise<DuplicateCandidate[]>;
}

/**
 * Get summary of all duplicate issues in the organization.
 */
export async function getDuplicatesSummary(): Promise<DuplicatesSummary> {
  return client.get('/api/duplicates/summary') as Promise<DuplicatesSummary>;
}

/**
 * Resolve a duplicate match by marking it as reviewed.
 * Actions: REVIEWED (acknowledged but separate), MERGED (merge cases), KEEP_SEPARATE
 */
export async function resolveDuplicateMatch(
  matchId: string,
  action: 'REVIEWED' | 'MERGED' | 'KEEP_SEPARATE' = 'REVIEWED',
): Promise<{ status: string; action: string }> {
  return client.post(
    `/api/duplicates/${matchId}/resolve?action=${action}`,
  ) as Promise<{ status: string; action: string }>;
}
