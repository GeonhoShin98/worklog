-- Read-only audit. Review results in SQL Editor; do not publish result data.
-- Other public relations may expose data through views, policies or security-definer functions.
select table_schema,table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema in ('public','wl_private') and grantee in ('anon','authenticated','PUBLIC')
order by table_schema,table_name,grantee;
select table_schema,table_name,column_name,grantee,privilege_type
from information_schema.column_privileges
where table_schema in ('public','wl_private') and grantee in ('anon','authenticated','PUBLIC')
order by table_schema,table_name,column_name;
select n.nspname,p.proname,p.prosecdef,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','wl_private')
order by n.nspname,p.proname;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','wl_private');
select schemaname,viewname,definition from pg_views where schemaname='public';

