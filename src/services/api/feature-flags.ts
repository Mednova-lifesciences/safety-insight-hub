/**
 * Temporary switch for evaluating AI-only issue detection across line-list
 * and PSUR/PBRER review. Flip back to true to restore rule-based checks —
 * an always-on layer for line-list, and the fallback used when AI is
 * unavailable for PSUR — with no other code changes needed. Every call
 * site that reads this flag keeps its rule-based logic fully intact, just
 * conditionally invoked.
 */
export const RULE_BASED_DETECTION_ENABLED = false;

/**
 * Temporary switch to hide auto-fix workflows across line-list and PSUR/
 * PBRER review. While false, "Fix Issues"/"Run Full Fix" and their paired
 * "Download Fixed ..." buttons never appear — issues/findings can only be
 * reviewed on screen and exported via the deterministic executive summary
 * (which only ever includes what a human has actually accepted, for PSUR;
 * line-list's summary reports everything detected, since line-list has no
 * accept/dismiss step). The underlying fix code (linelist.fixIssues/
 * downloadCsv, psur.runFullFix/downloadFixedDocument) is untouched, so this
 * can be flipped back on with no other code changes.
 */
export const AUTO_FIX_ENABLED = false;
