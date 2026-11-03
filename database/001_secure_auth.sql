begin;

create table if not exists public.worklog (
  no bigint generated always as identity primary key,
  date date not null,
  name text not null,
  "Id" bigint not null,
  swmno text,
  proc text,
  car text,
  part text,
  cat text not null,
  code text not null,
  time bigint not null,
  remark text,
  submission_id uuid not null,
  line_no smallint not null,
  created_at timestamptz not null default now()
);

-- 기존 프로그램처럼 선택 공정과 청소·교육 등 비금형 작업을 저장할 수 있게 네 필드를 nullable로 맞춥니다.
alter table public.worklog
  alter column swmno drop not null,
  alter column proc drop not null,
  alter column car drop not null,
  alter column part drop not null;

-- 재전송 중복 방지와 실제 등록 시각을 위한 운영 컬럼입니다. 기존 행은 그대로 유지됩니다.
alter table public.worklog
  add column if not exists submission_id uuid,
  add column if not exists line_no smallint,
  add column if not exists created_at timestamptz;

alter table public.worklog
  alter column created_at set default now();

-- 기존 no 컬럼에 자동번호가 없으면 Identity를 추가합니다.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'worklog'
      and column_name = 'no'
      and is_identity = 'NO'
      and column_default is null
  ) then
    alter table public.worklog
      alter column no add generated always as identity;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'worklog'
      and column_name = 'no'
      and is_identity = 'YES'
      and identity_generation = 'BY DEFAULT'
  ) then
    alter table public.worklog
      alter column no set generated always;
  end if;
end
$$;

-- 설치 중 INSERT와 겹치지 않도록 잠근 뒤, 시퀀스를 절대 뒤로 돌리지 않고 맞춥니다.
lock table public.worklog in access exclusive mode;

do $$
declare
  sequence_name text;
  next_number bigint;
  sequence_value bigint;
begin
  sequence_name := pg_get_serial_sequence('public.worklog', 'no');
  if sequence_name is null then
    raise exception 'worklog.no 자동번호(Identity) 설정을 확인해 주세요.';
  end if;
  select greatest(coalesce(max(no), 0) + 1, 1)
    into next_number
    from public.worklog;
  execute format('select last_value from %s', sequence_name) into sequence_value;
  if next_number > sequence_value then
    perform setval(sequence_name, next_number, false);
  end if;
  execute format('revoke all on sequence %s from public, anon, authenticated', sequence_name);
end
$$;


-- All application-owned data is private. Only the server service role executes RPCs.
create schema if not exists wl_private;
revoke all on schema wl_private from public, anon, authenticated;
grant usage on schema wl_private to service_role;

