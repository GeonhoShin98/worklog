begin;
alter table wl_private.employees add column if not exists role text not null default 'worker' check(role in ('worker','admin'));
alter table public.worklog add column if not exists entered_by uuid references auth.users(id);

create or replace function public.wl_session_profile(_session uuid,_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 e:=wl_private.worker(_session,_user,false);
 return jsonb_build_object('employee_no',e.employee_no,'name',e.name,'department',e.department,'team',e.team,'must_change_pin',e.must_change_pin,'role',e.role);
end $$;

create or replace function wl_private.manager(_session uuid,_user uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 e:=wl_private.worker(_session,_user);
 if e.role<>'admin' then raise exception using errcode='P1004'; end if;
end $$;

create or replace function public.wl_admin_employee(_number text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select jsonb_build_object('employee_no',employee_no,'user_id',user_id,'active',active,'must_change_pin',must_change_pin,'role',role) from wl_private.employees where employee_no=_number;
$$;

-- Server operator only. This operation is never exposed by an HTTP route.
create or replace function public.wl_admin_set_role(_number text,_role text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if _role not in ('worker','admin') or _role is null then raise exception using errcode='22023'; end if;
 update wl_private.employees set role=_role where employee_no=_number;
 if not found then raise exception using errcode='22023'; end if;
 delete from wl_private.sessions where user_id=(select user_id from wl_private.employees where employee_no=_number);
 insert into wl_private.audit(action,detail) values('operator_role_changed',_number||':'||_role);
end $$;

create or replace function public.wl_manager_employees(_session uuid,_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.manager(_session,_user);
 return (select coalesce(jsonb_agg(jsonb_build_object('employee_no',employee_no,'name',name,'department',department,'team',team,'active',active,'role',role,'must_change_pin',must_change_pin,'has_account',user_id is not null) order by department,team,name),'[]') from wl_private.employees);
end $$;

create or replace function public.wl_manager_options(_session uuid,_user uuid,_number text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; d jsonb;
begin
 perform wl_private.manager(_session,_user);
 select * into e from wl_private.employees where employee_no=_number and active and user_id is not null;
 if not found then raise exception using errcode='22023'; end if;
 select data into d from wl_private.catalog where id;
 if d->'categories'->e.department is null then raise exception using errcode='22023'; end if;
 return jsonb_build_object('categories',d->'categories'->e.department,'codes',d->'codes'->e.department,'classifications',d->'classifications','equipment',d->'equipment'->e.department);
end $$;

create or replace function wl_private.submit_as(_actor uuid,_user uuid,_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; d jsonb; t jsonb; n integer; idx integer:=0;
 sid uuid; wd date; total integer:=0; mins integer; mold text; m wl_private.molds;
 processes text[]; codes text[]; classes text[]; equipment text[]; allowed text[];
 category text; remark text; previous wl_private.batches;
begin
 select * into e from wl_private.employees where user_id=_user and active for share;
 if not found then raise exception using errcode='22023'; end if;
 if jsonb_typeof(_payload) is distinct from 'object' or
 exists(select 1 from jsonb_object_keys(_payload) k where k not in ('submission_id','date','tasks')) or
 jsonb_typeof(_payload->'tasks') is distinct from 'array' then raise exception using errcode='22023'; end if;
 n:=jsonb_array_length(_payload->'tasks');
 if n not between 1 and 10 or octet_length(_payload::text)>20000 then raise exception using errcode='22023'; end if;
 begin sid:=(_payload->>'submission_id')::uuid; wd:=(_payload->>'date')::date;
 exception when others then raise exception using errcode='22023'; end;
 if sid is null or wd is null or wd not between (now() at time zone 'Asia/Seoul')::date-31
 and (now() at time zone 'Asia/Seoul')::date+1 then raise exception using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_user::text||wd::text,0));
 perform pg_advisory_xact_lock(hashtextextended(sid::text,1));
 select * into previous from wl_private.batches where submission_id=sid;
 if found then
  if previous.user_id<>_user or previous.payload<>_payload then raise exception using errcode='P1003'; end if;
  return jsonb_build_object('accepted',n,'duplicate',true);
 end if;
 if exists(select 1 from public.worklog where submission_id=sid) then raise exception using errcode='P1003'; end if;
 select data into d from wl_private.catalog where id;
 if d is null or d->'categories'->e.department is null then raise exception using errcode='22023'; end if;
 for t in select value from jsonb_array_elements(_payload->'tasks') loop
  if jsonb_typeof(t) is distinct from 'object' or exists(select 1 from jsonb_object_keys(t) k where k not in
   ('mold','processes','cat','codes','classification','equipment','time','remark')) then raise exception using errcode='22023'; end if;
  category:=t->>'cat'; mold:=nullif(t->>'mold','');
  if category is null or not exists(select 1 from jsonb_array_elements(d->'categories'->e.department) v where v->>0=category)
   or (mold is null and category<>'H') then raise exception using errcode='22023'; end if;
  if mold is not null then
   if mold !~ '^[0-9]{5}$' then raise exception using errcode='22023'; end if;
   select * into m from wl_private.molds where number=mold;
   if not found then raise exception using errcode='22023'; end if;
  else m:=null; end if;
  processes:=wl_private.selection(t->'processes',array['1','2','3','4','5','6','7','8','9']);
  if mold is null and cardinality(processes)>0 then raise exception using errcode='22023'; end if;
  select coalesce(array_agg(v->>0),'{}') into allowed from jsonb_array_elements(d->'codes'->e.department) v
   where (category='H')=((v->>0)~'^[1-8]$');
  codes:=wl_private.selection(t->'codes',allowed,1);
  select array_agg(v->>0) into allowed from jsonb_array_elements(d->'classifications') v;
  classes:=wl_private.selection(t->'classification',allowed);
  select array_agg(v->>0) into allowed from jsonb_array_elements(d->'equipment'->e.department) v;
  equipment:=wl_private.selection(t->'equipment',allowed);
  if jsonb_typeof(t->'time') is distinct from 'number' or (t->>'time')!~'^[0-9]+$' then raise exception using errcode='22023'; end if;
  begin mins:=(t->>'time')::integer; exception when others then raise exception using errcode='22023'; end;
  if mins not between 10 and 1440 or mins%10<>0 then raise exception using errcode='22023'; end if;
  if jsonb_typeof(t->'remark') is distinct from 'string' or length(t->>'remark')>240 then raise exception using errcode='22023'; end if;
  remark:=concat(case when cardinality(classes)>0 then '[작업분류:'||array_to_string(classes,',')||'] ' else '' end,
    case when cardinality(equipment)>0 then '[장비구분:'||array_to_string(equipment,',')||'] ' else '' end,btrim(t->>'remark'));
  if length(remark)>300 then raise exception using errcode='22023'; end if;
  total:=total+mins; idx:=idx+1;
  insert into public.worklog(date,name,"Id",swmno,proc,car,part,cat,code,time,remark,submission_id,line_no,user_id,classification,equipment,entered_by)
  values(wd,e.name,e.employee_no::bigint,
   case when mold is null then null else mold||case when cardinality(processes)>0 then '-'||array_to_string(processes,',') else '' end end,
   nullif(array_to_string(processes,','),''),m.car,m.part,category,array_to_string(codes,','),mins,
   nullif(btrim(remark),''),sid,idx,_user,classes,equipment,_actor);
 end loop;
 if total>1440 or (select coalesce(sum(time),0) from public.worklog where user_id=_user and date=wd)>1440 then
  raise exception using errcode='22023',message='Daily minutes exceeded';
 end if;
 insert into wl_private.batches(user_id,submission_id,payload) values(_user,sid,_payload);
 if _actor<>_user then insert into wl_private.audit(action,user_id,detail) values('on_behalf_submit',_actor,jsonb_build_object('target',_user,'submission_id',sid,'tasks',n)::text); end if;
 return jsonb_build_object('accepted',n,'duplicate',false);
end $$;

create or replace function public.wl_submit(_session uuid,_user uuid,_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.worker(_session,_user);
 return wl_private.submit_as(_user,_user,_payload);
end $$;

create or replace function public.wl_manager_submit(_session uuid,_user uuid,_number text,_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
 perform wl_private.manager(_session,_user);
 select user_id into target from wl_private.employees where employee_no=_number and active;
 if target is null then raise exception using errcode='22023'; end if;
 return wl_private.submit_as(_user,target,_payload);
end $$;

create or replace function public.wl_manager_report(_session uuid,_user uuid,_from date,_to date,_number text default null,_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb; totals jsonb; n bigint;
begin
 perform wl_private.manager(_session,_user);
 if _from is null or _to is null or _to<_from or _to-_from>366 or _offset is null or _offset<0 or _offset>1000000 or (_number is not null and _number !~ '^[0-9]{9}$') then raise exception using errcode='22023'; end if;
 select count(*) into n from public.worklog w where w.date between _from and _to and (_number is null or lpad(w."Id"::text,9,'0')=_number);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
  select w.no,w.date,w.name,lpad(w."Id"::text,9,'0') as employee_no,e.department,e.team,w.swmno,w.car,w.part,w.cat,w.code,w.time,w.remark,w.classification,w.equipment,
   coalesce(a.name,case when w.user_id is null then '이전 자료' else w.name end) as entered_by_name
  from public.worklog w left join wl_private.employees e on e.user_id=w.user_id left join wl_private.employees a on a.user_id=w.entered_by
  where w.date between _from and _to and (_number is null or lpad(w."Id"::text,9,'0')=_number) order by w.date desc,w.no desc limit 200 offset _offset
 ) t;
 select coalesce(jsonb_agg(to_jsonb(t) order by work_date desc,employee_no),'[]') into totals from (
  select w.date as work_date,lpad(w."Id"::text,9,'0') as employee_no,w.name,sum(w.time)::bigint as total_minutes,count(*) as task_count from public.worklog w
  where w.date between _from and _to and (_number is null or lpad(w."Id"::text,9,'0')=_number) group by w.date,w."Id",w.name
 ) t;
 return jsonb_build_object('rows',rows,'summary',totals,'total',n,'offset',_offset);
end $$;

create or replace function public.wl_manager_save_employee(_session uuid,_user uuid,_row jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare old wl_private.employees; num text;
begin
 perform wl_private.manager(_session,_user);
 if jsonb_typeof(_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_row) k where k not in ('employee_no','name','department','team','active')) then raise exception using errcode='22023'; end if;
 num:=_row->>'employee_no';
 if num is null or num !~ '^[0-9]{9}$' or jsonb_typeof(_row->'name') is distinct from 'string' or length(btrim(_row->>'name')) not between 1 and 30 or
  (_row->>'department') not in ('사상반','기계반') or _row->>'department' is null or jsonb_typeof(_row->'team') is distinct from 'string' or length(btrim(_row->>'team')) not between 1 and 20 or jsonb_typeof(_row->'active') is distinct from 'boolean' then raise exception using errcode='22023'; end if;
 select * into old from wl_private.employees where employee_no=num for update;
 if old.role='admin' and (old.user_id<>_user or not (_row->>'active')::boolean) then raise exception using errcode='P1004'; end if;
 insert into wl_private.employees(employee_no,name,department,team,active) values(num,btrim(_row->>'name'),_row->>'department',btrim(_row->>'team'),(_row->>'active')::boolean)
 on conflict(employee_no) do update set name=excluded.name,department=excluded.department,team=excluded.team,active=excluded.active;
 -- Employee/department changes invalidate old open forms and sessions.
 if old.user_id is not null then delete from wl_private.sessions where user_id=old.user_id; end if;
 insert into wl_private.audit(action,user_id,detail) values('employee_updated',_user,num);
 return public.wl_admin_employee(num);
end $$;

create or replace function public.wl_manager_prepare_reset(_session uuid,_user uuid,_number text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 perform wl_private.manager(_session,_user);
 select * into e from wl_private.employees where employee_no=_number and active for update;
 if not found or e.role<>'worker' then raise exception using errcode='P1004'; end if;
 perform public.wl_admin_prepare_reset(_number);
 insert into wl_private.audit(action,user_id,detail) values('manager_password_reset',_user,_number);
 return jsonb_build_object('employee_no',e.employee_no,'user_id',e.user_id);
end $$;

create or replace function public.wl_manager_molds(_session uuid,_user uuid,_query text default '',_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb; n bigint;
begin
 perform wl_private.manager(_session,_user);
 if _query is null or length(_query)>120 or _offset is null or _offset<0 or _offset>1000000 then raise exception using errcode='22023'; end if;
 select count(*) into n from wl_private.molds where strpos(number,_query)>0 or strpos(lower(car),lower(_query))>0 or strpos(lower(part),lower(_query))>0;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (select number,car,part from wl_private.molds where strpos(number,_query)>0 or strpos(lower(car),lower(_query))>0 or strpos(lower(part),lower(_query))>0 order by number limit 100 offset _offset) t;
 return jsonb_build_object('rows',rows,'total',n,'offset',_offset);
end $$;

create or replace function public.wl_manager_save_mold(_session uuid,_user uuid,_row jsonb)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.manager(_session,_user);
 if jsonb_typeof(_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_row) k where k not in ('number','car','part')) or
  jsonb_typeof(_row->'number') is distinct from 'string' or (_row->>'number') !~ '^[0-9]{5}$' or
  jsonb_typeof(_row->'car') is distinct from 'string' or length(btrim(_row->>'car')) not between 1 and 120 or
  jsonb_typeof(_row->'part') is distinct from 'string' or length(btrim(_row->>'part')) not between 1 and 180 then raise exception using errcode='22023'; end if;
 perform public.wl_admin_import('molds',jsonb_build_array(_row));
 insert into wl_private.audit(action,user_id,detail) values('mold_updated',_user,_row->>'number');
end $$;

do $$ declare r record; begin
 for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid where (n.nspname='public' and left(p.proname,3)='wl_') or n.nspname='wl_private' loop
  execute format('revoke all on function %s from public, anon, authenticated',r.sig);
  execute format('grant execute on function %s to service_role',r.sig);
 end loop;
end $$;
revoke all on public.worklog from public,anon,authenticated;
revoke all (entered_by) on public.worklog from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
