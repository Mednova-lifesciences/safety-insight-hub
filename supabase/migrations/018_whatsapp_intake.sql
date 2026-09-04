-- Real WhatsApp (Termii) ICSR intake, per organization. Replaces the
-- purely client-side scripted demo at src/routes/_app/whatsapp-intake.tsx
-- with actual persistence, following the same org-isolated pv_* pattern
-- 006_pv_tables_org_isolation.sql established (set_pv_organization_id
-- trigger, org_isolation_* policies, no anon access).
--
-- pv_intake_conversations already exists (creation migration
-- 20260819002606_...) and already has organization_id + org-isolation
-- RLS from 006 — reused as-is for conversation-level state (its jsonb
-- `data` column), no schema change needed there.

-- One row per organization: its WhatsApp number (how an inbound Termii
-- webhook is routed to the right org) and its configurable intake rules.
create table if not exists public.pv_intake_settings (
  organization_id uuid primary key references public.organizations(id),
  whatsapp_number text unique,
  auto_respond_default boolean not null default true,
  required_questions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_set_org_id on public.pv_intake_settings;
create trigger trg_set_org_id before insert on public.pv_intake_settings
  for each row execute function public.set_pv_organization_id();

alter table public.pv_intake_settings enable row level security;

create policy "org_isolation_select" on public.pv_intake_settings
  for select to authenticated using (organization_id = public.current_org_id());
create policy "org_isolation_insert" on public.pv_intake_settings
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "org_isolation_update" on public.pv_intake_settings
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "org_isolation_delete" on public.pv_intake_settings
  for delete to authenticated using (organization_id = public.current_org_id());

-- One row per message. A real table (not a jsonb blob) so Realtime can
-- stream inserts to the review UI and concurrent webhook deliveries never
-- race on a single row's write.
create table if not exists public.pv_intake_messages (
  id text primary key,
  conversation_id text not null references public.pv_intake_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  direction text not null check (direction in ('INBOUND', 'OUTBOUND', 'SYSTEM')),
  sender text not null check (sender in ('REPORTER', 'AI', 'STAFF', 'SYSTEM')),
  staff_user_id uuid references public.profiles(id),
  body text not null,
  termii_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pv_intake_messages_conversation on public.pv_intake_messages(conversation_id);
create index if not exists idx_pv_intake_messages_org on public.pv_intake_messages(organization_id);

drop trigger if exists trg_set_org_id on public.pv_intake_messages;
create trigger trg_set_org_id before insert on public.pv_intake_messages
  for each row execute function public.set_pv_organization_id();

alter table public.pv_intake_messages enable row level security;

-- Authenticated staff can read/write their own org's messages (writing
-- covers a manual STAFF reply — see /api/whatsapp/send). The inbound
-- webhook itself writes via the backend's service-role key, which
-- bypasses RLS entirely, exactly like auth.py already does for
-- organizations/profiles — no anon policy exists on this table at all.
create policy "org_isolation_select" on public.pv_intake_messages
  for select to authenticated using (organization_id = public.current_org_id());
create policy "org_isolation_insert" on public.pv_intake_messages
  for insert to authenticated with check (organization_id = public.current_org_id());

alter publication supabase_realtime add table public.pv_intake_messages;

-- Used for the "text the manager/coordinator when a conversation is
-- ready for review" notification.
alter table public.profiles add column if not exists phone text;
