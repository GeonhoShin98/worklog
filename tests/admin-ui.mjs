import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ExcelJS from 'exceljs';
import {createHandler} from '../netlify/functions/api.mjs';
import {fixture,env,EMP2,PERSONAL,U2} from './fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/geonhoshin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const f=await fixture();await f.rpc('wl_admin_set_role',{_number:EMP2,_role:'admin'});
const api=createHandler({env,request:f.request});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'});
const page=await context.newPage(),errors=[];let cookie='';
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());if(url.origin!==env.APP_ORIGIN)return route.abort();
 if(url.pathname.startsWith('/api/')){
  const result=await api({httpMethod:req.method(),path:url.pathname,headers:{...req.headers(),'x-nf-client-connection-ip':'192.0.2.1',cookie},body:req.postData()});
  if(result.headers['Set-Cookie'])cookie=result.headers['Set-Cookie'].split(';')[0];
  return route.fulfill({status:result.statusCode,headers:result.headers,body:result.body});
 }
 const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(!/^[a-z0-9.-]+$/.test(file))return route.fulfill({status:404,body:'Not found'});
 try {const body=await readFile(new URL('../public/'+file,import.meta.url));
  const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json';
  return route.fulfill({body,headers:{'Content-Type':type}});
 }catch{return route.fulfill({status:404,body:'Not found'});}
});
try{
 await page.goto(env.APP_ORIGIN+'/login.html');await page.locator('#employeeNo').fill(EMP2);await page.locator('#pin').fill(PERSONAL);await page.locator('#authButton').click();await page.waitForURL('**/admin.html');
 await page.locator('#reportFrom').fill('2026-11-10');await page.locator('#reportTo').fill('');await page.locator('#reportDepartment').selectOption('기계반');await page.locator('#reportForm button[type=submit]').click();
 await page.locator('#reportCount').getByText('총 0건',{exact:false}).waitFor();
 await page.locator('[data-panel=moldPanel]').click();
 const sap=new ExcelJS.Workbook(),sheet=sap.addWorksheet('Sheet1');sheet.getCell('D1').value='금형자재번호';sheet.getCell('E1').value='차종코드';sheet.getCell('F1').value='내역';
 sheet.getCell('D2').value='26026-2';sheet.getCell('E2').value='SX3 EV';sheet.getCell('F2').value='PNL UPR COVER';
 sheet.getCell('D3').value='26026-4';sheet.getCell('E3').value='SX3 EV';sheet.getCell('F3').value='PNL UPR COVER';
 sheet.getCell('D4').value='26020-4';sheet.getCell('E4').value='AI4';sheet.getCell('F4').value='RING SUNROOF REINF';
 await page.locator('#moldUpload').setInputFiles({name:'sap.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await sap.xlsx.writeBuffer())});
 await page.locator('#moldPreview').getByText('금형 2건',{exact:false}).waitFor();await page.locator('#moldReplace').click();
 await page.locator('#adminMessage').getByText('새 2건',{exact:false}).waitFor();
 assert.deepEqual((await f.db.query('select number from wl_private.molds order by number')).rows.map(r=>r.number),['26020','26026']);
 const today=(await f.db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
 await f.db.query('insert into public.worklog(date,name,"Id",swmno,proc,car,part,cat,code,time,classification,equipment,submission_id,line_no,user_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[today,'다른작업자',Number(EMP2),'26026-1,2','1,2','SX3 EV','PNL UPR COVER','C','T',540,['1','2'],['18'],randomUUID(),1,U2]);
 await page.locator('[data-panel=reportPanel]').click();await page.locator('#reportFrom').fill(today);await page.locator('#reportTo').fill('');await page.locator('#reportDepartment').selectOption('기계반');await page.locator('#reportForm button[type=submit]').click();
 await page.locator('#reportCount').getByText('총 1건',{exact:false}).waitFor();
 const downloadPromise=page.waitForEvent('download');await page.locator('#reportExport').click();const download=await downloadPromise;
 const output=new ExcelJS.Workbook();await output.xlsx.load(await readFile(await download.path()));
 const cells=output.worksheets[0].getRow(3);assert.equal(cells.getCell('A').value,Number(today.replaceAll('-','')));
 assert.equal(cells.getCell('C').value,EMP2);assert.equal(cells.getCell('D').value,'26026-1,2');
 assert.equal(cells.getCell('H').value,'1,2');assert.equal(cells.getCell('M').value,540);assert.equal(cells.getCell('N').value,'MIN');
 assert.deepEqual(errors,[]);
 console.log('Admin UI upload, atomic replacement, day/department query and template export passed');
}finally{await browser.close();await f.db.close();}
