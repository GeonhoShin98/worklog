-- Supabase SQL Editor에서 한 번 실행하세요.
-- 현재 모바일 화면은 로그인 없이 publishable key로 제한된 저장 함수만 호출합니다.
-- 외부 공개 URL에서는 스팸/위조 가능성이 있으므로, 운영 안정화 후 Supabase Auth 적용을 권장합니다.

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

-- 앱과 동일한 기본 유효성 검사를 DB에서도 적용합니다.
alter table public.worklog
  drop constraint if exists worklog_date_check,
  drop constraint if exists worklog_employee_id_check,
  drop constraint if exists worklog_swmno_check,
  drop constraint if exists worklog_proc_check,
  drop constraint if exists worklog_cat_check,
  drop constraint if exists worklog_code_check,
  drop constraint if exists worklog_time_check,
  drop constraint if exists worklog_text_length_check,
  drop constraint if exists worklog_submission_check;

alter table public.worklog
  add constraint worklog_date_check check (date is not null) not valid,
  add constraint worklog_employee_id_check check (
    "Id" is not null and "Id" between 100000000 and 999999999
  ) not valid,
  add constraint worklog_swmno_check check (
    (swmno is null and car is null and part is null)
    or (
      swmno is not null and swmno ~ '^[0-9]{5}(-[1-9](,[1-9])*)?$'
      and car is not null and char_length(btrim(car)) between 1 and 120
      and part is not null and char_length(btrim(part)) between 1 and 180
    )
  ) not valid,
  add constraint worklog_proc_check check (
    proc is null
    or (
      proc is not null and char_length(proc) <= 17
      and proc ~ '^[1-9](,[1-9])*$'
      and string_to_array(proc, ',') <@ array['1','2','3','4','5','6','7','8','9']::text[]
    )
  ) not valid,
  add constraint worklog_cat_check check (
    cat is not null and cat ~ '^[A-I]$'
  ) not valid,
  add constraint worklog_code_check check (
    code is not null and char_length(code) <= 33
    and code ~ '^[A-Z0-9](,[A-Z0-9])*$'
    and string_to_array(code, ',') <@ array[
      'B','C','D','E','F','G','M','O','P','S','T','W','X',
      '1','2','3','4','5','6','7','8'
    ]::text[]
  ) not valid,
  add constraint worklog_time_check check (
    time is not null and time between 1 and 1440
  ) not valid,
  add constraint worklog_text_length_check check (
    name is not null and char_length(btrim(name)) between 1 and 30
    and (remark is null or char_length(remark) <= 300)
  ) not valid,
  add constraint worklog_submission_check check (
    (submission_id is null and line_no is null)
    or (submission_id is not null and line_no is not null and line_no between 1 and 10)
  ) not valid;

create index if not exists worklog_date_employee_idx
  on public.worklog (date, "Id");

drop index if exists public.worklog_submission_line_uidx;
create unique index worklog_submission_line_uidx
  on public.worklog (submission_id, line_no);

alter table public.worklog enable row level security;

revoke all on table public.worklog from public;
revoke all on table public.worklog from anon;
revoke insert on table public.worklog from authenticated;
revoke insert (date, name, "Id", swmno, proc, car, part, cat, code, time, remark, submission_id, line_no)
  on public.worklog from anon, authenticated;

drop policy if exists "worklog_mobile_insert" on public.worklog;

