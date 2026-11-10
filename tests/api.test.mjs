import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {createHandler} from "../netlify/functions/api.mjs";
import {fixture,event,env,getCookie,task,U1,U2,EMP1,EMP2,INITIAL,PERSONAL} from "./fixture.mjs";
test("migration preserves old rows, auto-numbering, revokes legacy column grants and RPCs",async()=>{
 const {PGlite}=await import("@electric-sql/pglite");
 const db=new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);");
 await db.exec('create table public.worklog(no bigint primary key,date date,name text,"Id" bigint,swmno text,proc text,car text,part text,cat text,code text,time bigint,remark text);');
 await db.exec("insert into public.worklog(no,date,name,\"Id\",cat,code,time) values(123,current_date,'과거작업자',100000001,'H','1',30); grant select(name),insert(name),update(name) on public.worklog to anon,authenticated;");
 await db.exec("create function public.submit_worklog_batch(jsonb) returns jsonb language sql as 'select null::jsonb'; grant execute on function public.submit_worklog_batch(jsonb) to anon;");
 await db.exec(await readFile(new URL("../database/001_secure_auth.sql",import.meta.url),"utf8"));
 assert.equal((await db.query("select no,user_id from public.worklog")).rows[0].no,123);
 assert.equal((await db.query("select user_id from public.worklog")).rows[0].user_id,null);
 await db.exec("set role anon");
 await assert.rejects(db.exec("select name from public.worklog"));
 await assert.rejects(db.exec("select public.submit_worklog_batch('[]'::jsonb)"));
 await db.exec("reset role");
 const seq=(await db.query("select pg_get_serial_sequence('public.worklog','no') s")).rows[0].s;
 const next=(await db.query("select nextval($1)::int n",[seq])).rows[0].n;
 assert.ok(next>123);
 await db.close();
});