create table if not exists wl_private.employees (
 employee_no text primary key check(employee_no ~ '^[0-9]{9}$'),
 user_id uuid unique references auth.users(id),
 name text not null check(length(name) between 1 and 30),
 department text not null, team text not null,
 active boolean not null default true,
 must_change_pin boolean not null default true
);
create table if not exists wl_private.molds (
 number text primary key check(number ~ '^[0-9]{5}$'),
 car text not null check(length(car) between 1 and 120),
 part text not null check(length(part) between 1 and 180)
);
create table if not exists wl_private.catalog (
 id boolean primary key default true check(id), data jsonb not null
);
create table if not exists wl_private.sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 expires_at timestamptz not null default now()+interval '8 hours'
);
create index if not exists wl_sessions_user on wl_private.sessions(user_id);
create table if not exists wl_private.limits (
 key text primary key, started timestamptz not null, count integer not null
);
create table if not exists wl_private.batches (
 user_id uuid not null references auth.users(id),
 submission_id uuid primary key, payload jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists wl_private.audit (
 no bigint generated always as identity primary key,
 at timestamptz not null default now(), action text not null,
 user_id uuid, detail text
);

alter table public.worklog add column if not exists user_id uuid references auth.users(id);
alter table public.worklog add column if not exists classification text[];
alter table public.worklog add column if not exists equipment text[];
create index if not exists worklog_user_date on public.worklog(user_id,date);
create unique index if not exists worklog_submission_line_uidx on public.worklog(submission_id,line_no);

-- Retire old anonymous functions; RESTRICT intentionally fails on unexpected dependencies.
drop function if exists public.submit_worklog_batch(jsonb);
drop function if exists public.get_worklog_summary(bigint,text,date,date);
alter table public.worklog enable row level security;
revoke all on public.worklog from public, anon, authenticated;
do $$
declare r record; c record;
begin
 for r in select policyname from pg_policies where schemaname='public' and tablename='worklog' loop
  execute format('drop policy %I on public.worklog',r.policyname);
 end loop;
 -- Column grants survive table-level REVOKE; revoke those too.
 for c in select column_name from information_schema.columns where table_schema='public' and table_name='worklog' loop
  execute format('revoke all (%I) on public.worklog from public, anon, authenticated',c.column_name);
 end loop;
 for r in select tablename from pg_tables where schemaname='wl_private' loop
  execute format('alter table wl_private.%I enable row level security',r.tablename);
  execute format('revoke all on wl_private.%I from public, anon, authenticated',r.tablename);
 end loop;
end $$;

create or replace function wl_private.worker(_session uuid,_user uuid,_ready boolean default true)
returns wl_private.employees language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 select * into e from wl_private.employees where user_id=_user and active;
 if not found or not exists(select 1 from wl_private.sessions where id=_session and user_id=_user and expires_at>now()) then
  raise exception using errcode='P1001',message='Authentication required';
 end if;
 if _ready and e.must_change_pin then raise exception using errcode='P1002',message='PIN required'; end if;
 return e;
end $$;

create or replace function public.wl_rate_limit(_key text,_limit integer)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
 if _key !~ '^[a-f0-9]{64}$' or _limit not between 1 and 1000 then raise exception using errcode='22023'; end if;
 delete from wl_private.limits where started<now()-interval '1 day';
 insert into wl_private.limits as l values(_key,now(),1)
 on conflict(key) do update set
 started=case when l.started<now()-interval '15 minutes' then now() else l.started end,
 count=case when l.started<now()-interval '15 minutes' then 1 else l.count+1 end
 returning count into n;
 return n<=_limit;
end $$;

create or replace function public.wl_open_session(_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; sid uuid;
begin
 select * into e from wl_private.employees where user_id=_user and active for update;
 if not found then raise exception using errcode='P1001'; end if;
 delete from wl_private.sessions where expires_at<=now();
 insert into wl_private.sessions(user_id) values(_user) returning id into sid;
 return jsonb_build_object('session_id',sid,'must_change_pin',e.must_change_pin);
end $$;

create or replace function public.wl_session_profile(_session uuid,_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees;
begin
 e:=wl_private.worker(_session,_user,false);
 return jsonb_build_object('employee_no',e.employee_no,'name',e.name,'department',e.department,'team',e.team,'must_change_pin',e.must_change_pin);
end $$;

create or replace function public.wl_close_session(_session uuid,_user uuid)
returns void language sql security definer set search_path=pg_catalog as $$
 delete from wl_private.sessions where id=_session and user_id=_user;
$$;

create or replace function public.wl_finish_pin_change(_session uuid,_user uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.worker(_session,_user,false);
 update wl_private.employees set must_change_pin=false where user_id=_user;
 delete from wl_private.sessions where user_id=_user;
 insert into wl_private.audit(action,user_id) values('pin_changed',_user);
end $$;

create or replace function public.wl_options(_session uuid,_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; d jsonb;
begin
 e:=wl_private.worker(_session,_user);
 select data into d from wl_private.catalog where id;
 if d->'categories'->e.department is null then raise exception using errcode='22023'; end if;
 return jsonb_build_object('categories',d->'categories'->e.department,'codes',d->'codes'->e.department,
 'classifications',d->'classifications','equipment',d->'equipment'->e.department);
end $$;

create or replace function public.wl_mold(_session uuid,_user uuid,_number text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.worker(_session,_user);
 if _number is null or _number !~ '^[0-9]{5}$' then raise exception using errcode='22023'; end if;
 return (select jsonb_build_object('car',car,'part',part) from wl_private.molds where number=_number);
end $$;

create or replace function public.wl_summary(_session uuid,_user uuid,_from date,_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform wl_private.worker(_session,_user);
 if _from is null or _to is null or _to<_from or _to-_from>366 then raise exception using errcode='22023'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by work_date desc),'[]') from
  (select date as work_date,sum(time)::bigint as total_minutes,count(*) as task_count
   from public.worklog where user_id=_user and date between _from and _to group by date) s);
end $$;

create or replace function wl_private.selection(_value jsonb,_allowed text[],_minimum integer default 0)
returns text[] language plpgsql set search_path=pg_catalog as $$
declare a text[];
begin
 if jsonb_typeof(_value) is distinct from 'array' or _allowed is null then raise exception using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(_value) v where jsonb_typeof(v)<>'string') then raise exception using errcode='22023'; end if;
 select coalesce(array_agg(v order by v),'{}') into a from jsonb_array_elements_text(_value) v;
 if cardinality(a)<_minimum or cardinality(a)>30 or not a<@_allowed or
 cardinality(a)<>(select count(distinct v) from unnest(a) v) then raise exception using errcode='22023'; end if;
 return a;
end $$;

create or replace function public.wl_submit(_session uuid,_user uuid,_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e wl_private.employees; d jsonb; t jsonb; n integer; idx integer:=0;
 sid uuid; wd date; total integer:=0; mins integer; mold text; m wl_private.molds;
 processes text[]; codes text[]; classes text[]; equipment text[]; allowed text[];
 category text; remark text; previous wl_private.batches;
begin
 e:=wl_private.worker(_session,_user);
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
  insert into public.worklog(date,name,"Id",swmno,proc,car,part,cat,code,time,remark,submission_id,line_no,user_id,classification,equipment)
  values(wd,e.name,e.employee_no::bigint,
   case when mold is null then null else mold||case when cardinality(processes)>0 then '-'||array_to_string(processes,',') else '' end end,
   nullif(array_to_string(processes,','),''),m.car,m.part,category,array_to_string(codes,','),mins,
   nullif(btrim(remark),''),sid,idx,_user,classes,equipment);
 end loop;
 if total>1440 or (select coalesce(sum(time),0) from public.worklog where user_id=_user and date=wd)>1440 then
  raise exception using errcode='22023',message='Daily minutes exceeded';
 end if;
 insert into wl_private.batches(user_id,submission_id,payload) values(_user,sid,_payload);
 return jsonb_build_object('accepted',n,'duplicate',false);
end $$;

-- Administrative RPCs are service-role only; never exposed as web routes.
create or replace function public.wl_admin_import(_kind text,_rows jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; n integer:=0;
begin
 if jsonb_typeof(_rows) is distinct from 'array' or jsonb_array_length(_rows)>500 then raise exception using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(_rows) loop
  if _kind='employees' then
   insert into wl_private.employees(employee_no,name,department,team)
   values(r->>'employee_no',r->>'name',r->>'department',r->>'team')
   on conflict(employee_no) do update set name=excluded.name,department=excluded.department,team=excluded.team;
  elsif _kind='molds' then
   insert into wl_private.molds(number,car,part) values(r->>'number',r->>'car',r->>'part')
   on conflict(number) do update set car=excluded.car,part=excluded.part;
  else raise exception using errcode='22023'; end if;
  n:=n+1;
 end loop;
 return n;
end $$;

create or replace function public.wl_admin_employee(_number text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select jsonb_build_object('employee_no',employee_no,'user_id',user_id,'active',active) from wl_private.employees where employee_no=_number;
$$;
create or replace function public.wl_admin_prepare_reset(_number text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid;
begin
 update wl_private.employees set active=false,must_change_pin=true where employee_no=_number returning user_id into uid;
 if not found then raise exception using errcode='22023'; end if;
 delete from wl_private.sessions where user_id=uid;
 insert into wl_private.audit(action,user_id,detail) values('admin_pin_reset_started',uid,_number);
end $$;
create or replace function public.wl_admin_bind(_number text,_user uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not exists(select 1 from auth.users where id=_user and email_confirmed_at is not null) then raise exception using errcode='22023'; end if;
 update wl_private.employees set user_id=_user,active=true,must_change_pin=true where employee_no=_number and (user_id is null or user_id=_user);
 if not found then raise exception using errcode='22023'; end if;
 delete from wl_private.sessions where user_id=_user;
 -- Historical rows remain unattributed until an administrator reviews them separately.
 insert into wl_private.audit(action,user_id,detail) values('admin_account_bound',_user,_number);
end $$;

insert into wl_private.catalog(id,data) values(true,'{"categories":{"사상반":[["B","초도"],["C","정규"],["D","ECO"],["E","ECR"],["F","생산지원"],["G","불량"],["H","기타"],["I","이관(출장)"]],"기계반":[["A","신작"],["C","수정"],["D","ECO"],["E","ECR"],["F","생산지원"],["G","불량"],["H","기타"]]},"classifications":[["1","상형"],["2","하형"],["3","B/H"],["4","PAD"],["5","CAM"]],"codes":{"사상반":[["F","사상"],["D","D/S"],["T","T/O"],["S","SAMPLE"],["B","핸드워크"],["C","출장이동"],["E","기술지원"],["P","도색"],["W","작업진행"],["1","청소"],["2","교육/회의"],["3","대기"],["4","훈련"],["5","외출"],["6","장비고장"],["7","공구제작"],["8","기타"]],"기계반":[["M","면삭"],["C","COPY"],["G","윤곽가공"],["X","무인가공"],["W","작업진행"],["O","SET''G"],["1","청소"],["2","교육/회의"],["3","대기"],["4","훈련"],["5","외출"],["6","장비고장"],["7","공구제작"],["8","기타"]]},"equipment":{"사상반":[["11","30Ton"],["12","50Ton"],["13","100Ton"],["14","200Ton"],["15","400Ton"],["16","600Ton"],["17","800Ton"],["18","1000Ton"],["19","1200Ton"],["20","1500Ton"],["21","2000Ton"]],"기계반":[["1","MCR-A5C"],["2","MCR-BII"],["3","MCR-BⅢ"],["4","MCR-BⅢ"],["5","RB-4VM"],["6","RB-4NM"],["7","MCR-A5C"],["8","MCR-A5CⅡ"],["9","MCR-A5CⅡ"],["10","MCR-A5C"]]}}'::jsonb) on conflict(id) do nothing;

-- Lock every app RPC (including future overloads) to the backend only.
do $$
declare r record;
begin
 for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid
 where (n.nspname='public' and left(p.proname,3)='wl_') or n.nspname='wl_private' loop
  execute format('revoke all on function %s from public, anon, authenticated',r.sig);
  execute format('grant execute on function %s to service_role',r.sig);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;

