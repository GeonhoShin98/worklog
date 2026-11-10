import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
export const U1="11111111-1111-4111-8111-111111111111", U2="22222222-2222-4222-8222-222222222222";
export const EMP1="100000001",EMP2="100000002", INITIAL=EMP1, PERSONAL="Worker72645081";
export async function fixture() {
 const db=new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);");
 const migration=await readFile(new URL("../database/001_secure_auth.sql",import.meta.url),"utf8");
 await db.exec(migration); await db.exec(migration);
 const adminMigration=await readFile(new URL("../database/003_admin.sql",import.meta.url),"utf8");
 await db.exec(adminMigration); await db.exec(adminMigration);
 const workflowMigration=await readFile(new URL("../database/004_workflow_update.sql",import.meta.url),"utf8");
 await db.exec(workflowMigration); await db.exec(workflowMigration);
 const refreshMigration=await readFile(new URL("../database/005_mold_refresh_report.sql",import.meta.url),"utf8");
 await db.exec(refreshMigration); await db.exec(refreshMigration);
 await db.query("insert into auth.users values($1,$2,now()),($3,$4,now())",[U1,EMP1+"@login.example.org",U2,EMP2+"@login.example.org"]);
 await db.query("insert into wl_private.employees values($1,$2,'테스트작업자','사상반','A',true,true),($3,$4,'다른작업자','기계반','1',true,false)",[EMP1,U1,EMP2,U2]);
 await db.exec("insert into wl_private.molds values('99001','TEST CAR','TEST PART')");
 async function rpc(name,args) {
   const names=Object.keys(args), placeholders=names.map((_,i)=>"$"+(i+1));
   return (await db.query("select public."+name+"("+placeholders.join(",")+") as value",Object.values(args))).rows[0].value;
 }
 const passwords=new Map([[U1,INITIAL],[U2,PERSONAL]]);
 const emails=new Map([[U1,EMP1+"@login.example.org"],[U2,EMP2+"@login.example.org"]]);
 let counter=0;
 const tokens=new Map(),refreshes=new Map();
 function token(uid) {
   const access="access-"+(++counter),refresh="refresh-"+counter;
   tokens.set(access,uid);refreshes.set(refresh,uid);
   return {access_token:access,refresh_token:refresh,expires_in:3600,user:{id:uid,email:emails.get(uid)}};
 }
 const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
 async function request(url,options={}) {
   const u=new URL(url),input=options.body?JSON.parse(options.body):{};
   if(u.pathname.startsWith("/rest/v1/rpc/")) {
     try { return response(await rpc(u.pathname.split("/").at(-1),input)); }
     catch(error) { return response({code:error.code},400); }
   }
   if(u.pathname==="/auth/v1/token") {
     if(u.searchParams.get("grant_type")==="refresh_token") {
       const uid=refreshes.get(input.refresh_token);
       return uid?response(token(uid)):response({},401);
     }
     const uid=[...emails].find(([,email])=>email===input.email)?.[0];
     return uid && passwords.get(uid)===input.password?response(token(uid)):response({},400);
   }
   if(u.pathname.startsWith('/auth/v1/admin/users')) {
     let id=u.pathname.split('/')[5];
     if(options.method==='POST') {id=randomUUID();await db.query('insert into auth.users values($1,$2,now())',[id,input.email]);}
     if(!id) return response({},400);
     passwords.set(id,input.password);emails.set(id,input.email);return response({id});
   }
   const uid=tokens.get(options.headers?.Authorization?.replace("Bearer ",""));
   if(u.pathname==="/auth/v1/user") {
     if(!uid) return response({},401);
     if(options.method==="PUT") {
       if(passwords.get(uid)!==input.current_password) return response({},400);
       passwords.set(uid,input.password);
     }
     return response({id:uid,email:emails.get(uid)});
   }
   if(u.pathname==="/auth/v1/logout") return response({});
   throw new Error("Unexpected upstream path "+u.pathname);
 }
 return {db,rpc,request,passwords};
}
export const task=()=>({mold:"99001",processes:["1","2"],cat:"B",codes:["F"],classification:[],equipment:[],time:30,remark:""});
export const env={
 SUPABASE_URL:"https://test.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_test",
 SUPABASE_SECRET_KEY:"sb_secret_test",APP_ORIGIN:"https://work.example.org",
 AUTH_ID_DOMAIN:"login.example.org",SESSION_KEY:"11".repeat(32)
};
export function event(action,input={},cookie="",extra={}) {
 return {httpMethod:"POST",path:"/api/"+action,body:JSON.stringify(input),headers:{
  origin:env.APP_ORIGIN,"content-type":"application/json","x-worklog-request":"1",
  "sec-fetch-site":"same-origin","x-nf-client-connection-ip":"192.0.2.1",cookie,...extra}};
}
export const getCookie=res=>res.headers["Set-Cookie"].split(";")[0];