test('administrator access, delegated author, account management and alphanumeric password policy',async t=>{
 const f=await fixture(),api=createHandler({env,request:f.request});
 const send=(action,data,cookie='')=>api(event(action,data,cookie));
 try {
  await f.db.query("update wl_private.employees set must_change_pin=false where user_id=$1",[U1]);
  f.passwords.set(U1,PERSONAL);
  const worker=getCookie(await send('login',{employee_no:EMP1,pin:PERSONAL}));
  const routes=['admin-employees','admin-report','admin-options','admin-submit','admin-molds','admin-mold-save','admin-mold-replace','admin-employee-save','admin-reset'];
  for(const action of routes)assert.equal((await send(action,{},worker)).statusCode,403,action);
  await f.rpc('wl_admin_set_role',{_number:EMP2,_role:'admin'});
  let admin=getCookie(await send('login',{employee_no:EMP2,pin:PERSONAL}));
  const sid=(await f.db.query('select id from wl_private.sessions where user_id=$1',[U2])).rows[0].id;
  const identity={_session:sid,_user:U2};
  assert.equal(JSON.parse((await send('me',{},admin)).body).role,'admin');
  for(const role of ['anon','authenticated']) {await f.db.exec('set role '+role);await assert.rejects(f.rpc('wl_manager_employees',identity));await assert.rejects(f.rpc('wl_admin_set_role',{_number:EMP1,_role:'admin'}));await f.db.exec('reset role');}
  const emps=JSON.parse((await send('admin-employees',{},admin)).body);assert.equal(emps.length,2);assert.ok(emps.every(e=>!('password' in e)&&!('pin' in e)));
  const today=(await f.db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
  const payload={submission_id:randomUUID(),date:today,tasks:[task()]};
  await f.db.query('update wl_private.employees set must_change_pin=true where user_id=$1',[U1]);
  assert.equal((await send('submit',payload,worker)).statusCode,403);
  assert.equal((await send('admin-submit',{employee_no:EMP1,payload},admin)).statusCode,200);
  assert.equal(JSON.parse((await send('admin-submit',{employee_no:EMP1,payload},admin)).body).duplicate,true);
  const work=(await f.db.query('select * from public.worklog')).rows[0];assert.equal(work.user_id,U1);assert.equal(work.entered_by,U2);assert.equal(work.name,'테스트작업자');assert.equal(work.car,'TEST CAR');
  const report=JSON.parse((await send('admin-report',{from:today,to:today,employee_no:EMP1},admin)).body);assert.equal(report.total,1);assert.equal(report.summary[0].total_minutes,30);assert.equal(report.rows[0].entered_by_name,'다른작업자');
  assert.equal(JSON.parse((await send('admin-report',{from:today,department:'사상반'},admin)).body).total,1);
  assert.equal(JSON.parse((await send('admin-report',{from:today,department:'기계반'},admin)).body).total,0);
  assert.equal((await send('admin-report',{from:today,department:'관리부'},admin)).statusCode,400);
  assert.equal((await send('admin-submit',{employee_no:EMP1,payload:{...payload,submission_id:randomUUID(),name:'FORGED'}},admin)).statusCode,400);
  const saved={employee_no:EMP1,name:'변경직원',department:'사상반',team:'A',active:true};
  assert.equal((await send('admin-employee-save',{row:{...saved,role:'admin'}},admin)).statusCode,400);
  assert.equal((await send('admin-employee-save',{row:saved},admin)).statusCode,200);
  assert.equal((await send('me',{},worker)).statusCode,401);
  assert.equal((await send('admin-employee-save',{row:{...saved,employee_no:EMP2,active:false}},admin)).statusCode,403);
  assert.equal((await send('admin-reset',{employee_no:EMP1,current_password:'incorrect8'},admin)).statusCode,400);
  assert.equal((await send('admin-reset',{employee_no:EMP2,current_password:PERSONAL},admin)).statusCode,403);
  assert.equal((await send('admin-reset',{employee_no:EMP1,current_password:PERSONAL},admin)).statusCode,200);
  const reset=getCookie(await send('login',{employee_no:EMP1,pin:EMP1}));
  assert.equal(JSON.parse((await send('me',{},reset)).body).must_change_pin,true);
  for(const invalid of ['1234567',EMP1,'OnlyLetters','bad!1234','한글Test12','a'.repeat(32)+'1'])assert.equal((await send('pin',{current_pin:EMP1,new_pin:invalid},reset)).statusCode,400);
  assert.equal((await send('pin',{current_pin:EMP1,new_pin:'NewWorker123'},reset)).statusCode,200);
  assert.equal((await send('login',{employee_no:EMP1,pin:'NewWorker123'})).statusCode,200);
  assert.equal((await send('login',{employee_no:EMP1,pin:'NewWorker123!'})).statusCode,401);
  assert.equal((await send('admin-employee-save',{row:{...saved,employee_no:'100000003'}},admin)).statusCode,200);
  assert.equal((await send('login',{employee_no:'100000003',pin:'100000003'})).statusCode,200);
  assert.equal((await send('admin-mold-save',{row:{number:'99002',car:'CAR2',part:'PART2'}},admin)).statusCode,200);
  assert.equal(JSON.parse((await send('admin-molds',{query:'CAR2'},admin)).body).rows.length,1);
  const fresh=[{number:'26026',car:'SX3 EV',part:'PNL UPR COVER'},{number:'26020',car:'AI4',part:'RING SUNROOF REINF'}];
  assert.equal((await send('admin-mold-replace',{rows:[...fresh,{number:'bad',car:'X',part:'Y'}]},admin)).statusCode,400);
  assert.equal((await f.db.query('select count(*)::int n from wl_private.molds')).rows[0].n,2);
  const replaced=JSON.parse((await send('admin-mold-replace',{rows:fresh},admin)).body);
  assert.equal(replaced.previous,2);assert.equal(replaced.count,2);
  assert.deepEqual((await f.db.query('select number from wl_private.molds order by number')).rows.map(r=>r.number),['26020','26026']);
  assert.equal((await f.db.query('select car from public.worklog')).rows[0].car,'TEST CAR');
  assert.equal((await send('admin-mold-replace',{rows:[...fresh,fresh[0]]},admin)).statusCode,400);
  assert.equal((await f.db.query('select count(*)::int n from wl_private.molds')).rows[0].n,2);
  assert.equal((await send('admin-mold-save',{row:{number:'26030',car:'NEW',part:'NEW PART'}},admin)).statusCode,200);
  assert.equal((await f.db.query('select count(*)::int n from wl_private.molds')).rows[0].n,3);
  assert.equal(JSON.parse((await send('admin-molds',{query:'\' OR true --'},admin)).body).rows.length,0);
  assert.equal((await f.db.query("select count(*)::int n from wl_private.audit where action='on_behalf_submit'")).rows[0].n,1);
  await f.db.query('update wl_private.employees set active=false where user_id=$1',[U1]);
  assert.equal((await send('admin-submit',{employee_no:EMP1,payload:{...payload,submission_id:randomUUID()}},admin)).statusCode,400);
 } finally {await f.db.close();}
});

test("legacy mold rows survive while table, column grants and policies are removed",async()=>{
 const {PGlite}=await import("@electric-sql/pglite");
 const db=new PGlite();
 await db.exec("create role anon; create role authenticated; create table public.swmno(swmno text,car text,part text); insert into public.swmno values('99001-1','TEST','PART'); grant all on public.swmno to anon,authenticated; grant select(car) on public.swmno to anon; alter table public.swmno enable row level security; create policy old_public_read on public.swmno for select to anon using(true);");
 const migration=await readFile(new URL("../database/002_legacy_mold_access.sql",import.meta.url),"utf8");
 await db.exec(migration); await db.exec(migration);
 for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await assert.rejects(db.exec('select car from public.swmno'));
  await db.exec('reset role');
 }
 assert.equal((await db.query('select count(*)::int n from public.swmno')).rows[0].n,1);
 await db.close();
});

