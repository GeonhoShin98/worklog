import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
const COOKIE = "__Host-worklog";
const SESSION_SECONDS = 8 * 60 * 60;
const headers = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
class Failure extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const deny = () => new Failure(401,"AUTH_REQUIRED","로그인이 필요합니다.");
function configuration(env) {
  const names = ["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY","APP_ORIGIN","AUTH_ID_DOMAIN","SESSION_KEY"];
  if (names.some(name=>!env[name]) || !/^[a-f0-9]{64}$/i.test(env.SESSION_KEY)) throw new Failure(503,"SETUP","서버 연결 설정이 필요합니다.");
  const url = new URL(env.SUPABASE_URL), origin = new URL(env.APP_ORIGIN);
  if (url.protocol!=="https:" || origin.protocol!=="https:" || origin.origin!==env.APP_ORIGIN ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.AUTH_ID_DOMAIN)) throw new Failure(503,"SETUP","서버 연결 설정이 필요합니다.");
  return env;
}
function encrypt(value, key) {
  const nonce=randomBytes(12), cipher=createCipheriv("aes-256-gcm",Buffer.from(key,"hex"),nonce);
  const body=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString("base64url");
}
function decrypt(value,key) {
  try {
    const bytes=Buffer.from(value,"base64url"), cipher=createDecipheriv("aes-256-gcm",Buffer.from(key,"hex"),bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(12,28));
    const data=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());
    if (!data.access || !data.refresh || !data.sid || !data.uid || data.until<=Date.now()) throw deny();
    return data;
  } catch { throw deny(); }
}
function cookie(value,maxAge) {
  return COOKIE+"="+value+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+maxAge;
}
function validPin(pin, employee="") {
  return typeof pin==="string" && /^[A-Za-z0-9]{8,32}$/.test(pin) &&
    /[A-Za-z]/.test(pin) && /[0-9]/.test(pin) && pin!==employee;
}
const textError = (status,code,message) => new Failure(status,code,message);
export function createHandler({ env=process.env, request=fetch }={}) {
  return async event => {
    let setCookie;
    const reply = (status,data) => ({statusCode:status,headers:{...headers,...(setCookie?{"Set-Cookie":setCookie}:{})},body:JSON.stringify(data)});
    try {
      const c=configuration(env);
      const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
      if(event.httpMethod!=="POST") return reply(405,{message:"허용되지 않은 요청입니다."});
      if(h.origin!==c.APP_ORIGIN || h["x-worklog-request"]!=="1" ||
         !/^application\/json(?:;|$)/i.test(h["content-type"]||"") ||
         (h["sec-fetch-site"] && h["sec-fetch-site"]!=="same-origin")) return reply(403,{message:"허용되지 않은 요청입니다."});
      if(event.isBase64Encoded || Buffer.byteLength(event.body||"")>20000) return reply(413,{message:"요청 크기를 확인하세요."});
      let input; try { input=JSON.parse(event.body||"{}"); } catch { return reply(400,{message:"요청 형식을 확인하세요."}); }
      if(!input || Array.isArray(input) || typeof input!=="object") return reply(400,{message:"요청 형식을 확인하세요."});
      const action=event.path.split("/").filter(Boolean).at(-1);
      async function upstream(path,body,{token,key=c.SUPABASE_PUBLISHABLE_KEY,method="POST"}={}) {
        let res;
        try {
          res=await request(c.SUPABASE_URL+path,{
            method,headers:{apikey:key,"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
            ...(method==="GET"?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)
          });
        } catch { throw textError(503,"UNAVAILABLE","서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요."); }
        const payload=await res.json().catch(()=>({}));
        if(!res.ok) {
          if(res.status===429) throw textError(429,"RATE_LIMIT","시도 횟수가 많습니다. 잠시 후 다시 시도하세요.");
          if(payload.code==="P1001") throw deny();
          if(payload.code==="P1002") throw textError(403,"PIN_REQUIRED","초기 비밀번호를 먼저 변경하세요.");
          if(payload.code==="P1004") throw textError(403,"ADMIN_REQUIRED","관리자 권한이 필요합니다.");
          if(payload.code==="P1003") throw textError(409,"CONFLICT","같은 제출 번호의 내용이 다릅니다. 기존 등록을 확인하세요.");
          if(payload.code==="22023" || payload.code==="23514") throw textError(400,"VALIDATION","입력값을 확인하세요. 금형·작업코드·시간 또는 날짜가 올바르지 않습니다.");
          throw textError(502,"UPSTREAM","요청을 처리하지 못했습니다. 관리자에게 문의하세요.");
        }
        return payload;
      }
      const rpc = (name,body) => upstream("/rest/v1/rpc/"+name,body,{
        key:c.SUPABASE_SECRET_KEY,
        ...(!c.SUPABASE_SECRET_KEY.startsWith("sb_secret_")?{token:c.SUPABASE_SECRET_KEY}:{})
      });
      const ip = h["x-nf-client-connection-ip"];
      async function limit(scope,value,max) {
        const hash=createHmac("sha256",c.SESSION_KEY).update(scope+":"+value).digest("hex");
        if(!await rpc("wl_rate_limit",{_key:hash,_limit:max})) throw textError(429,"RATE_LIMIT","시도 횟수가 많습니다. 15분 후 다시 시도하세요.");
      }
      if(action==="login") {
        if(!ip) throw textError(503,"SETUP","접속 환경을 확인할 수 없습니다.");
        await limit("ip",ip,300);
        if(typeof input.employee_no!=="string" || !/^\d{9}$/.test(input.employee_no) ||
           typeof input.pin!=="string" || !/^[A-Za-z0-9]{8,32}$/.test(input.pin)) throw textError(401,"LOGIN_FAILED","사번 또는 비밀번호가 올바르지 않습니다.");
        await limit("employee",input.employee_no,10);
        let token;
        try {
          token=await upstream("/auth/v1/token?grant_type=password",{
            email:input.employee_no+"@"+c.AUTH_ID_DOMAIN,password:input.pin
          });
        } catch(error) {
          if(error.status===429 || error.status===503) throw error;
          throw textError(401,"LOGIN_FAILED","사번 또는 비밀번호가 올바르지 않습니다.");
        }
        let profile;
        try { profile=await rpc("wl_open_session",{_user:token.user.id}); }
        catch { throw textError(401,"LOGIN_FAILED","사번 또는 비밀번호가 올바르지 않습니다."); }
        const value={access:token.access_token,refresh:token.refresh_token,uid:token.user.id,sid:profile.session_id,
          until:Date.now()+SESSION_SECONDS*1000,accessUntil:Date.now()+token.expires_in*1000};
        setCookie=cookie(encrypt(value,c.SESSION_KEY),SESSION_SECONDS);
        return reply(200,{must_change_pin:profile.must_change_pin});
      }
      const value=(h.cookie||"").split(";").map(v=>v.trim()).find(v=>v.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
      if(!value) throw deny();
      const session=decrypt(value,c.SESSION_KEY);
      if(action==="logout") {
        await rpc("wl_close_session",{_session:session.sid,_user:session.uid});
        await upstream("/auth/v1/logout?scope=local",{}, {token:session.access}).catch(()=>{});
        setCookie=cookie("",0); return reply(200,{ok:true});
      }
      const profile=await rpc("wl_session_profile",{_session:session.sid,_user:session.uid});
      if(session.accessUntil<Date.now()+60000) {
        let refreshed;
        try { refreshed=await upstream("/auth/v1/token?grant_type=refresh_token",{refresh_token:session.refresh}); }
        catch { throw deny(); }
        if(refreshed.user.id!==session.uid) throw deny();
        session.access=refreshed.access_token; session.refresh=refreshed.refresh_token;
        session.accessUntil=Date.now()+refreshed.expires_in*1000;
        setCookie=cookie(encrypt(session,c.SESSION_KEY),Math.max(0,Math.floor((session.until-Date.now())/1000)));
      }
      let user;
      try { user=await upstream("/auth/v1/user",null,{method:"GET",token:session.access}); }
      catch(error) { if(error.status===503) throw error; throw deny(); }
      if(user.id!==session.uid) throw deny();
      if(action==="me") return reply(200,profile);
      if(action==="pin") {
        await limit("pin",session.uid,8);
        if(!validPin(input.new_pin,profile.employee_no) || input.new_pin===input.current_pin ||
           typeof input.current_pin!=="string" || !/^[A-Za-z0-9]{8,32}$/.test(input.current_pin))
          throw textError(400,"PIN_INVALID","새 비밀번호는 영문과 숫자를 모두 포함한 8~32자리이며 현재 비밀번호와 달라야 합니다.");
        let verified;
        try { verified=await upstream("/auth/v1/token?grant_type=password",{email:user.email,password:input.current_pin}); }
        catch { throw textError(400,"PIN_INVALID","현재 비밀번호를 확인하세요."); }
        if(verified.user.id!==session.uid) throw deny();
        await upstream("/auth/v1/user",{password:input.new_pin,current_password:input.current_pin},{method:"PUT",token:verified.access_token});
        await rpc("wl_finish_pin_change",{_session:session.sid,_user:session.uid});
        await upstream("/auth/v1/logout?scope=global",{}, {token:verified.access_token}).catch(()=>{});
        setCookie=cookie("",0); return reply(200,{ok:true});
      }
      if(profile.must_change_pin) throw textError(403,"PIN_REQUIRED","초기 비밀번호를 먼저 변경하세요.");
      const identity={_session:session.sid,_user:session.uid};
      if(action.startsWith("admin-")) {
        if(profile.role!=="admin") throw textError(403,"ADMIN_REQUIRED","관리자 권한이 필요합니다.");
        await limit("admin",session.uid,500);
        if(action==="admin-employees") return reply(200,await rpc("wl_manager_employees",identity));
        if(action==="admin-options") return reply(200,await rpc("wl_manager_options",{...identity,_number:input.employee_no}));
        if(action==="admin-submit") return reply(200,await rpc("wl_manager_submit",{...identity,_number:input.employee_no,_payload:input.payload}));
        if(action==="admin-report") return reply(200,await rpc("wl_manager_report",{...identity,_from:input.from,_to:input.to,_number:input.employee_no||null,_offset:input.offset??0}));
        if(action==="admin-molds") return reply(200,await rpc("wl_manager_molds",{...identity,_query:input.query??"",_offset:input.offset??0}));
        if(action==="admin-mold-save") { await rpc("wl_manager_save_mold",{...identity,_row:input.row}); return reply(200,{ok:true}); }
        async function provision(row) {
          const number=row.employee_no;
          if(!/^\d{9}$/.test(number)) throw textError(400,"VALIDATION","사번을 확인하세요.");
          const created=await upstream("/auth/v1/admin/users"+(row.user_id?"/"+row.user_id:""),
            {email:number+"@"+c.AUTH_ID_DOMAIN,password:number,email_confirm:true},
            {method:row.user_id?"PUT":"POST",key:c.SUPABASE_SECRET_KEY,...(!c.SUPABASE_SECRET_KEY.startsWith("sb_secret_")?{token:c.SUPABASE_SECRET_KEY}:{})});
          const uid=created.id||created.user?.id;
          if(!uid) throw textError(502,"UPSTREAM","계정 생성 상태를 확인하세요.");
          await rpc("wl_admin_bind",{_number:number,_user:uid});
        }
        if(action==="admin-employee-save") {
          const row=await rpc("wl_manager_save_employee",{...identity,_row:input.row});
          if(!row.user_id && row.active) { await rpc("wl_admin_prepare_reset",{_number:row.employee_no}); await provision(row); }
          return reply(200,{ok:true});
        }
        if(action==="admin-reset") {
          await limit("admin-reset",session.uid,20);
          if(typeof input.current_password!=="string" || !/^[A-Za-z0-9]{8,32}$/.test(input.current_password)) throw textError(400,"PASSWORD_INVALID","관리자 본인의 현재 비밀번호를 확인하세요.");
          let verified;
          try { verified=await upstream("/auth/v1/token?grant_type=password",{email:user.email,password:input.current_password}); }
          catch { throw textError(400,"PASSWORD_INVALID","관리자 본인의 현재 비밀번호를 확인하세요."); }
          if(verified.user.id!==session.uid) throw deny();
          await upstream("/auth/v1/logout?scope=local",{}, {token:verified.access_token}).catch(()=>{});
          const row=await rpc("wl_manager_prepare_reset",{...identity,_number:input.employee_no});
          await provision(row);return reply(200,{ok:true});
        }
        return reply(404,{message:"요청을 찾을 수 없습니다."});
      }
      if(action==="options") return reply(200,await rpc("wl_options",identity));
      if(action==="mold") {
        if(typeof input.number!=="string" || !/^\d{5}$/.test(input.number)) throw textError(400,"VALIDATION","금형번호는 숫자 5자리입니다.");
        await limit("mold",session.uid,300);
        return reply(200,await rpc("wl_mold",{...identity,_number:input.number}));
      }
      if(action==="summary") return reply(200,await rpc("wl_summary",{...identity,_from:input.from,_to:input.to}));
      if(action==="submit") return reply(200,await rpc("wl_submit",{...identity,_payload:input}));
      return reply(404,{message:"요청을 찾을 수 없습니다."});
    } catch(error) {
      if(error.status===401) setCookie=cookie("",0);
      return reply(error.status||500,{code:error.code||"SERVER_ERROR",message:error.status?error.message:"요청을 처리하지 못했습니다. 관리자에게 문의하세요."});
    }
  };
}
export const handler=createHandler();

