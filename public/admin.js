"use strict";
(async()=>{
 const $=id=>document.getElementById(id), api=(action,data={})=>WorklogSecurity.api('/api/admin-'+action,data);
 let me,employees=[],reportOffset=0,moldOffset=0,reportTotal=0,moldTotal=0;
 const message=(value,error=false)=>{ $('adminMessage').textContent=value; $('adminMessage').className=error?'auth-message':'admin-success'; };
 const duration=v=>Math.floor(Number(v)/60)+'H '+Number(v)%60+'M';
 const row=(values,edit)=>{const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value??'—';tr.appendChild(td);}if(edit){const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.textContent='수정';b.addEventListener('click',edit);td.appendChild(b);tr.appendChild(td);}return tr;};
 const run=async(fn,button)=>{if(button)button.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{if(button)button.disabled=false;}};
 const label=e=>e.department+' · '+e.team+' · '+e.name+' ('+e.employee_no+')';
 function editEmployee(e){$('manageNumber').value=e.employee_no;$('manageNumber').readOnly=true;$('manageName').value=e.name;$('manageDepartment').value=e.department;$('manageTeam').value=e.team;$('manageActive').value=String(e.active);$('employeeForm').scrollIntoView({block:'center'});}
 async function loadEmployees(){
  employees=await api('employees');const current=$('reportEmployee').value;
  $('reportEmployee').replaceChildren(new Option('전체',''));$('resetEmployee').replaceChildren(new Option('선택',''));$('employeeRows').replaceChildren();
  for(const e of employees){
   $('reportEmployee').appendChild(new Option(label(e),e.employee_no));
   if(e.active&&e.role==='worker')$('resetEmployee').appendChild(new Option(label(e),e.employee_no));
   $('employeeRows').appendChild(row([e.employee_no,e.name,e.department,e.team,e.active?'사용':'중지',e.role==='admin'?'관리자':'작업자',!e.has_account?'계정 준비 필요':e.must_change_pin?'최초 변경 필요':'설정 완료'],()=>editEmployee(e)));
  }$('reportEmployee').value=current;
 }
 async function loadReport(){const r=await api('report',{from:$('reportFrom').value,to:$('reportTo').value,employee_no:$('reportEmployee').value,offset:reportOffset});reportTotal=r.total;
  $('reportRows').replaceChildren();$('summaryRows').replaceChildren();
  for(const s of r.summary)$('summaryRows').appendChild(row([s.work_date,s.employee_no,s.name,s.task_count,duration(s.total_minutes)]));
  for(const w of r.rows)$('reportRows').appendChild(row([w.date,w.name+' ('+w.employee_no+')',w.swmno,[w.car,w.part].filter(Boolean).join(' / '),w.cat+' / '+w.code,duration(w.time),w.remark,w.entered_by_name]));
  $('reportCount').textContent='총 '+r.total+'건 · '+duration(r.summary.reduce((n,s)=>n+Number(s.total_minutes),0));$('reportPage').textContent=(r.total?reportOffset+1:0)+'–'+Math.min(reportOffset+200,r.total)+' / '+r.total;
  $('reportPrev').disabled=reportOffset===0;$('reportNext').disabled=reportOffset+200>=r.total;
 }
 async function loadMolds(){const r=await api('molds',{query:$('moldQuery').value.trim(),offset:moldOffset});moldTotal=r.total;$('moldRows').replaceChildren();for(const m of r.rows)$('moldRows').appendChild(row([m.number,m.car,m.part],()=>{$('manageMold').value=m.number;$('manageCar').value=m.car;$('managePart').value=m.part;$('moldForm').scrollIntoView({block:'center'});}));$('moldPage').textContent=(r.total?moldOffset+1:0)+'–'+Math.min(moldOffset+100,r.total)+' / '+r.total;$('moldPrev').disabled=moldOffset===0;$('moldNext').disabled=moldOffset+100>=r.total;}
 try {me=await WorklogSecurity.requireWorker();if(!me)return;if(me.role!=='admin'){location.replace('/');return;}$('adminIdentity').textContent=me.name+' · '+me.department+' · '+me.team;$('adminContent').hidden=false;await loadEmployees();const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=t=>p.find(x=>x.type===t).value;const today=v('year')+'-'+v('month')+'-'+v('day');$('reportFrom').value=today.slice(0,7)+'-01';$('reportTo').value=today;await loadReport();}
 catch(e){message(e.message,true);$('adminContent').hidden=false;return;}
 for(const b of document.querySelectorAll('[data-panel]'))b.addEventListener('click',()=>{for(const item of document.querySelectorAll('[data-panel]')){const selected=item===b;item.setAttribute('aria-pressed',String(selected));$(item.dataset.panel).hidden=!selected;}message('');if(b.dataset.panel==='moldPanel')run(loadMolds);});
 $('reportForm').addEventListener('submit',e=>{e.preventDefault();reportOffset=0;run(loadReport,e.submitter);});
 $('reportPrev').addEventListener('click',()=>{reportOffset=Math.max(0,reportOffset-200);run(loadReport);});$('reportNext').addEventListener('click',()=>{if(reportOffset+200<reportTotal){reportOffset+=200;run(loadReport);}});
 $('newEmployee').addEventListener('click',()=>{$('employeeForm').reset();$('manageNumber').readOnly=false;$('manageNumber').focus();});
 $('employeeForm').addEventListener('submit',e=>{e.preventDefault();const data={employee_no:$('manageNumber').value,name:$('manageName').value.trim(),department:$('manageDepartment').value,team:$('manageTeam').value.trim(),active:$('manageActive').value==='true'};if(!confirm(data.name+' ('+data.employee_no+') 직원 정보를 저장할까요?'))return;run(async()=>{await api('employee-save',{row:data});message('직원 정보를 저장했습니다. 해당 직원은 다시 로그인해 주세요.');if(data.employee_no===me.employee_no){location.replace('/login.html');return;}await loadEmployees();},e.submitter);});
 $('resetForm').addEventListener('submit',e=>{e.preventDefault();const number=$('resetEmployee').value;if(!confirm(number+' 작업자의 비밀번호를 사번으로 초기화하고 기존 로그인을 종료할까요?'))return;run(async()=>{try{await api('reset',{employee_no:number,current_password:$('adminPassword').value});message('초기화했습니다. 다음 로그인 후 비밀번호 변경이 필요합니다.');await loadEmployees();}finally{$('adminPassword').value='';}},e.submitter);});
 $('moldSearchForm').addEventListener('submit',e=>{e.preventDefault();moldOffset=0;run(loadMolds,e.submitter);});
 $('moldForm').addEventListener('submit',e=>{e.preventDefault();const data={number:$('manageMold').value,car:$('manageCar').value.trim(),part:$('managePart').value.trim()};if(!confirm(data.number+' 금형 기준정보를 저장할까요?'))return;run(async()=>{await api('mold-save',{row:data});message('금형 기준정보를 저장했습니다.');await loadMolds();},e.submitter);});
 $('moldPrev').addEventListener('click',()=>{moldOffset=Math.max(0,moldOffset-100);run(loadMolds);});$('moldNext').addEventListener('click',()=>{if(moldOffset+100<moldTotal){moldOffset+=100;run(loadMolds);}});
})();
