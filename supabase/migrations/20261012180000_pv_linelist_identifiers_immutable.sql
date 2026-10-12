-- Identifier cells of a line list never change after upload — enforced by
-- the database, whoever writes.
--
-- Fix, Undo and Re-apply run in the browser, and the browser checks that no
-- automated correction touches the case ID, the patient record number or
-- the previous case ID. A browser check is only as good as the code that
-- runs it. This trigger makes the rule hold for every write to
-- pv_linelist_jobs: an update that changes any of those cells in the stored
-- original rows (data->rawRows) is rejected.
--
-- Which columns are identifiers is read from the job's own column mapping
-- (data->mapping: header -> field), so it works for any file layout. Jobs
-- without stored rows (made from cases) are not affected. No path in the
-- app legitimately changes these cells: Fix never touches them and Undo /
-- Re-apply only revert Fix's own changes.
--
-- NOT YET APPLIED. Apply with the Supabase SQL editor or `supabase db push`
-- by someone authorised for the production database. To check it after
-- applying (on a test job you own):
--   update pv_linelist_jobs
--      set data = jsonb_set(data, '{rawRows,0,<case-id header>}', '"X"')
--    where id = '<test job id>';
--   -- expect: ERROR  Line list <id>, row 1: identifier column ... cannot be changed

create or replace function public.pv_linelist_identifiers_immutable()
returns trigger
language plpgsql
as $$
declare
  header text;
  i int;
  n int;
begin
  if jsonb_typeof(old.data -> 'rawRows') is distinct from 'array'
     or jsonb_typeof(new.data -> 'rawRows') is distinct from 'array' then
    return new;
  end if;
  n := least(jsonb_array_length(old.data -> 'rawRows'), jsonb_array_length(new.data -> 'rawRows'));
  for header in
    select key
      from jsonb_each_text(coalesce(old.data -> 'mapping', '{}'::jsonb))
     where value in ('case_id', 'patient_id', 'previous_case_id')
  loop
    for i in 0 .. n - 1 loop
      if (old.data -> 'rawRows' -> i ->> header) is distinct from (new.data -> 'rawRows' -> i ->> header) then
        raise exception 'Line list %, row %: identifier column "%" cannot be changed (it was "%").',
          new.id, i + 1, header, old.data -> 'rawRows' -> i ->> header
          using errcode = 'check_violation';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_pv_linelist_identifiers_immutable on public.pv_linelist_jobs;
create trigger trg_pv_linelist_identifiers_immutable
  before update on public.pv_linelist_jobs
  for each row execute function public.pv_linelist_identifiers_immutable();
