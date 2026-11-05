-- 2026-11-05: numeric passwords, reminder deferral, H selection and 5,000-minute limit.
-- Apply after 003_admin.sql. No employee, mold, password or historical work rows are replaced.
begin;
alter table wl_private.employees add column if not exists pin_reminder_after timestamptz;
alter table wl_private.sessions add column if not exists pin_change_deferred boolean not null default false;

create or replace function wl_private.pin_change_due(_session uuid,_user uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce((select e.must_change_pin and (e.pin_reminder_after is null or e.pin_reminder_after<=now())
  and not s.pin_change_deferred from wl_private.employees e join wl_private.sessions s on s.user_id=e.user_id
  where e.user_id=_user and s.id=_session),true);
$$;

create or replace function wl_private.worker(_session uuid,_user uuid,_ready boolean default true)
returns wl_private.employees language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 select * into e from wl_private.employees where user_id=_user and active;
 if not found or not exists(select 1 from wl_private.sessions where id=_session and user_id=_user and expires_at>now()) then
  raise exception using errcode='P1001',message='Authentication required';
 end if;
 if _ready and wl_private.pin_change_due(_session,_user) then raise exception using errcode='P1002',message='PIN required'; end if;
 return e;
end $$;

create or replace function public.wl_open_session(_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; sid uuid;
begin
 select * into e from wl_private.employees where user_id=_user and active for update;
 if not found then raise exception using errcode='P1001'; end if;
 delete from wl_private.sessions where expires_at<=now();
 insert into wl_private.sessions(user_id) values(_user) returning id into sid;
 return jsonb_build_object('session_id',sid,'must_change_pin',wl_private.pin_change_due(sid,_user));
end $$;

create or replace function public.wl_session_profile(_session uuid,_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 e:=wl_private.worker(_session,_user,false);
 return jsonb_build_object('employee_no',e.employee_no,'name',e.name,'department',e.department,'team',e.team,'must_change_pin',wl_private.pin_change_due(_session,_user),'initial_password',e.must_change_pin,'pin_reminder_after',e.pin_reminder_after,'role',e.role);
end $$;

create or replace function public.wl_defer_pin_change(_session uuid,_user uuid,_mode text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 perform wl_private.worker(_session,_user,false);
 select * into e from wl_private.employees where user_id=_user and active for update;
 if not found or not exists(select 1 from wl_private.sessions where id=_session and user_id=_user and expires_at>now()) then raise exception using errcode='P1001'; end if;
 if not e.must_change_pin or _mode is null or _mode not in ('next_login','30_days') then raise exception using errcode='22023'; end if;
 if _mode='30_days' then
  update wl_private.employees set pin_reminder_after=now()+interval '30 days' where user_id=_user;
 else
  update wl_private.sessions set pin_change_deferred=true where id=_session and user_id=_user;
 end if;
 insert into wl_private.audit(action,user_id,detail) values('pin_change_deferred',_user,_mode);
 return public.wl_session_profile(_session,_user);
end $$;

create or replace function public.wl_finish_pin_change(_session uuid,_user uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.worker(_session,_user,false);
 update wl_private.employees set must_change_pin=false,pin_reminder_after=null where user_id=_user;
 delete from wl_private.sessions where user_id=_user;
 insert into wl_private.audit(action,user_id) values('pin_changed',_user);
end $$;

create or replace function public.wl_admin_prepare_reset(_number text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid;
begin
 update wl_private.employees set active=false,must_change_pin=true,pin_reminder_after=null where employee_no=_number returning user_id into uid;
 if not found then raise exception using errcode='22023'; end if;
 delete from wl_private.sessions where user_id=uid;
 insert into wl_private.audit(action,user_id,detail) values('admin_pin_reset_started',uid,_number);
end $$;

create or replace function public.wl_admin_bind(_number text,_user uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not exists(select 1 from auth.users where id=_user and email_confirmed_at is not null) then raise exception using errcode='22023'; end if;
 update wl_private.employees set user_id=_user,active=true,must_change_pin=true,pin_reminder_after=null where employee_no=_number and (user_id is null or user_id=_user);
 if not found then raise exception using errcode='22023'; end if;
 delete from wl_private.sessions where user_id=_user;
 -- Historical rows remain unattributed until an administrator reviews them separately.
 insert into wl_private.audit(action,user_id,detail) values('admin_account_bound',_user,_number);
end $$;

-- H has a separate DB-managed catalog; the ordinary W label remains unchanged.
do $$
declare d jsonb; dept text; options jsonb;
begin
 select data into d from wl_private.catalog where id for update;
 if d is null then raise exception 'Work catalog missing'; end if;
 d:=jsonb_set(d,'{h_codes}',coalesce(d->'h_codes','{}'::jsonb));
 for dept in select jsonb_object_keys(d->'codes') loop
  select coalesce(jsonb_agg(v order by n),'[]'::jsonb) into options
   from jsonb_array_elements(d->'codes'->dept) with ordinality as item(v,n) where v->>0 ~ '^[1-8]$';
  d:=jsonb_set(d,array['h_codes',dept],options||jsonb_build_array(jsonb_build_array('W','작업지시')));
 end loop;
 update wl_private.catalog set data=d where id;
end $$;

create or replace function public.wl_options(_session uuid,_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; d jsonb;
begin
 e:=wl_private.worker(_session,_user);
 select data into d from wl_private.catalog where id;
 if d->'categories'->e.department is null then raise exception using errcode='22023'; end if;
 return jsonb_build_object('categories',d->'categories'->e.department,'codes',d->'codes'->e.department,'other_codes',d->'h_codes'->e.department,
 'classifications',d->'classifications','equipment',d->'equipment'->e.department);
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
 return jsonb_build_object('categories',d->'categories'->e.department,'codes',d->'codes'->e.department,'other_codes',d->'h_codes'->e.department,'classifications',d->'classifications','equipment',d->'equipment'->e.department);
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
 exists(select 1 from jsonb_object_keys(_payload) k where k not in ('submission_id','date','tasks','overtime_confirmed')) or
 jsonb_typeof(_payload->'tasks') is distinct from 'array' then raise exception using errcode='22023'; end if;
 if _payload ? 'overtime_confirmed' and jsonb_typeof(_payload->'overtime_confirmed') is distinct from 'boolean' then raise exception using errcode='22023'; end if;
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
  select coalesce(array_agg(v->>0),'{}') into allowed from jsonb_array_elements(case when category='H' then d->'h_codes'->e.department else d->'codes'->e.department end) v
   where category='H' or (v->>0)!~'^[1-8]$';
  codes:=wl_private.selection(t->'codes',allowed,1);
  select array_agg(v->>0) into allowed from jsonb_array_elements(d->'classifications') v;
  classes:=wl_private.selection(t->'classification',allowed);
  if category='H' and cardinality(classes)>0 then raise exception using errcode='22023'; end if;
  select array_agg(v->>0) into allowed from jsonb_array_elements(d->'equipment'->e.department) v;
  equipment:=wl_private.selection(t->'equipment',allowed);
  if jsonb_typeof(t->'time') is distinct from 'number' or (t->>'time')!~'^[0-9]+$' then raise exception using errcode='22023'; end if;
  begin mins:=(t->>'time')::integer; exception when others then raise exception using errcode='22023'; end;
  if mins not between 10 and 5000 or mins%10<>0 then raise exception using errcode='22023'; end if;
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
 if total>540 and (_payload->'overtime_confirmed') is distinct from 'true'::jsonb then
  raise exception using errcode='P1005',message='Overtime confirmation required';
 end if;
 insert into wl_private.batches(user_id,submission_id,payload) values(_user,sid,_payload);
 if _actor<>_user then insert into wl_private.audit(action,user_id,detail) values('on_behalf_submit',_actor,jsonb_build_object('target',_user,'submission_id',sid,'tasks',n)::text); end if;
 return jsonb_build_object('accepted',n,'duplicate',false);
end $$;

-- New RPCs are never callable by an anonymous or browser-authenticated DB role.
do $$
declare r record;
begin
 for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid
 where (n.nspname='public' and left(p.proname,3)='wl_') or n.nspname='wl_private' loop
  execute format('revoke all on function %s from public, anon, authenticated',r.sig);
  execute format('grant execute on function %s to service_role',r.sig);
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