create or replace function public.submit_worklog_batch(_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  item_count integer;
  submission_count integer;
  line_count integer;
  minimum_line integer;
  maximum_line integer;
  date_count integer;
  name_count integer;
  employee_count integer;
  total_minutes bigint;
  batch_submission_id uuid;
  existing_count integer;
  inserted_count integer;
begin
  if jsonb_typeof(_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = '작업 목록 형식이 올바르지 않습니다.';
  end if;

  item_count := jsonb_array_length(_rows);
  if item_count < 1 or item_count > 10 then
    raise exception using errcode = '22023', message = '작업은 한 번에 1~10건만 등록할 수 있습니다.';
  end if;

  select
    count(distinct (item ->> 'submission_id')::uuid),
    count(distinct (item ->> 'line_no')::integer),
    min((item ->> 'line_no')::integer),
    max((item ->> 'line_no')::integer),
    count(distinct (item ->> 'date')::date),
    count(distinct btrim(item ->> 'name')),
    count(distinct (item ->> 'Id')::bigint)
  into submission_count, line_count, minimum_line, maximum_line,
       date_count, name_count, employee_count
  from jsonb_array_elements(_rows) as entry(item);

  select (item ->> 'submission_id')::uuid
    into batch_submission_id
    from jsonb_array_elements(_rows) as entry(item)
    limit 1;

  if submission_count <> 1
     or line_count <> item_count
     or minimum_line <> 1
     or maximum_line <> item_count
     or date_count <> 1
     or name_count <> 1
     or employee_count <> 1 then
    raise exception using errcode = '22023', message = '제출 번호 또는 작업 순번이 올바르지 않습니다.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(_rows) as entry(item)
    where (item ->> 'date') is null
       or (item ->> 'date')::date not between ((now() at time zone 'Asia/Seoul')::date - 31)
                                          and ((now() at time zone 'Asia/Seoul')::date + 1)
  ) then
    raise exception using errcode = '22023', message = '작업일자 범위를 확인해 주세요.';
  end if;

  select coalesce(sum((item ->> 'time')::bigint), 0)
    into total_minutes
    from jsonb_array_elements(_rows) as entry(item);
  if total_minutes > 1440 then
    raise exception using errcode = '22023', message = '이번 등록의 총 작업시간은 1,440분을 넘을 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(batch_submission_id::text, 0));

  select count(*)
    into existing_count
    from public.worklog
    where submission_id = batch_submission_id;

  if existing_count not in (0, item_count) then
    raise exception using errcode = 'P0001', message = '같은 제출 번호의 작업 수가 달라 재등록을 중단했습니다.';
  end if;

  if existing_count > 0 and exists (
    select 1
    from public.worklog as existing
    where existing.submission_id = batch_submission_id
      and not exists (
        select 1
        from jsonb_array_elements(_rows) as entry(item)
        where existing.line_no is not distinct from (item ->> 'line_no')::smallint
          and existing.date is not distinct from (item ->> 'date')::date
          and existing.name is not distinct from btrim(item ->> 'name')
          and existing."Id" is not distinct from (item ->> 'Id')::bigint
          and existing.swmno is not distinct from nullif(btrim(item ->> 'swmno'), '')
          and existing.proc is not distinct from nullif(btrim(item ->> 'proc'), '')
          and existing.car is not distinct from nullif(btrim(item ->> 'car'), '')
          and existing.part is not distinct from nullif(btrim(item ->> 'part'), '')
          and existing.cat is not distinct from nullif(btrim(item ->> 'cat'), '')
          and existing.code is not distinct from nullif(btrim(item ->> 'code'), '')
          and existing.time is not distinct from (item ->> 'time')::bigint
          and existing.remark is not distinct from nullif(btrim(item ->> 'remark'), '')
      )
  ) then
    raise exception using errcode = 'P0001', message = '이미 처리된 제출과 내용이 달라 재등록을 중단했습니다.';
  end if;

  insert into public.worklog (
    date, name, "Id", swmno, proc, car, part, cat, code, time, remark, submission_id, line_no
  )
  select
    (item ->> 'date')::date,
    btrim(item ->> 'name'),
    (item ->> 'Id')::bigint,
    nullif(btrim(item ->> 'swmno'), ''),
    nullif(btrim(item ->> 'proc'), ''),
    nullif(btrim(item ->> 'car'), ''),
    nullif(btrim(item ->> 'part'), ''),
    nullif(btrim(item ->> 'cat'), ''),
    nullif(btrim(item ->> 'code'), ''),
    (item ->> 'time')::bigint,
    nullif(btrim(item ->> 'remark'), ''),
    (item ->> 'submission_id')::uuid,
    (item ->> 'line_no')::smallint
  from jsonb_array_elements(_rows) as entry(item)
  on conflict (submission_id, line_no) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count not in (0, item_count) then
    raise exception using errcode = 'P0001', message = '동시에 처리된 작업과 충돌하여 등록을 중단했습니다.';
  end if;
  return jsonb_build_object(
    'accepted', item_count,
    'inserted', inserted_count,
    'duplicate', inserted_count = 0
  );
end;
$$;

revoke all on function public.submit_worklog_batch(jsonb) from public;
grant execute on function public.submit_worklog_batch(jsonb) to anon, authenticated;

-- 작업자가 본인의 일별·월별 근무시간 합계를 조회하는 제한된 함수입니다.
-- 원본 작업 행은 공개하지 않고 날짜별 합계와 작업 건수만 반환합니다.
create or replace function public.get_worklog_summary(
  _employee_id bigint,
  _employee_name text,
  _date_from date,
  _date_to date
)
returns table (
  work_date date,
  total_minutes bigint,
  task_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if _employee_id not between 100000000 and 999999999
     or _employee_name is null
     or char_length(btrim(_employee_name)) not between 1 and 30 then
    raise exception using errcode = '22023', message = '작업자 정보를 확인해 주세요.';
  end if;

  if _date_from is null
     or _date_to is null
     or _date_from > _date_to
     or (_date_to - _date_from) > 366 then
    raise exception using errcode = '22023', message = '조회 기간을 확인해 주세요.';
  end if;

  return query
  select
    entry.date as work_date,
    coalesce(sum(entry.time), 0)::bigint as total_minutes,
    count(*)::bigint as task_count
  from public.worklog as entry
  where entry."Id" = _employee_id
    and entry.name = btrim(_employee_name)
    and entry.date between _date_from and _date_to
  group by entry.date
  order by entry.date desc;
end;
$$;

revoke all on function public.get_worklog_summary(bigint, text, date, date) from public;
grant execute on function public.get_worklog_summary(bigint, text, date, date) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
