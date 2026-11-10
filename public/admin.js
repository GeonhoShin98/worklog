"use strict";
(async()=>{
 const $=id=>document.getElementById(id), api=(action,data={})=>WorklogSecurity.api('/api/admin-'+action,data);
 let me,employees=[],reportOffset=0,moldOffset=0,reportTotal=0,moldTotal=0,reportFilters=null,importRows=null;
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
 function selectedFilters(){
  const filters={from:$('reportFrom').value,to:$('reportTo').value||$('reportFrom').value,department:$('reportDepartment').value,employee_no:$('reportEmployee').value};
  if(!filters.from || filters.to<filters.from)throw new Error('조회 날짜를 확인하세요.');
  if(filters.employee_no && filters.department && employees.find(e=>e.employee_no===filters.employee_no)?.department!==filters.department)throw new Error('선택한 작업자의 소속이 조회 소속과 다릅니다.');
  return filters;
 }
 function filterEmployees(){const previous=$('reportEmployee').value,department=$('reportDepartment').value;$('reportEmployee').replaceChildren(new Option('전체',''));for(const e of employees)if(!department||e.department===department)$('reportEmployee').appendChild(new Option(label(e),e.employee_no));$('reportEmployee').value=previous;}
 async function loadReport(){const filters=selectedFilters();const r=await api('report',{...filters,offset:reportOffset});reportFilters=filters;reportTotal=r.total;
  $('reportRows').replaceChildren();$('summaryRows').replaceChildren();
  for(const s of r.summary)$('summaryRows').appendChild(row([s.work_date,s.employee_no,s.name,s.task_count,duration(s.total_minutes)]));
  for(const w of r.rows)$('reportRows').appendChild(row([w.date,w.name+' ('+w.employee_no+')',w.swmno,[w.car,w.part].filter(Boolean).join(' / '),w.cat+' / '+w.code,duration(w.time),w.remark,w.entered_by_name]));
  $('reportCount').textContent='총 '+r.total+'건 · '+duration(r.summary.reduce((n,s)=>n+Number(s.total_minutes),0));$('reportPage').textContent=(r.total?reportOffset+1:0)+'–'+Math.min(reportOffset+200,r.total)+' / '+r.total;
  $('reportPrev').disabled=reportOffset===0;$('reportNext').disabled=reportOffset+200>=r.total;
  $('reportExport').disabled=r.total===0;
 }
 async function exportReport(){
  if(!reportFilters||!reportTotal)throw new Error('저장할 조회 결과가 없습니다.');
  if(!window.ExcelJS)throw new Error('엑셀 기능을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
  const filters={...reportFilters},first=await api('report',{...filters,offset:0}),total=first.total;
  if(!total)throw new Error('저장할 조회 결과가 없습니다.');
  if(total>50000)throw new Error('조회 건수가 많습니다. 기간이나 작업자를 좁혀 저장하세요.');
  const response=await fetch('/report-template.xlsx',{cache:'no-store'});
  if(!response.ok)throw new Error('엑셀 양식을 불러오지 못했습니다.');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await response.arrayBuffer());
  const sheet=workbook.worksheets[0];let written=0;
  function append(rows){for(const w of rows){const index=written+3,r=sheet.getRow(index),values=[
    Number(String(w.date||'').replaceAll('-','')),w.name,w.employee_no,w.swmno||'',w.car||'',w.part||'',
    '',null,w.cat||'',Array.isArray(w.classification)?w.classification.join(','):w.classification||'',
    w.code||'',Array.isArray(w.equipment)?w.equipment.join(','):w.equipment||'',Number(w.time),'MIN'];
    for(let column=1;column<=14;column++)r.getCell(column).value=values[column-1];
    r.getCell(3).numFmt='@';r.getCell(13).numFmt='0';written++;}}
  append(first.rows);
  for(let offset=200;offset<total;offset+=200){
   message('엑셀 준비 중 · '+Math.min(offset,total)+' / '+total+'건');
   const page=await api('report',{...filters,offset});append(page.rows);
   if(page.rows.length!==Math.min(200,total-offset))throw new Error('조회 중 자료가 변경됐습니다. 다시 조회해 주세요.');
  }
  const blob=new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='공수실적_'+filters.from.replaceAll('-','')+'_'+filters.to.replaceAll('-','')+'.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  message('엑셀 '+written+'건을 저장했습니다. 생산오더와 공정은 빈칸입니다.');
 }
 async function prepareMolds(file){
  importRows=null;$('moldReplace').disabled=true;$('moldPreview').textContent='';
  if(!file)return;
  if(!/\.xlsx$/i.test(file.name)||file.size>8000000)throw new Error('8MB 이하의 XLSX 파일을 선택하세요.');
  if(!window.ExcelJS)throw new Error('엑셀 기능을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer());
  const sheet=workbook.worksheets[0];
  if(!sheet||String(sheet.getCell('D1').text).trim()!=='금형자재번호'||String(sheet.getCell('E1').text).trim()!=='차종코드'||String(sheet.getCell('F1').text).trim()!=='내역')throw new Error('SAP 엑셀의 D·E·F열 제목을 확인하세요.');
  const unique=new Map();let source=0,duplicates=0,conflicts=0;
  for(let index=2;index<=sheet.rowCount;index++){
   const r=sheet.getRow(index),raw=String(r.getCell(4).text||'').trim(),car=String(r.getCell(5).text||'').trim(),part=String(r.getCell(6).text||'').trim();
   if(!raw&&!car&&!part)continue;
   const match=/^(\d{5})(?:-\d+)?$/.exec(raw);
   if(!match||!car||!part||car.length>120||part.length>180)throw new Error(index+'행의 금형자재번호·차종코드·내역을 확인하세요.');
   source++;const prior=unique.get(match[1]);if(prior){duplicates++;if(prior.car!==car||prior.part!==part)conflicts++;}
   else unique.set(match[1],{number:match[1],car,part});
  }
  if(!unique.size||unique.size>5000)throw new Error('금형 정보는 1~5,000건이어야 합니다.');
  importRows=[...unique.values()];
  if(JSON.stringify({rows:importRows}).length>900000)throw new Error('파일 자료가 너무 큽니다. 관리자에게 문의하세요.');
  $('moldPreview').textContent=file.name+' · 원본 '+source+'행 → 금형 '+unique.size+'건 (중복 '+duplicates+'행'+(conflicts?', 내용 차이 '+conflicts+'행은 첫 행 사용':'')+')';
  $('moldReplace').disabled=false;
 }
 async function loadMolds(){const r=await api('molds',{query:$('moldQuery').value.trim(),offset:moldOffset});moldTotal=r.total;$('moldRows').replaceChildren();for(const m of r.rows)$('moldRows').appendChild(row([m.number,m.car,m.part],()=>{$('manageMold').value=m.number;$('manageCar').value=m.car;$('managePart').value=m.part;$('moldForm').scrollIntoView({block:'center'});}));$('moldPage').textContent=(r.total?moldOffset+1:0)+'–'+Math.min(moldOffset+100,r.total)+' / '+r.total;$('moldPrev').disabled=moldOffset===0;$('moldNext').disabled=moldOffset+100>=r.total;}
 try {me=await WorklogSecurity.requireWorker();if(!me)return;if(me.role!=='admin'){location.replace('/');return;}$('adminIdentity').textContent=me.name+' · '+me.department+' · '+me.team;$('adminContent').hidden=false;await loadEmployees();const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=t=>p.find(x=>x.type===t).value;const today=v('year')+'-'+v('month')+'-'+v('day');$('reportFrom').value=today;$('reportTo').value='';await loadReport();}
 catch(e){message(e.message,true);$('adminContent').hidden=false;return;}
 for(const b of document.querySelectorAll('[data-panel]'))b.addEventListener('click',()=>{for(const item of document.querySelectorAll('[data-panel]')){const selected=item===b;item.setAttribute('aria-pressed',String(selected));$(item.dataset.panel).hidden=!selected;}message('');if(b.dataset.panel==='moldPanel')run(loadMolds);});
 $('reportForm').addEventListener('submit',e=>{e.preventDefault();reportOffset=0;run(loadReport,e.submitter);});
 $('reportDepartment').addEventListener('change',filterEmployees);
 $('reportExport').addEventListener('click',e=>run(exportReport,e.currentTarget));
 $('reportPrev').addEventListener('click',()=>{reportOffset=Math.max(0,reportOffset-200);run(loadReport);});$('reportNext').addEventListener('click',()=>{if(reportOffset+200<reportTotal){reportOffset+=200;run(loadReport);}});
 $('newEmployee').addEventListener('click',()=>{$('employeeForm').reset();$('manageNumber').readOnly=false;$('manageNumber').focus();});
 $('employeeForm').addEventListener('submit',e=>{e.preventDefault();const data={employee_no:$('manageNumber').value,name:$('manageName').value.trim(),department:$('manageDepartment').value,team:$('manageTeam').value.trim(),active:$('manageActive').value==='true'};if(!confirm(data.name+' ('+data.employee_no+') 직원 정보를 저장할까요?'))return;run(async()=>{await api('employee-save',{row:data});message('직원 정보를 저장했습니다. 해당 직원은 다시 로그인해 주세요.');if(data.employee_no===me.employee_no){location.replace('/login.html');return;}await loadEmployees();},e.submitter);});
 $('resetForm').addEventListener('submit',e=>{e.preventDefault();const number=$('resetEmployee').value;if(!confirm(number+' 작업자의 비밀번호를 사번으로 초기화하고 기존 로그인을 종료할까요?'))return;run(async()=>{try{await api('reset',{employee_no:number,current_password:$('adminPassword').value});message('초기화했습니다. 다음 로그인 후 비밀번호 변경이 필요합니다.');await loadEmployees();}finally{$('adminPassword').value='';}},e.submitter);});
 $('moldSearchForm').addEventListener('submit',e=>{e.preventDefault();moldOffset=0;run(loadMolds,e.submitter);});
 $('moldForm').addEventListener('submit',e=>{e.preventDefault();const data={number:$('manageMold').value,car:$('manageCar').value.trim(),part:$('managePart').value.trim()};if(!confirm(data.number+' 금형 기준정보를 저장할까요?'))return;run(async()=>{await api('mold-save',{row:data});message('금형 기준정보를 저장했습니다.');await loadMolds();},e.submitter);});
 $('moldUpload').addEventListener('change',e=>run(()=>prepareMolds(e.target.files[0])));
 $('moldReplace').addEventListener('click',e=>{if(!importRows)return;const count=importRows.length;if(!confirm('기존 금형 정보 전체를 삭제하고 '+count+'건으로 교체할까요? 이 작업은 되돌릴 수 없습니다.'))return;run(async()=>{const result=await api('mold-replace',{rows:importRows});message('금형 정보 업데이트 완료 · 기존 '+result.previous+'건 → 새 '+result.count+'건');importRows=null;$('moldUpload').value='';$('moldPreview').textContent='';moldOffset=0;await loadMolds();},e.currentTarget);});
 $('moldPrev').addEventListener('click',()=>{moldOffset=Math.max(0,moldOffset-100);run(loadMolds);});$('moldNext').addEventListener('click',()=>{if(moldOffset+100<moldTotal){moldOffset+=100;run(loadMolds);}});
})();
