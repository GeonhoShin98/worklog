-- Preserve the old mold table while removing its public API access.
-- The current application uses wl_private.molds through service-only RPCs.
begin;
do $$
declare p record; c record;
begin
 if to_regclass('public.swmno') is not null then
  alter table public.swmno enable row level security;
  revoke all on public.swmno from public, anon, authenticated;
  for c in select column_name from information_schema.columns
   where table_schema='public' and table_name='swmno'
  loop
   execute format('revoke all (%I) on public.swmno from public, anon, authenticated',c.column_name);
  end loop;
  for p in select policyname from pg_policies where schemaname='public' and tablename='swmno'
  loop
   execute format('drop policy %I on public.swmno',p.policyname);
  end loop;
 end if;
end $$;
commit;
