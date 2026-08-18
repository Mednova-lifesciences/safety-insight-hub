import { apiRequest } from './client';

/**
 * Consistency Check - Phase 2.2
 * Automated quality and data completeness checks on cases
 */

export interface ConsistencyCheckResult {
  id: string;
  caseId: string;
  checkType: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  evidence?: Record<string, unknown>;
  suggestedResolution?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
}

/**
 * Run consistency checks on a case.
 * Performs automated quality validation including:
 * - Patient identification completeness
 * - Product information presence
 * - Reaction/AE information
 * - Seriousness justification
 * - Narrative completeness
 * - Minimum information standards
 */
export async function runConsistencyCheck(
  caseId: string,
): Promise<ConsistencyCheckResult[]> {
  return client.post(
    `/api/cases/${caseId}/consistency-check`,
  ) as Promise<ConsistencyCheckResult[]>;
}

/**
 * Get consistency check results for a case.
 */
export async function getConsistencyChecks(
  caseId: string,
): Promise<ConsistencyCheckResult[]> {
  return client.get(
    `/api/cases/${caseId}/consistency-check`,
  ) as Promise<ConsistencyCheckResult[]>;
}

/**
 * Acknowledge/dismiss a consistency check finding.
 */
export async function acknowledgeCheck(
  caseId: string,
  checkId: string,
): Promise<{ status: string }> {
  return client.post(
    `/api/cases/${caseId}/consistency-check/${checkId}/acknowledge`,
  ) as Promise<{ status: string }>;
}
