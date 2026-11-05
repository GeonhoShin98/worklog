import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHandler } from "../netlify/functions/api.mjs";
import { fixture, env, EMP1, INITIAL, PERSONAL } from "./fixture.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "C:/Users/geonhoshin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const f=await fixture(),api=createHandler({env,request:f.request});
const browser=await chromium.launch({headless:true,channel:"msedge"});
await mkdir(new URL("../qa",import.meta.url),{recursive:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
const page=await context.newPage(),errors=[],calls=[];
page.on("pageerror",e=>errors.push(e.message));
let cookie="";
await context.route("**/*", async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.origin!==env.APP_ORIGIN) return route.abort();
 if(url.pathname.startsWith("/api/")) {
  calls.push(url.pathname);
  const result=await api({httpMethod:req.method(),path:url.pathname,headers:{
   ...req.headers(),"x-nf-client-connection-ip":"192.0.2.1",cookie
  },body:req.postData()});
  if(result.headers["Set-Cookie"]) cookie=result.headers["Set-Cookie"].split(";")[0];
  return route.fulfill({status:result.statusCode,headers:result.headers,body:result.body});
 }
 const file=url.pathname==="/"?"index.html":url.pathname.slice(1);
 if(!/^[a-z0-9.-]+$/.test(file)) return route.fulfill({status:404,body:"Not found"});
 try {
  const body=await readFile(new URL("../public/"+file,import.meta.url));
  const type=file.endsWith(".html")?"text/html; charset=utf-8":file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"application/json";
  return route.fulfill({body,headers:{"Content-Type":type,"Cache-Control":"no-store",
   "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"}});
 } catch { return route.fulfill({status:404,body:"Not found"}); }
});
try {
 await page.goto(env.APP_ORIGIN);
 await page.waitForURL("**/login.html");
 assert.ok(!calls.some(p=>p==="/api/options"||p==="/api/mold"),"no private data fetch before auth");
 await page.screenshot({path:new URL("../qa/login-mobile.png",import.meta.url).pathname.replace(/^\/([A-Z]:)/,"$1"),fullPage:true});
 await page.locator("#employeeNo").fill(EMP1);
 await page.locator("#pin").fill(INITIAL);
 await page.locator("#authButton").click();
 await page.waitForURL("**/pin.html");
 await page.locator("#pin").fill(INITIAL);await page.locator("#newPin").fill(PERSONAL);await page.locator("#confirmPin").fill(PERSONAL);
 await page.locator("#authButton").click();await page.waitForURL("**/login.html?changed=1");
 await page.locator("#employeeNo").fill(EMP1);await page.locator("#pin").fill(PERSONAL);
 await page.locator("#authButton").click();await page.waitForURL(env.APP_ORIGIN+"/");
 await page.locator(".task-card").waitFor();
 assert.equal(await page.locator("#employeeId").inputValue(),EMP1);
 assert.equal(await page.locator("#workerName").inputValue(),"테스트작업자");
 for(const id of ["department","team","workerName","employeeId"]) assert.equal(await page.locator("#"+id).getAttribute("readonly"),"");
 await page.locator(".mold-input").fill("99001");
 await page.getByText("조회 성공",{exact:true}).waitFor();
 await page.locator(".category-select button").click();
 await page.locator('.category-select input[value="B"]').click();
 await page.locator(".process-select button").click();await page.locator('.process-select input[value="1"]').check();
 await page.locator(".process-select button").click();
 await page.locator(".code-select button").click();await page.locator('.code-select input[value="F"]').check();
 await page.locator(".code-select button").click();
 await page.locator(".remark-input").fill('<img src=x onerror="alert(1)">');
 // Check multiple cards + collapse behavior and desktop row layout.
 for(let i=1;i<6;i++) await page.locator(".task-card").last().locator(".add-next-task").click();
 assert.equal(await page.locator(".task-body:visible").count(),1);
 for(const width of [320,390,768,1024,1280,1440]) {
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"overflow "+width);
   if(width>=768) assert.equal(await page.locator(".task-body:visible").count(),6);
 }
 await page.screenshot({path:new URL("../qa/desktop.png",import.meta.url).pathname.replace(/^\/([A-Z]:)/,"$1"),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.locator(".task-toggle").first().click();
 await page.screenshot({path:new URL("../qa/worklog-mobile.png",import.meta.url).pathname.replace(/^\/([A-Z]:)/,"$1"),fullPage:true});
 for(let i=5;i>=1;i--) await page.locator(".task-card").nth(i).locator(".remove-task").click();
 await page.locator("#submitButton").click();
 await page.waitForFunction(()=>document.querySelector("#appStatus").textContent.includes("등록되었습니다"));
 assert.equal((await f.db.query("select count(*)::int n from public.worklog")).rows[0].n,1);
 await page.locator("#viewToggle").click();await page.locator("#lookupButton").click();
 await page.waitForFunction(()=>document.querySelector("#lookupGrandTotal").textContent==="0H 30M");
 assert.equal(await page.locator("#lookupEmployeeId").inputValue(),EMP1);
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.equal(await page.locator('img[src="x"]').count(),0);
 await page.locator("#logoutButton").click();await page.waitForURL("**/login.html");
 await page.goto(env.APP_ORIGIN);await page.waitForURL("**/login.html");
 assert.deepEqual(errors,[]);
 console.log("PASS: mobile/desktop login, initial PIN, readonly identity, authenticated mold, 6 tasks, submit, self-summary, logout, storage, XSS; sizes 320–1440");
} finally {await browser.close();await f.db.close();}

