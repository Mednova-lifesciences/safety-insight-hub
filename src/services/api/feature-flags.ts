/**
 * Temporary switch for evaluating AI-only issue detection across line-list
 * and PSUR/PBRER review. Flip back to true to restore rule-based checks —
 * an always-on layer for line-list, and the fallback used when AI is
 * unavailable for PSUR — with no other code changes needed. Every call
 * site that reads this flag keeps its rule-based logic fully intact, just
 * conditionally invoked.
 */
export const RULE_BASED_DETECTION_ENABLED = true;

/**
 * Switch for the auto-fix workflows across line-list and PSUR/PBRER review.
 * While true, "Fix Issues"/"Run Full Fix" and their paired "Download Fixed
 * ..." buttons appear once there's something to fix — issues/findings can
 * still always be reviewed on screen and exported via the executive summary
 * regardless of this flag (which only ever includes what a human has
 * actually accepted, for PSUR; line-list's summary reports everything
 * detected, since line-list has no accept/dismiss step). Flip to false to
 * hide the fix workflows again with no other code changes needed.
 */
export const AUTO_FIX_ENABLED = true;
