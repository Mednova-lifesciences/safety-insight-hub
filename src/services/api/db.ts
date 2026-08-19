/**
 * Data access for MedNova PV Assist.
 *
 * All operational records live in the Lovable Cloud database. The service
 * modules in this folder keep the same shape the FastAPI layer will expose, so
 * swapping the transport later does not require UI changes.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AuditEvent, WorkflowStep, WorkflowStepState } from "@/types/pv";

const SESSION_KEY = "mednova.pv.session";

export interface ActorInfo {
  name: string;
  role: string;
}

export function currentActor(): ActorInfo {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw) {
      const u = JSON.parse(raw) as { name?: string; role?: string };
      return { name: u.name ?? "Unknown user", role: u.role ?? "UNKNOWN" };
    }
  } catch {
    /* ignore */
  }
  return { name: "Unknown user", role: "UNKNOWN" };
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function stepStates(
  current: WorkflowStep,
  overrides: Partial<Record<WorkflowStep, WorkflowStepState>> = {},
): Record<WorkflowStep, WorkflowStepState> {
  const order: WorkflowStep[] = [
    "INTAKE",
    "TRIAGE",
    "CODING",
    "REVIEW",
    "QC",
    "REGULATORY_READY",
    "CLOSED",
  ];
  const idx = order.indexOf(current);
  const out = {} as Record<WorkflowStep, WorkflowStepState>;
  order.forEach((s, i) => {
    out[s] = i < idx ? "COMPLETED" : i === idx ? "CURRENT" : "PENDING";
  });
  return { ...out, ...overrides };
}

/** Reads the `data` payload column of a jsonb-backed table. */
export async function selectData<T>(
  table: string,
  build: (q: ReturnType<typeof supabase.from>) => unknown = (q) => q,
): Promise<T[]> {
  void build;
  const { data, error } = await supabase.from(table).select("data");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { data: T }).data);
}

export async function recordAudit(event: {
  action: string;
  entity: string;
  entityId: string;
  previousValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
}): Promise<AuditEvent> {
  const actor = currentActor();
  const row: AuditEvent = {
    id: newId("ae"),
    timestamp: new Date().toISOString(),
    user: actor.name,
    role: actor.role,
    action: event.action,
    entity: event.entity,
    entityId: event.entityId,
    previousValue: event.previousValue ?? null,
    newValue: event.newValue ?? null,
    reason: event.reason ?? null,
  };
  const { error } = await supabase
    .from("pv_audit_events")
    .insert({ id: row.id, occurred_at: row.timestamp, data: row as never });
  if (error) throw new Error(error.message);
  return row;
}

export async function pushNotification(n: {
  type: string;
  title: string;
  body: string;
  link?: string;
}): Promise<void> {
  const row = {
    id: newId("nt"),
    type: n.type,
    title: n.title,
    body: n.body,
    at: new Date().toISOString(),
    read: false,
    ...(n.link ? { link: n.link } : {}),
  };
  await supabase.from("pv_notifications").insert({ id: row.id, data: row as never });
}
