/**
 * Temporary switch for evaluating AI-only issue detection across line-list
 * and PSUR/PBRER review. Flip back to true to restore rule-based checks —
 * an always-on layer for line-list, and the fallback used when AI is
 * unavailable for PSUR — with no other code changes needed. Every call
 * site that reads this flag keeps its rule-based logic fully intact, just
 * conditionally invoked.
 */
export const RULE_BASED_DETECTION_ENABLED = false;
