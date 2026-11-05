import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../netlify/functions/api.mjs';
import {fixture,event,env,getCookie,U1,EMP1,INITIAL} from './fixture.mjs';

test('numeric password, per-session deferral, 30-day cross-device reminder and reset',async()=>{
 const f=await fixture(),api=createHandler({env,request:f.request});
 const send=(a,b={},c='')=>api(event(a,b,c));
 const login=()=>send('login',{employee_no:EMP1,pin:INITIAL});
 const body=r=>JSON.parse(r.body);
 try {
  const first=await login(),c1=getCookie(first);assert.equal(body(first).must_change_pin,true);
  assert.equal((await send('pin-defer',{mode:'forever'},c1)).statusCode,400);
  assert.equal((await send('pin-defer',{mode:'next_login'},c1)).statusCode,200);
  assert.equal(body(await send('me',{},c1)).must_change_pin,false);
  assert.equal(body(await send('me',{},c1)).initial_password,true);
  assert.equal((await send('options',{},c1)).statusCode,200);
  const second=await login(),c2=getCookie(second);assert.equal(body(second).must_change_pin,true);
  assert.equal((await send('options',{},c2)).statusCode,403);
  assert.equal((await send('pin-defer',{mode:'30_days'},c2)).statusCode,200);
  const remain=(await f.db.query("select extract(epoch from pin_reminder_after-now())::int seconds from wl_private.employees where user_id=$1",[U1])).rows[0].seconds;
  assert.ok(remain>29*86400 && remain<=30*86400);
  assert.equal(body(await login()).must_change_pin,false);
  await f.db.query("update wl_private.employees set pin_reminder_after=now()-interval '1 second' where user_id=$1",[U1]);
  assert.equal(body(await send('me',{},c2)).must_change_pin,true);
  assert.equal((await send('options',{},c2)).statusCode,403);
  assert.equal(body(await login()).must_change_pin,true);
  // Database permissions remain closed after adding the deferral RPC.
  const sid=(await f.db.query('select id from wl_private.sessions where user_id=$1 limit 1',[U1])).rows[0].id;
  for(const role of ['anon','authenticated']) {
   await f.db.exec('set role '+role);
   await assert.rejects(f.rpc('wl_defer_pin_change',{_session:sid,_user:U1,_mode:'30_days'}));
   await f.db.exec('reset role');
  }
  await send('pin-defer',{mode:'30_days'},c2);
  await f.rpc('wl_admin_prepare_reset',{_number:EMP1});
  assert.equal((await send('me',{},c2)).statusCode,401);
  await f.rpc('wl_admin_bind',{_number:EMP1,_user:U1});
  const reset=await login(),c3=getCookie(reset);assert.equal(body(reset).must_change_pin,true);
  assert.equal((await send('pin',{current_pin:INITIAL,new_pin:'68392057'},c3)).statusCode,200);
  assert.equal((await send('me',{},c3)).statusCode,401);
  const changed=await send('login',{employee_no:EMP1,pin:'68392057'});
  assert.equal(changed.statusCode,200);assert.equal(body(changed).must_change_pin,false);
  assert.equal(body(await send('me',{},getCookie(changed))).initial_password,false);
  assert.equal((await send('pin-defer',{mode:'30_days'},getCookie(changed))).statusCode,400);
 } finally {await f.db.close();}
});
