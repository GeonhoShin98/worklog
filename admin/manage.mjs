// Operator-only tool. Run outside public/. Never ship personal files in the deployment.
import { readFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
const env=process.env;
for(const name of ["SUPABASE_URL","SUPABASE_SECRET_KEY","AUTH_ID_DOMAIN"]) {
  if(!env[name]) throw new Error("Missing environment variable: "+name);
}
if(new URL(env.SUPABASE_URL).protocol!=="https:") throw new Error("HTTPS required");
async function call(path,body,method="POST") {
  const key=env.SUPABASE_SECRET_KEY;
  const res=await fetch(env.SUPABASE_URL+path,{method,headers:{
    apikey:key,"Content-Type":"application/json",...(!key.startsWith("sb_secret_")?{Authorization:"Bearer "+key}:{})
  },body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!res.ok) {
    // Never log Auth responses: they can contain credentials or PII.
    const error=await res.json().catch(()=>({}));
    throw new Error("요청 실패 HTTP "+res.status+" / "+(error.code||error.error_code||"설정 확인"));
  }
  return res.json().catch(()=>null);
}
const rpc=(name,body)=>call("/rest/v1/rpc/"+name,body);
async function importRows(kind,rows) {
  for(let i=0;i<rows.length;i+=300) await rpc("wl_admin_import",{_kind:kind,_rows:rows.slice(i,i+300)});
  console.log(kind+": "+rows.length+"건 반영");
}
const [command,...args]=process.argv.slice(2);
if(command==="import-json") {
  if(args.length!==2) throw new Error("import-json <employee-master.json 절대경로> <mold-master.json 절대경로>");
  const employees=JSON.parse(await readFile(args[0],"utf8")).workers;
  const molds=JSON.parse(await readFile(args[1],"utf8")).records;
  await importRows("employees",employees.map(w=>({employee_no:String(w.employeeId),name:w.name,department:w.department,team:w.team})));
  await importRows("molds",Object.entries(molds).map(([number,value])=>({number,...(Array.isArray(value)?value[0]:value)})));
} else if(command==="import") {
  const [kind,file]=args;
  if(!["employees","molds"].includes(kind)||!file) throw new Error("import employees|molds <개인 보관 JSON 절대경로>");
  const rows=JSON.parse(await readFile(file,"utf8"));
  if(!Array.isArray(rows)) throw new Error("JSON 배열이 필요합니다.");
  await importRows(kind,rows);
} else if(command==="create" || command==="reset") {
  const number=args[0];
  if(!/^\d{9}$/.test(number||"")) throw new Error("사번 9자리가 필요합니다.");
  const row=await rpc("wl_admin_employee",{_number:number});
  if(!row) throw new Error("작업자 기준정보를 먼저 등록하세요.");
  if(command==="create" && row.user_id) throw new Error("이미 계정이 있습니다. 재발급은 reset을 사용하세요.");
  if(command==="reset" && !row.user_id) throw new Error("먼저 create로 계정을 생성하세요.");
  const pin=Array.from({length:10},()=>randomInt(10)).join("");
  // Block access and revoke all app sessions before changing the Auth credential.
  await rpc("wl_admin_prepare_reset",{_number:number});
  const user=await call("/auth/v1/admin/users"+(row.user_id?"/"+row.user_id:""),
    {email:number+"@"+env.AUTH_ID_DOMAIN,password:pin,email_confirm:true},row.user_id?"PUT":"POST");
  const uid=user.id||user.user?.id;
  if(!uid) throw new Error("계정 ID를 확인할 수 없습니다. 계정은 비활성 상태로 유지됩니다.");
  await rpc("wl_admin_bind",{_number:number,_user:uid});
  console.log("임시 PIN (작업자 본인에게만 전달, 별도 파일 저장 금지): "+pin);
  console.log("최초 로그인 후 개인 PIN 변경이 필요합니다.");
} else {
  throw new Error("사용법: import-json <이전 직원 JSON> <이전 금형 JSON> | import employees|molds <JSON> | create <사번> | reset <사번>");
}

