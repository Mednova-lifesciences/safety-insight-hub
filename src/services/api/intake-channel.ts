import type { CaseSummary, IntakeChannel } from "@/types/pv";

export const INTAKE_CHANNELS: IntakeChannel[] = [
  "BRANCH",
  "ECOMMERCE",
  "CUSTOMER_SERVICE",
  "REPORTING_LINK",
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "OTHER",
];

export const INTAKE_CHANNEL_LABELS: Record<IntakeChannel, string> = {
  BRANCH: "Branch / store",
  ECOMMERCE: "E-commerce",
  CUSTOMER_SERVICE: "Customer service",
  REPORTING_LINK: "Online reporting link",
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  EMAIL: "Email",
  OTHER: "Other",
};

/** Channels a staff member picks on the New ICSR form. The reporting link and
 *  WhatsApp are set by those flows themselves, never chosen by hand. */
export const STAFF_SELECTABLE_CHANNELS: IntakeChannel[] = [
  "BRANCH",
  "ECOMMERCE",
  "CUSTOMER_SERVICE",
  "PHONE",
  "EMAIL",
  "OTHER",
];

export const BRANCH_MAX_LENGTH = 80;

export function parseIntakeChannel(value: unknown): IntakeChannel | undefined {
  return typeof value === "string" && (INTAKE_CHANNELS as string[]).includes(value)
    ? (value as IntakeChannel)
    : undefined;
}

/** Branch names arrive from a public URL as well as from staff, so they are
 *  trimmed, stripped of control characters, collapsed and capped. */
export function cleanBranch(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const printable = [...value]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("");
  const cleaned = printable.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, BRANCH_MAX_LENGTH) : undefined;
}

/** The channel and branch to store on a new case. A branch is only kept for
 *  the branch channel; a branch with no channel means the branch channel. */
export function resolveIntake(
  channel: unknown,
  branch: unknown,
): { intakeChannel?: IntakeChannel; branch?: string } {
  const b = cleanBranch(branch);
  const c = parseIntakeChannel(channel) ?? (b ? "BRANCH" : undefined);
  if (!c) return {};
  return c === "BRANCH" && b ? { intakeChannel: c, branch: b } : { intakeChannel: c };
}

export function describeIntake(c: Pick<CaseSummary, "intakeChannel" | "branch">): string {
  if (!c.intakeChannel) return "Not recorded";
  const label = INTAKE_CHANNEL_LABELS[c.intakeChannel];
  return c.intakeChannel === "BRANCH" && c.branch ? `${label} — ${c.branch}` : label;
}

/** Filter value for cases created before channels were recorded. */
export const CHANNEL_NOT_RECORDED = "NOT_RECORDED";

export function matchesChannelFilter(
  c: Pick<CaseSummary, "intakeChannel">,
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === CHANNEL_NOT_RECORDED) return !c.intakeChannel;
  return c.intakeChannel === filter;
}

export function matchesBranchFilter(c: Pick<CaseSummary, "branch">, filter: string): boolean {
  return filter === "all" || (c.branch ?? "").toLowerCase() === filter.toLowerCase();
}

/** Distinct branch names across cases, case-insensitively, first spelling wins. */
export function distinctBranches(cases: Pick<CaseSummary, "branch">[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cases) {
    const b = cleanBranch(c.branch);
    if (b && !seen.has(b.toLowerCase())) seen.set(b.toLowerCase(), b);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
