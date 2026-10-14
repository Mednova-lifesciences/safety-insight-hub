-- A line list's stored cells change only through the server.
--
-- Fix, Undo and Re-apply send their cell changes to the backend endpoint
-- POST /api/linelist/jobs/{id}/save-cells, which re-verifies every changed
-- cell (rules re-run, AI values derived, moves only rearranging values,
-- Undo returning the recorded value, identifiers untouched) and writes with
-- the service role. This trigger makes that the only way: an update from
-- any other role that changes the stored rows (data->rawRows) or the change
-- log (data->changeLog) is rejected. Everything else in the job — decisions,
-- counts, settings, the E2B state — keeps saving from the browser as before.
--
-- Uploads are inserts and are not affected. Jobs made from cases (no
-- rawRows) are not covered by this trigger; their cells are only changed by
-- the same server path in the app.
--
-- NOT YET APPLIED. Apply only with authorisation, AFTER the backend with
-- the save-cells endpoint is deployed (otherwise Fix and Undo would fail).
-- Check after applying (on a test job you own, as a signed-in user, not the
-- service role):
--   update pv_linelist_jobs set data = jsonb_set(data, '{rawRows,0,<a column>}', '"X"') where id = '<test job>';
--   -- expect: ERROR  Line list <id>: cells change only through the server
-- and run Fix once in the app: it must still save.

create or replace function public.pv_linelist_cells_server_only()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if (old.data -> 'rawRows') is distinct from (new.data -> 'rawRows')
     or (old.data -> 'changeLog') is distinct from (new.data -> 'changeLog') then
    raise exception 'Line list %: cells change only through the server (save-cells).', new.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pv_linelist_cells_server_only on public.pv_linelist_jobs;
create trigger trg_pv_linelist_cells_server_only
  before update on public.pv_linelist_jobs
  for each row execute function public.pv_linelist_cells_server_only();
