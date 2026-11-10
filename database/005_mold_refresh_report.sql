begin;

create or replace function public.wl_manager_replace_molds(_session uuid,_user uuid,_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare n integer; previous_count integer;
begin
 perform wl_private.manager(_session,_user);
 if jsonb_typeof(_rows) is distinct from 'array' or jsonb_array_length(_rows) not between 1 and 5000
    or octet_length(_rows::text)>1000000 then raise exception using errcode='22023'; end if;
 select count(*) into n from jsonb_array_elements(_rows) r
 where jsonb_typeof(r) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(r) k where k not in ('number','car','part'))
    or jsonb_typeof(r->'number') is distinct from 'string' or (r->>'number') !~ '^[0-9]{5}$'
    or jsonb_typeof(r->'car') is distinct from 'string' or length(btrim(r->>'car')) not between 1 and 120
    or jsonb_typeof(r->'part') is distinct from 'string' or length(btrim(r->>'part')) not between 1 and 180;
 if n>0 then raise exception using errcode='22023'; end if;
 if (select count(distinct r->>'number') from jsonb_array_elements(_rows) r)<>jsonb_array_length(_rows)
 then raise exception using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('wl_private.molds.replace',0));
 lock table wl_private.molds in access exclusive mode;
 select count(*) into previous_count from wl_private.molds;
 delete from wl_private.molds;
 insert into wl_private.molds(number,car,part)
 select r->>'number',btrim(r->>'car'),btrim(r->>'part') from jsonb_array_elements(_rows) r;
 insert into wl_private.audit(action,user_id,detail)
 values('molds_replaced',_user,jsonb_build_object('previous',previous_count,'new',jsonb_array_length(_rows))::text);
 return jsonb_build_object('previous',previous_count,'count',jsonb_array_length(_rows));
end $$;

create or replace function public.wl_manager_report_v2(_session uuid,_user uuid,_from date,_to date,_number text default null,_department text default null,_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb; totals jsonb; n bigint;
begin
 perform wl_private.manager(_session,_user);
 if _from is null or _to is null or _to<_from or _to-_from>366 or _offset is null or _offset<0 or _offset>1000000
    or (_number is not null and _number !~ '^[0-9]{9}$')
    or (_department is not null and _department not in ('사상반','기계반'))
 then raise exception using errcode='22023'; end if;
 select count(*) into n from public.worklog w left join wl_private.employees e on e.employee_no=lpad(w."Id"::text,9,'0')
 where w.date between _from and _to and (_number is null or lpad(w."Id"::text,9,'0')=_number)
 and (_department is null or e.department=_department);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
  select w.no,w.date,w.name,lpad(w."Id"::text,9,'0') as employee_no,e.department,e.team,w.swmno,w.proc,w.car,w.part,w.cat,w.code,w.time,w.remark,w.classification,w.equipment,
   coalesce(a.name,case when w.user_id is null then '이전 자료' else w.name end) as entered_by_name
  from public.worklog w left join wl_private.employees e on e.employee_no=lpad(w."Id"::text,9,'0')
  left join wl_private.employees a on a.user_id=w.entered_by
  where w.date between _from and _to and (_number is null or lpad(w."Id"::text,9,'0')=_number)
  and (_department is null or e.department=_department)
  order by w.date desc,w.no desc limit 200 offset _offset
 ) t;
 select coalesce(jsonb_agg(to_jsonb(t) order by work_date desc,employee_no),'[]') into totals from (
  select w.date as work_date,lpad(w."Id"::text,9,'0') as employee_no,w.name,sum(w.time)::bigint as total_minutes,count(*) as task_count
  from public.worklog w left join wl_private.employees e on e.employee_no=lpad(w."Id"::text,9,'0')
  where w.date between _from and _to and (_number is null or lpad(w."Id"::text,9,'0')=_number)
  and (_department is null or e.department=_department)
  group by w.date,w."Id",w.name
 ) t;
 return jsonb_build_object('rows',rows,'summary',totals,'total',n,'offset',_offset);
end $$;

revoke all on function public.wl_manager_replace_molds(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wl_manager_replace_molds(uuid,uuid,jsonb) to service_role;
revoke all on function public.wl_manager_report_v2(uuid,uuid,date,date,text,text,integer) from public,anon,authenticated;
grant execute on function public.wl_manager_report_v2(uuid,uuid,date,date,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
