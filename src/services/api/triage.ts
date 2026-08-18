import { apiRequest } from './client';

/**
 * Intelligent Triage - Phase 2.3
 * Automated case prioritization and workflow routing
 */

export interface TriageFactor {
  name: string;
  points: number;
  description: string;
}

export interface TriageScore {
  triageScore: number;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  factors: TriageFactor[];
  recommendedNextStep: string;
  rationale: string;
}

export interface TriageDashboard {
  totalCases: number;
  seriousCases: number;
  seriousCasePercentage: number;
  highPriorityCases: number;
  criticalCases: number;
  averageTriageScore: number;
  casesByWorkflowStep: Record<string, number>;
  metrics: {
    completionRate: number;
    averageCasesPerUser: string;
  };
}

/**
 * Calculate intelligent triage score for a case.
 * Analyzes multiple factors: seriousness, completeness, urgency, reporter quality
 * Returns prioritization and workflow recommendations.
 */
export async function calculateTriageScore(caseId: string): Promise<TriageScore> {
  return client.post(`/api/cases/${caseId}/triage`) as Promise<TriageScore>;
}

/**
 * Get triage dashboard with organization-wide metrics.
 * Shows case distribution, priority breakdown, and workflow progress.
 */
export async function getTriageDashboard(): Promise<TriageDashboard> {
  return client.get('/api/triage/dashboard') as Promise<TriageDashboard>;
}
