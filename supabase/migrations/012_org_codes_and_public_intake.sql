-- Multi-tenant org codes, a manager-owned drug catalog, and a genuinely
-- unauthenticated, per-company ICSR intake link for field associates.
--
-- Three things this adds:
--
-- 1. Organizations gain a public `slug` (safe to share — used in the field-
--    associate link .../r/<slug>) and a private `invite_code` (shown only
--    to the manager who created the org; a coordinator signs up with it to
--    join the same org instead of the old, insecure "match on name text"
--    behaviour, which handed every joiner ADMIN on whatever org already
--    had that name).
--
-- 2. `pv_products` — the drug catalog — created fresh, following the exact
--    same jsonb-blob-with-organization_id pattern and org-isolation RLS
--    that 006_pv_tables_org_isolation.sql established for every other
--    pv_* table.
--
-- 3. A narrow, deliberate re-opening of anon access that 006 revoked: this
--    app's field associates must be able to read one company's drug list
--    and file a case *without ever authenticating* (see 006's comment
--    "Anonymous, unauthenticated access is no longer permitted on
--    operational data" — that stands for every access pattern except this
--    one, explicitly product-required one). Anon gets exactly:
--      - SELECT on pv_products, scoped to a real organization_id
--        (read-only; the org id itself is already fully public via the
--        pre-existing `org_public_read` policy on `organizations`).
--      - INSERT on pv_cases and pv_audit_events, each `with check`-scoped
--        to a real organization_id, so a case can be filed and audited
--        without a session. Anon gets no SELECT/UPDATE/DELETE on either —
--        an anonymous reporter can create a record, never read or change
--        one back.

alter table organizations
  add column if not exists slug text,
  add column if not exists invite_code text;

update organizations
set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 6)
where slug is null;

update organizations
set invite_code = upper(substr(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 1, 4)) || '-' || upper(substr(id::text, 1, 6))
where invite_code is null;

alter table organizations
  alter column slug set not null,
  alter column invite_code set not null;

create unique index if not exists idx_organizations_slug on organizations(slug);
create unique index if not exists idx_organizations_invite_code on organizations(invite_code);

-- Drug catalog -----------------------------------------------------------

create table if not exists public.pv_products (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pv_products_org on public.pv_products(organization_id);

drop trigger if exists trg_set_org_id on public.pv_products;
create trigger trg_set_org_id before insert on public.pv_products
  for each row execute function public.set_pv_organization_id();

alter table public.pv_products enable row level security;

drop policy if exists "org_isolation_select" on public.pv_products;
create policy "org_isolation_select" on public.pv_products
  for select to authenticated using (organization_id = public.current_org_id());

drop policy if exists "org_isolation_insert" on public.pv_products;
create policy "org_isolation_insert" on public.pv_products
  for insert to authenticated with check (organization_id = public.current_org_id());

drop policy if exists "org_isolation_update" on public.pv_products;
create policy "org_isolation_update" on public.pv_products
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists "org_isolation_delete" on public.pv_products;
create policy "org_isolation_delete" on public.pv_products
  for delete to authenticated using (organization_id = public.current_org_id());

-- Public, read-only, scoped access to a single company's catalog for the
-- unauthenticated field-associate drug picker.
drop policy if exists "public_catalog_read" on public.pv_products;
create policy "public_catalog_read" on public.pv_products
  for select to anon
  using (organization_id in (select id from public.organizations));
grant select on public.pv_products to anon;

-- Public, write-only ICSR intake ------------------------------------------

drop policy if exists "public_field_associate_intake" on public.pv_cases;
create policy "public_field_associate_intake" on public.pv_cases
  for insert to anon
  with check (organization_id in (select id from public.organizations));
grant insert on public.pv_cases to anon;

drop policy if exists "public_field_associate_audit" on public.pv_audit_events;
create policy "public_field_associate_audit" on public.pv_audit_events
  for insert to anon
  with check (organization_id in (select id from public.organizations));
grant insert on public.pv_audit_events to anon;