test("DB permissions + real PostgreSQL validation + HTTP auth lifecycle",async t=>{
 const f=await fixture(), api=createHandler({env,request:f.request});
 let c1,c2,identity;
 const send=(name,data={},cookie=c1,extra={})=>api(event(name,data,cookie,extra));
 const today=(await f.db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
 const batch=()=>({submission_id:randomUUID(),date:today,tasks:[task()]});
 await t.test("anonymous roles cannot read any private master, worklog, or RPC",async()=>{
  for(const role of ["anon","authenticated"]) {
   await f.db.exec("set role "+role);
   for(const sql of ["select * from public.worklog","select * from wl_private.employees","select * from wl_private.molds",
      "select public.wl_open_session('"+U1+"')","select public.wl_admin_bind('"+EMP1+"','"+U1+"')"]) {
     await assert.rejects(f.db.exec(sql));
   }
   await f.db.exec("reset role");
  }
  const old=await f.db.query("select proname from pg_proc where proname in ('submit_worklog_batch','get_worklog_summary')");
  assert.equal(old.rows.length,0);
 });
 await t.test("unauthenticated API, CSRF, malformed data fail closed",async()=>{
  for(const action of ["me","mold","options","summary","submit","pin","pin-defer"]) assert.equal((await send(action,{}, "")).statusCode,401);
  assert.equal((await send("login",{employee_no:EMP1,pin:INITIAL},"",{origin:"https://evil.example"})).statusCode,403);
  assert.equal((await send("login",{},"",{"sec-fetch-site":"cross-site"})).statusCode,403);
  assert.equal((await api({...event("login"),body:"{"})).statusCode,400);
  assert.equal((await api({...event("login"),httpMethod:"GET"})).statusCode,405);
  assert.equal((await api({...event("login"),body:"x".repeat(20001)})).statusCode,413);
  assert.equal((await send("login",{employee_no:EMP1,pin:"00000000"})).statusCode,401);
 });
 await t.test("temporary PIN cannot read master or work data",async()=>{
  const res=await send("login",{employee_no:EMP1,pin:INITIAL},""); assert.equal(res.statusCode,200);
  c1=getCookie(res);
  assert.match(res.headers["Set-Cookie"],/Secure; HttpOnly; SameSite=Strict/);
  assert.ok(!c1.includes("access-") && !c1.includes(INITIAL));
  assert.equal(JSON.parse(res.body).must_change_pin,true);
  const me=JSON.parse((await send("me")).body);assert.equal(me.employee_no,EMP1);
  for(const action of ["options","mold","submit","summary"]) {
   const res=await send(action);assert.equal(res.statusCode,403);assert.equal(JSON.parse(res.body).code,"PIN_REQUIRED");
  }
  const sid=(await f.db.query("select id from wl_private.sessions where user_id=$1",[U1])).rows[0].id;
  await assert.rejects(f.rpc("wl_mold",{_session:sid,_user:U1,_number:"99001"}),/PIN required/);
 });
 await t.test("PIN change verifies current PIN, ends old sessions, requires new PIN",async()=>{
  assert.equal((await send("pin",{current_pin:"00000000",new_pin:PERSONAL})).statusCode,400);
  assert.equal((await send("pin",{current_pin:INITIAL,new_pin:INITIAL})).statusCode,400);
  assert.equal((await send("pin",{current_pin:INITIAL,new_pin:PERSONAL})).statusCode,200);
  assert.equal((await send("me")).statusCode,401);
  const res=await send("login",{employee_no:EMP1,pin:PERSONAL},"");c1=getCookie(res);
  assert.equal(JSON.parse(res.body).must_change_pin,false);
  const r2=await send("login",{employee_no:EMP2,pin:PERSONAL},"");c2=getCookie(r2);
  identity={_session:(await f.db.query("select id from wl_private.sessions where user_id=$1",[U1])).rows[0].id,_user:U1};
 });
 await t.test("profile is self-only, exact mold lookup, text is not interpolated into HTML",async()=>{
  const me=JSON.parse((await send("me",{employee_no:EMP2})).body);assert.equal(me.employee_no,EMP1);
  assert.deepEqual(JSON.parse((await send("mold",{number:"99001"})).body),{car:"TEST CAR",part:"TEST PART"});
  assert.equal((await send("mold",{number:"99001 or 1=1"})).statusCode,400);
  assert.equal(JSON.parse((await send("mold",{number:"99002"})).body),null);
  assert.ok(JSON.parse((await send("options")).body).categories.length);
 });
 await t.test("canonical author/mold and atomic idempotent submit",async()=>{
  const data=batch();data.tasks[0].remark='<img src=x onerror="alert(1)">';
  assert.equal((await send("submit",data)).statusCode,200);
  assert.equal(JSON.parse((await send("submit",data)).body).duplicate,true);
  const row=(await f.db.query("select * from public.worklog")).rows[0];
  assert.equal(row.name,"테스트작업자");assert.equal(row.user_id,U1);assert.equal(row.swmno,"99001-1,2");
  assert.equal(row.car,"TEST CAR");
  const mismatch=structuredClone(data);mismatch.tasks[0].time=40;
  assert.equal((await send("submit",mismatch)).statusCode,409);
  const other=await send("summary",{from:today,to:today},c2);assert.deepEqual(JSON.parse(other.body),[]);
  assert.equal(JSON.parse((await send("summary",{from:today,to:today})).body)[0].total_minutes,30);
 });
 await t.test("spoofed worker/car fields, invalid codes, missing data, duplicate processes rejected",async()=>{
  for(const mutate of [
    b=>b.name="victim",b=>b.tasks[0].car="FORGED",b=>b.tasks[0].cat="Z",
    b=>b.tasks[0].codes=["1"],b=>b.tasks[0].processes=["1","1"],
    b=>b.tasks[0].equipment=["999"],b=>b.tasks[0].classification=["99"],
    b=>b.tasks[0].time=1,b=>b.tasks[0].time=null,b=>b.tasks[0].mold="00000",
    b=>delete b.tasks[0].processes,b=>b.tasks[0].remark="x".repeat(241),
    b=>b.tasks.push({...task(),cat:"Z"})
  ]) {
    const data=batch();mutate(data);assert.equal((await send("submit",data)).statusCode,400,JSON.stringify(data));
  }
  assert.equal((await f.db.query("select count(*)::int n from public.worklog")).rows[0].n,1);
 });
 await t.test("H permits W and numeric codes, disallows classification; 5000-minute limit and overtime acknowledgement",async()=>{
   const h={...task(),mold:null,processes:[],cat:"H",codes:["W","1"],time:5000};
   const data={...batch(),tasks:[h],overtime_confirmed:true};
   assert.equal((await send("submit",data)).statusCode,200);
   assert.equal(JSON.parse((await send("submit",data)).body).duplicate,true);
   assert.equal((await send("submit",{...batch(),tasks:[{...h,time:5010}],overtime_confirmed:true})).statusCode,400);
   assert.equal((await send("submit",{...batch(),tasks:[{...h,time:10,classification:["1"]}]})).statusCode,400);
   assert.equal((await send("submit",{...batch(),tasks:[{...h,time:10,codes:["F"]}]})).statusCode,400);
   assert.equal((await send("submit",{...batch(),tasks:[{...h,time:540}]})).statusCode,200);
   for(const confirmation of [undefined,false,"true",1]) {
    const b={...batch(),tasks:[{...h,time:550}]};if(confirmation!==undefined)b.overtime_confirmed=confirmation;
    assert.equal((await send("submit",b)).statusCode,typeof confirmation==='string'||typeof confirmation==='number'?400:409);
   }
   const rejected={...batch(),tasks:[{...h,time:270},{...h,time:280}]};
   const response=await send("submit",rejected);assert.equal(response.statusCode,409);assert.equal(JSON.parse(response.body).code,"OVERTIME_CONFIRMATION_REQUIRED");
   assert.equal((await f.db.query("select count(*)::int n from public.worklog where submission_id=$1",[rejected.submission_id])).rows[0].n,0);
   assert.equal((await send("submit",{...rejected,overtime_confirmed:true})).statusCode,200);
   assert.equal((await send("submit",{...batch(),tasks:Array.from({length:10},()=>({...h})),overtime_confirmed:true})).statusCode,200);
   assert.equal((await send("submit",{...batch(),tasks:[{...h,time:10,codes:["W"]}]},c2)).statusCode,200);
   for(const c of [c1,c2]) assert.deepEqual(JSON.parse((await send("options",{},c)).body).other_codes.find(v=>v[0]==='W'),['W','작업지시']);
 });
 await t.test("database denies inactive workers and admin reset invalidates sessions",async()=>{
  await f.rpc("wl_admin_prepare_reset",{_number:EMP1});
  assert.equal((await send("me")).statusCode,401);
  await assert.rejects(f.rpc("wl_summary",{...identity,_from:today,_to:today}));
  await f.rpc("wl_admin_bind",{_number:EMP1,_user:U1});
  assert.equal((await send("me")).statusCode,401);
 });
 await t.test("logout revokes cookie replay and tamper fails",async()=>{
  assert.equal((await send("me",{},c2.slice(0,-4)+"aaaa")).statusCode,401);
  assert.equal((await send("logout",{},c2)).statusCode,200);
  assert.equal((await send("me",{},c2)).statusCode,401);
 });
 await t.test("atomic database-backed rate limiting persists across calls",async()=>{
  const key="ab".repeat(32);
  assert.equal(await f.rpc("wl_rate_limit",{_key:key,_limit:2}),true);
  assert.equal(await f.rpc("wl_rate_limit",{_key:key,_limit:2}),true);
  assert.equal(await f.rpc("wl_rate_limit",{_key:key,_limit:2}),false);
 });
 await t.test("public bundle has no personal/master data or credentials",async()=>{
  const files=await readdir(new URL("../public/",import.meta.url));
  assert.ok(!files.includes("data") && !files.includes("config.js") && !files.includes("vendor"));
  for(const file of files) {
    const text=await readFile(new URL("../public/"+file,import.meta.url),"utf8");
    assert.doesNotMatch(text,/sb_secret_|sb_publishable_|supabase\.co|employee-master\.json|mold-master\.json|master-data\.xlsx|localStorage\.setItem|sessionStorage\.setItem/);
  }
 });
 await f.db.close();
});

