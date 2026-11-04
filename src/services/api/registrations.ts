import { supabase } from "@/integrations/supabase/client";
import { newId, recordAudit, toJson } from "./db";
import { daysBetween } from "./regulatory-clock";
import { isMissingTable } from "./branches";

/**
 * Register of NAFDAC product registrations (pv_registrations): number,
 * holder, validity, renewal, variations and commitments, with alerts ahead
 * of every deadline. A registration is valid for five years; NAFDAC advises
 * starting renewal within 90 days of expiry, so alerts start at 180 days.
 */

export interface Variation {
  id: string;
  description: string;
  submittedOn?: string | undefined;
  status: "PLANNED" | "SUBMITTED" | "APPROVED" | "REJECTED";
}

export interface Commitment {
  id: string;
  description: string;
  dueDate?: string | undefined;
  done: boolean;
}

export interface Registration {
  id: string;
  productName: string;
  /** Catalog drug this registration is for, when linked. */
  productId?: string | undefined;
  registrationNumber: string;
  holder?: string | undefined;
  issueDate?: string | undefined;
  expiryDate?: string | undefined;
  /** Renewal application filed (the alert stops; the expiry still shows). */
  renewalSubmittedOn?: string | undefined;
  status: "ACTIVE" | "WITHDRAWN";
  variations: Variation[];
  commitments: Commitment[];
  notes?: string | undefined;
}

export type RegistrationInput = Omit<Registration, "id">;

export class RegistrationsNotSetUpError extends Error {
  constructor() {
    super("The registration register has not been set up on this database yet.");
  }
}

function fromRow(row: { id: string; data: unknown }): Registration {
  const d = row.data as Partial<Registration>;
  return {
    productName: "",
    registrationNumber: "",
    status: "ACTIVE",
    ...d,
    id: row.id,
    variations: d.variations ?? [],
    commitments: d.commitments ?? [],
  };
}

const describe = (r: RegistrationInput) =>
  `${r.productName} ${r.registrationNumber}, expires ${r.expiryDate ?? "—"}${r.renewalSubmittedOn ? `, renewal filed ${r.renewalSubmittedOn}` : ""}`;

export const registrations = {
  list: async (): Promise<Registration[]> => {
    const { data, error } = await supabase.from("pv_registrations").select("id,data");
    if (isMissingTable(error)) throw new RegistrationsNotSetUpError();
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).sort((a, b) => a.productName.localeCompare(b.productName));
  },

  create: async (input: RegistrationInput): Promise<Registration> => {
    const id = newId("reg");
    const { error } = await supabase.from("pv_registrations").insert({ id, data: toJson(input) });
    if (isMissingTable(error)) throw new RegistrationsNotSetUpError();
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "REGISTRATION_CREATED",
      entity: "Registration",
      entityId: id,
      newValue: describe(input),
      reason: "Registration added to the register",
    });
    return { ...input, id };
  },

  update: async (
    id: string,
    before: Registration,
    input: RegistrationInput,
    reason = "Registration edited",
  ): Promise<Registration> => {
    const { error } = await supabase
      .from("pv_registrations")
      .update({ data: toJson(input) })
      .eq("id", id);
    if (isMissingTable(error)) throw new RegistrationsNotSetUpError();
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "REGISTRATION_UPDATED",
      entity: "Registration",
      entityId: id,
      previousValue: describe(before),
      newValue: describe(input),
      reason,
    });
    return { ...input, id };
  },
};

export const ALERT_DAYS = [180, 90, 30] as const;

export type AlertLevel = "EXPIRED" | "CRITICAL" | "WARNING" | "NOTICE";

export interface RegulatoryAlert {
  key: string;
  level: AlertLevel;
  registrationId: string;
  productName: string;
  title: string;
  /** ISO date the alert is about. */
  date: string;
  daysLeft: number;
}

function levelFor(daysLeft: number): AlertLevel | null {
  if (daysLeft < 0) return "EXPIRED";
  if (daysLeft <= 30) return "CRITICAL";
  if (daysLeft <= 90) return "WARNING";
  if (daysLeft <= 180) return "NOTICE";
  return null;
}

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Every alert for one registration as of `today`. */
export function registrationAlerts(r: Registration, today: string): RegulatoryAlert[] {
  if (r.status !== "ACTIVE") return [];
  const out: RegulatoryAlert[] = [];
  if (r.expiryDate && !r.renewalSubmittedOn) {
    const daysLeft = daysBetween(today, r.expiryDate);
    const level = daysLeft === undefined ? null : levelFor(daysLeft);
    if (level && daysLeft !== undefined) {
      out.push({
        key: `${r.id}:expiry`,
        level,
        registrationId: r.id,
        productName: r.productName,
        title:
          daysLeft < 0
            ? `Registration ${r.registrationNumber} expired ${plural(-daysLeft)} ago`
            : `Registration ${r.registrationNumber} expires in ${plural(daysLeft)} — file the renewal`,
        date: r.expiryDate,
        daysLeft,
      });
    }
  }
  for (const c of r.commitments) {
    if (c.done || !c.dueDate) continue;
    const daysLeft = daysBetween(today, c.dueDate);
    if (daysLeft === undefined || daysLeft > 30) continue;
    out.push({
      key: `${r.id}:commitment:${c.id}`,
      level: daysLeft < 0 ? "EXPIRED" : "CRITICAL",
      registrationId: r.id,
      productName: r.productName,
      title:
        daysLeft < 0
          ? `Commitment overdue by ${plural(-daysLeft)}: ${c.description}`
          : `Commitment due in ${plural(daysLeft)}: ${c.description}`,
      date: c.dueDate,
      daysLeft,
    });
  }
  return out;
}

const LEVEL_ORDER: Record<AlertLevel, number> = { EXPIRED: 0, CRITICAL: 1, WARNING: 2, NOTICE: 3 };

export function allAlerts(list: Registration[], today: string): RegulatoryAlert[] {
  return list
    .flatMap((r) => registrationAlerts(r, today))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.daysLeft - b.daysLeft);
}

export function validateRegistration(input: RegistrationInput): string[] {
  const problems: string[] = [];
  if (!input.productName.trim()) problems.push("Enter the product.");
  if (!input.registrationNumber.trim()) problems.push("Enter the NAFDAC registration number.");
  if (input.issueDate && input.expiryDate && input.expiryDate <= input.issueDate)
    problems.push("The expiry date must be after the issue date.");
  return problems;
}
