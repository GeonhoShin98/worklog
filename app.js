(function () {
  "use strict";

  var CONFIG = window.WORKLOG_CONFIG || {};
  var STORAGE_KEYS = { sessionDraft: "worklog.sessionDraft.v3", localDraft: "worklog.localDraft.v3", profile: "worklog.profile.v3" };
  var CATEGORY_OPTIONS = {
    "사상반": [["B","초도"],["C","정규"],["D","ECO"],["E","ECR"],["F","생산지원"],["G","불량"],["H","기타"],["I","이관(출장)"]],
    "기계반": [["A","신작"],["C","수정"],["D","ECO"],["E","ECR"],["F","생산지원"],["G","불량"],["H","기타"]]
  };
  var CLASSIFICATION_OPTIONS = [["1","상형"],["2","하형"],["3","B/H"],["4","PAD"],["5","CAM"]];
  var CODE_OPTIONS = {
    "사상반": [["F","사상"],["D","D/S"],["T","T/O"],["S","SAMPLE"],["B","핸드워크"],["C","출장이동"],["E","기술지원"],["P","도색"],["W","작업진행"],["1","청소"],["2","교육/회의"],["3","대기"],["4","훈련"],["5","외출"],["6","장비고장"],["7","공구제작"],["8","기타"]],
    "기계반": [["M","면삭"],["C","COPY"],["G","윤곽가공"],["X","무인가공"],["W","작업진행"],["O","SET'G"],["1","청소"],["2","교육/회의"],["3","대기"],["4","훈련"],["5","외출"],["6","장비고장"],["7","공구제작"],["8","기타"]]
  };
  var EQUIPMENT_OPTIONS = {
    "사상반": [["11","30Ton"],["12","50Ton"],["13","100Ton"],["14","200Ton"],["15","400Ton"],["16","600Ton"],["17","800Ton"],["18","1000Ton"],["19","1200Ton"],["20","1500Ton"],["21","2000Ton"]],
    "기계반": [["1","MCR-A5C"],["2","MCR-BII"],["3","MCR-BⅢ"],["4","MCR-BⅢ"],["5","RB-4VM"],["6","RB-4NM"],["7","MCR-A5C"],["8","MCR-A5CⅡ"],["9","MCR-A5CⅡ"],["10","MCR-A5C"]]
  };

  var form = document.getElementById("worklogForm");
  var taskList = document.getElementById("taskList");
  var taskTemplate = document.getElementById("taskTemplate");
  var departmentInput = document.getElementById("department");
  var teamInput = document.getElementById("team");
  var workDateInput = document.getElementById("workDate");
  var workerNameInput = document.getElementById("workerName");
  var employeeIdInput = document.getElementById("employeeId");
  var rememberInput = document.getElementById("rememberDevice");
  var addTaskTop = document.getElementById("addTaskTop");
  var addTaskBottom = document.getElementById("addTaskBottom");
  var taskCount = document.getElementById("taskCount");
  var totalMinutes = document.getElementById("totalMinutes");
  var submitButton = document.getElementById("submitButton");
  var submitButtonLabel = submitButton.querySelector(".button-label");
  var appStatus = document.getElementById("appStatus");
  var networkBanner = document.getElementById("networkBanner");
  var conflictAction = document.getElementById("conflictAction");
  var newSubmissionButton = document.getElementById("newSubmissionButton");

  var taskSequence = 0;
  var taskStates = new Map();
  var moldMaster = {};
  var employeeMaster = [];
  var draftTimer = null;
  var isSubmitting = false;
  var configurationValid = true;
  var submissionId = createSubmissionId();

  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (v) { return v.toString(16).padStart(2, "0"); }).join("");
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
  }

  function getKoreanToday() {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
    var values = {}; parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function shiftIsoDate(iso, days) {
    var p = iso.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2,"0") + "-" + String(d.getUTCDate()).padStart(2,"0");
  }

  function safeJsonParse(value) { try { return value ? JSON.parse(value) : null; } catch (e) { return null; } }
  function storageGet(storage, key) { try { return storage.getItem(key); } catch (e) { return null; } }
  function storageSet(storage, key, value) { try { storage.setItem(key, value); } catch (e) { console.warn("Draft storage unavailable", e); } }
  function storageRemove(storage, key) { try { storage.removeItem(key); } catch (e) { return; } }
  function cleanText(value, max) { return String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().slice(0, max); }
  function showStatus(message, type) { appStatus.textContent = message; appStatus.className = "app-status " + (type || "info"); appStatus.hidden = false; }
  function hideStatus() { appStatus.hidden = true; appStatus.textContent = ""; appStatus.className = "app-status"; }
  function focusStatus() { appStatus.focus({ preventScroll:true }); appStatus.scrollIntoView({ behavior:"smooth", block:"center" }); }
  function hideConflictAction() { conflictAction.hidden = true; newSubmissionButton.dataset.confirm = "0"; newSubmissionButton.textContent = "확인 후 현재 화면을 새 제출로 전환"; }

  function optionObjects(list) { return (list || []).map(function (item) { return { value:item[0], label:item[0] + " · " + item[1] }; }); }
  function setSelectOptions(select, options, placeholder, selectedValues, compactSelected) {
    var selected = Array.isArray(selectedValues) ? selectedValues.map(String) : [String(selectedValues || "")];
    select.innerHTML = "";
    if (!select.multiple && placeholder) select.appendChild(new Option(placeholder, ""));
    options.forEach(function (option) { var item = new Option(option.label, option.value); item.dataset.fullLabel = option.label; item.selected = selected.indexOf(String(option.value)) >= 0; select.appendChild(item); });
    if (compactSelected) compactSelectValue(select);
  }
  function restoreSelectLabels(select) { Array.from(select.options).forEach(function (option) { if (option.dataset.fullLabel) option.textContent = option.dataset.fullLabel; }); }
  function compactSelectValue(select) { restoreSelectLabels(select); if (select.value && select.selectedOptions[0]) select.selectedOptions[0].textContent = select.value; }
  function updateDropdownSummary(dropdown) {
    var values = selectedValues(".self", dropdown);
    var toggle = dropdown.querySelector(".multi-dropdown-toggle");
    toggle.textContent = values.length ? values.join(", ") : dropdown.dataset.placeholder;
    toggle.title = values.length ? values.join(", ") : "";
    dropdown.classList.toggle("has-selection", values.length > 0);
  }

  function setDropdownOptions(dropdown, options, selectedValuesInput) {
    var selected = Array.isArray(selectedValuesInput) ? selectedValuesInput.map(String) : String(selectedValuesInput || "").split(",").filter(Boolean);
    var menu = dropdown.querySelector(".multi-dropdown-menu");
    menu.innerHTML = "";
    options.forEach(function (option) {
      var label = document.createElement("label");
      label.className = "multi-dropdown-option";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(option.value);
      input.dataset.label = option.label;
      input.checked = selected.indexOf(String(option.value)) >= 0;
      var text = document.createElement("span");
      text.textContent = option.label;
      label.appendChild(input); label.appendChild(text); menu.appendChild(label);
    });
    updateDropdownSummary(dropdown);
  }

  function setDropdownDisabled(dropdown, disabled) {
    dropdown.classList.toggle("is-disabled", disabled);
    dropdown.querySelector(".multi-dropdown-toggle").disabled = disabled;
    dropdown.querySelectorAll("input").forEach(function (input) { input.disabled = disabled; });
    if (disabled) { dropdown.querySelector(".multi-dropdown-menu").hidden = true; dropdown.querySelector(".multi-dropdown-toggle").setAttribute("aria-expanded", "false"); dropdown.classList.remove("is-open"); }
  }

  function clearDropdown(dropdown) {
    dropdown.querySelectorAll("input").forEach(function (input) { input.checked = false; });
    updateDropdownSummary(dropdown);
  }

  function closeOtherDropdowns(except) {
    document.querySelectorAll(".multi-dropdown").forEach(function (dropdown) {
      if (dropdown === except) return;
      dropdown.querySelector(".multi-dropdown-menu").hidden = true;
      dropdown.querySelector(".multi-dropdown-toggle").setAttribute("aria-expanded", "false");
      dropdown.classList.remove("is-open");
    });
  }

  function initializeDropdowns(article) {
    article.querySelectorAll(".multi-dropdown").forEach(function (dropdown) {
      var toggle = dropdown.querySelector(".multi-dropdown-toggle");
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        var menu = dropdown.querySelector(".multi-dropdown-menu");
        var willOpen = menu.hidden;
        closeOtherDropdowns(dropdown);
        menu.hidden = !willOpen;
        toggle.setAttribute("aria-expanded", String(willOpen));
        dropdown.classList.toggle("is-open", willOpen);
      });
      dropdown.addEventListener("change", function () { updateDropdownSummary(dropdown); });
    });
  }

  async function loadJson(path, message) {
    var url = new URL(path, window.location.href);
    url.searchParams.set("v", "20260824-5");
    var response = await fetch(url.toString(), { cache:"reload" });
    if (!response.ok) throw new Error(message);
    return response.json();
  }

  function populateDepartments(selected) {
    var values = ["사상반", "기계반"];
    employeeMaster.forEach(function (worker) { if (values.indexOf(worker.department) < 0) values.push(worker.department); });
    setSelectOptions(departmentInput, values.map(function (v) { return { value:v, label:v }; }), "선택해 주세요", selected);
  }
  function populateTeams(selected) {
    var values = Array.from(new Set(employeeMaster.filter(function (w) { return w.department === departmentInput.value; }).map(function (w) { return w.team; })));
    var preferredOrder = departmentInput.value === "사상반" ? ["A","B","C","D","E","기타"] : ["1","2"];
    values.sort(function (left, right) {
      var leftIndex = preferredOrder.indexOf(left), rightIndex = preferredOrder.indexOf(right);
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right, "ko");
    });
    setSelectOptions(teamInput, values.map(function (v) { return { value:v, label:v === "기타" ? v : v + "조" }; }), departmentInput.value ? "조 선택" : "소속을 먼저 선택해 주세요", selected);
    teamInput.disabled = !departmentInput.value;
  }
  function populateWorkers(selectedName, selectedId) {
    var workers = employeeMaster.filter(function (w) { return w.department === departmentInput.value && w.team === teamInput.value; });
    setSelectOptions(workerNameInput, workers.map(function (w) { return { value:w.employeeId, label:w.name }; }), teamInput.value ? "이름 선택" : "조를 먼저 선택해 주세요", selectedId);
    workerNameInput.disabled = !teamInput.value;
    if (selectedName && !workerNameInput.value) { var match = workers.find(function (w) { return w.name === selectedName; }); if (match) workerNameInput.value = match.employeeId; }
    applySelectedWorker();
  }
  function applySelectedWorker() { employeeIdInput.value = workerNameInput.value || ""; }

  function selectedValues(selector, article) {
    var element = selector === ".self" ? article : article.querySelector(selector);
    if (!element) return [];
    if (element.tagName === "SELECT") return Array.from(element.selectedOptions).map(function (o) { return o.value; });
    return Array.from(element.querySelectorAll("input:checked")).map(function (input) { return input.value; });
  }
  function setLookupState(article, state, message) { var data = taskStates.get(article); if (!data) return; data.lookupState = state; article.dataset.lookup = state; article.querySelector(".lookup-status").textContent = message; }
  function setLookupValues(article, car, part) { var data = taskStates.get(article); if (!data) return; data.car = cleanText(car,120); data.part = cleanText(part,180); article.querySelector(".car-value").textContent = data.car || "—"; article.querySelector(".part-value").textContent = data.part || "—"; }

  function renderCodeOptions(article, selectedCodes) {
    var category = article.querySelector(".category-select").value;
    var options = optionObjects(CODE_OPTIONS[departmentInput.value]).filter(function (option) {
      var numericCode = /^[1-8]$/.test(option.value);
      return category === "H" ? numericCode : !numericCode;
    });
    setDropdownOptions(article.querySelector(".code-select"), options, selectedCodes || []);
  }

  function renderDepartmentOptions(article, category, codes, classifications, equipment) {
    var department = departmentInput.value;
    var noMold = article.querySelector(".mold-input").value === "";
    var categories = optionObjects(CATEGORY_OPTIONS[department]);
    if (noMold) categories = categories.filter(function (item) { return item.value === "H"; });
    setSelectOptions(article.querySelector(".category-select"), categories, "선택", noMold ? "H" : category, true);
    setDropdownOptions(article.querySelector(".classification-select"), optionObjects(CLASSIFICATION_OPTIONS), classifications || []);
    renderCodeOptions(article, codes || []);
    setDropdownOptions(article.querySelector(".equipment-select"), optionObjects(EQUIPMENT_OPTIONS[department]), equipment || []);
  }

  function updateMoldMode(article, preserve) {
    var mold = article.querySelector(".mold-input").value;
    var process = article.querySelector(".process-select");
    var category = preserve ? article.querySelector(".category-select").value : "";
    var codes = selectedValues(".code-select", article), classes = selectedValues(".classification-select", article), equipment = selectedValues(".equipment-select", article);
    if (!mold) {
      clearDropdown(process); setDropdownDisabled(process, true);
      setLookupValues(article,"",""); setLookupState(article,"no-mold","금형 미입력 작업");
      renderDepartmentOptions(article,"H",codes,classes,equipment); return;
    }
    setDropdownDisabled(process, false); renderDepartmentOptions(article,category,codes,classes,equipment);
  }

  function lookupMold(article) {
    var mold = article.querySelector(".mold-input").value;
    if (!/^[0-9]{5}$/.test(mold)) { setLookupValues(article,"",""); setLookupState(article,"idle","금형번호는 숫자 5자리여야 합니다."); return; }
    var record = moldMaster[mold];
    if (Array.isArray(record)) record = record[0];
    if (!record) { setLookupValues(article,"",""); setLookupState(article,"not-found","swmdata에서 금형번호를 찾지 못했습니다."); return; }
    setLookupValues(article,record.car,record.part); setLookupState(article,"found","조회 완료");
  }

  function configureTaskIds(article, id) {
    [[".mold-input",".dynamic-label","mold-"],[".process-select",".process-label","process-"],[".category-select",".category-label","category-"],[".classification-select",".classification-label","classification-"],[".code-select",".code-label","code-"],[".equipment-select",".equipment-label","equipment-"],[".time-input",".time-label","time-"],[".remark-input",".remark-label","remark-"]].forEach(function (pair) {
      var input = article.querySelector(pair[0]), label = article.querySelector(pair[1]);
      var focusable = input.classList.contains("multi-dropdown") ? input.querySelector(".multi-dropdown-toggle") : input;
      focusable.id = pair[2] + id; focusable.name = focusable.id; label.htmlFor = focusable.id;
    });
    var status = article.querySelector(".lookup-status"); status.id = "mold-status-" + id; article.querySelector(".mold-input").setAttribute("aria-describedby",status.id);
  }

  function createTask(initialData) {
    if (taskList.children.length >= Number(CONFIG.MAX_TASKS || 10)) { showStatus("작업 항목은 최대 10개까지 등록할 수 있습니다.","error"); return null; }
    var article = taskTemplate.content.firstElementChild.cloneNode(true), id = ++taskSequence, data = initialData || {};
    article.dataset.taskId = String(id); article.dataset.lookup = "idle"; configureTaskIds(article,id); initializeDropdowns(article); taskStates.set(article,{ lookupState:"idle",car:"",part:"",lookupTimer:null });
    var moldMatch = String(data.swmno || "").match(/^\d{5}/); article.querySelector(".mold-input").value = moldMatch ? moldMatch[0] : "";
    var processes = Array.isArray(data.proc) ? data.proc.map(String) : String(data.proc || "").split(",").filter(Boolean);
    setDropdownOptions(article.querySelector(".process-select"), ["1","2","3","4","5","6","7","8","9"].map(function (value) { return { value:value, label:value }; }), processes);
    renderDepartmentOptions(article,data.cat || "",data.code || [],data.classification || [],data.equipment || []);
    article.querySelector(".time-input").value = data.time === 0 || data.time ? String(data.time) : "30";
    article.querySelector(".remark-input").value = cleanText(data.remark,240); article.querySelector(".remark-count").textContent = article.querySelector(".remark-input").value.length + "/240";

    var moldInput = article.querySelector(".mold-input");
    moldInput.addEventListener("input",function () {
      var digits = moldInput.value.replace(/\D/g,"").slice(0,5); moldInput.value = digits; window.clearTimeout(taskStates.get(article).lookupTimer); updateMoldMode(article,true);
      if (digits.length === 5) taskStates.get(article).lookupTimer = window.setTimeout(function () { lookupMold(article); scheduleDraftSave(); },120);
      else if (digits.length) { setLookupValues(article,"",""); setLookupState(article,"idle","금형번호를 5자리까지 입력해 주세요."); }
      scheduleDraftSave();
    });
    var timeInput = article.querySelector(".time-input");
    function changeTime(delta) {
      var current = Number(timeInput.value) || 30;
      timeInput.value = String(Math.min(1440, Math.max(10, current + delta)));
      updateTotalMinutes(); scheduleDraftSave();
    }
    function normalizeTime() {
      var minutes = Number(timeInput.value);
      if (!Number.isFinite(minutes)) minutes = 10;
      timeInput.value = String(Math.min(1440, Math.max(10, Math.round(minutes / 10) * 10)));
      updateTotalMinutes(); scheduleDraftSave();
    }
    article.querySelector(".time-minus").addEventListener("click", function () { changeTime(-10); });
    article.querySelector(".time-plus").addEventListener("click", function () { changeTime(10); });
    timeInput.addEventListener("input", function () { updateTotalMinutes(); scheduleDraftSave(); });
    timeInput.addEventListener("change", normalizeTime);
    var categoryInput = article.querySelector(".category-select");
    categoryInput.addEventListener("focus", function () { restoreSelectLabels(categoryInput); });
    categoryInput.addEventListener("blur", function () { compactSelectValue(categoryInput); });
    categoryInput.addEventListener("change", function () {
      renderCodeOptions(article, selectedValues(".code-select", article));
      compactSelectValue(categoryInput);
      scheduleDraftSave();
    });
    article.querySelector(".remark-input").addEventListener("input",function (event) { article.querySelector(".remark-count").textContent = event.target.value.length + "/240"; scheduleDraftSave(); });
    article.addEventListener("change",scheduleDraftSave);
    article.querySelector(".remove-task").addEventListener("click",function () { if (taskList.children.length <= 1) { showStatus("최소 1개의 작업 항목은 유지해야 합니다.","error"); return; } window.clearTimeout(taskStates.get(article).lookupTimer); taskStates.delete(article); article.remove(); updateTaskNumbers(); updateTotalMinutes(); scheduleDraftSave(); });
    taskList.appendChild(article); updateMoldMode(article,true); if (moldInput.value.length === 5) lookupMold(article); updateTaskNumbers(); updateTotalMinutes(); return article;
  }

  function updateTaskNumbers() {
    var articles = Array.from(taskList.querySelectorAll(".task-card"));
    articles.forEach(function (article,index) { article.querySelector(".task-title").textContent = "작업 " + (index + 1); var remove = article.querySelector(".remove-task"); remove.hidden = articles.length === 1; remove.setAttribute("aria-label","작업 " + (index + 1) + " 삭제"); });
    taskCount.textContent = String(articles.length); var atLimit = articles.length >= Number(CONFIG.MAX_TASKS || 10); addTaskTop.disabled = atLimit; addTaskBottom.disabled = atLimit; addTaskBottom.textContent = atLimit ? "작업 항목 최대 10개" : "＋ 작업 항목 추가";
  }
  function updateTotalMinutes() { var total = Array.from(taskList.querySelectorAll(".time-input")).reduce(function (sum,input) { var value = Number(input.value); return sum + (Number.isFinite(value) && value > 0 ? value : 0); },0); totalMinutes.textContent = String(Math.round(total)); return total; }
  function clearValidationState() { form.querySelectorAll("[aria-invalid='true']").forEach(function (e) { e.removeAttribute("aria-invalid"); }); form.querySelectorAll(".has-error").forEach(function (e) { e.classList.remove("has-error"); }); }
  function markInvalid(element) { if (!element) return; element.setAttribute("aria-invalid","true"); var group = element.closest(".field-group"); if (group) group.classList.add("has-error"); }
  function composeRemark(article) {
    var tags = [], classes = selectedValues(".classification-select",article), equipment = selectedValues(".equipment-select",article);
    if (classes.length) tags.push("[작업분류:" + classes.join(",") + "]"); if (equipment.length) tags.push("[장비구분:" + equipment.join(",") + "]");
    var note = cleanText(article.querySelector(".remark-input").value,240); return cleanText(tags.concat(note ? [note] : []).join(" "),300) || null;
  }

  function validateForm() {
    clearValidationState(); var errors = [], firstInvalid = null;
    [workDateInput,departmentInput,teamInput,workerNameInput,employeeIdInput].forEach(function (input) { if (!input.value || !input.checkValidity()) { markInvalid(input); errors.push("작업자 필수 정보를 확인해 주세요."); firstInvalid = firstInvalid || input; } });
    Array.from(taskList.querySelectorAll(".task-card")).forEach(function (article,index) {
      var n = index + 1, moldInput = article.querySelector(".mold-input"), mold = moldInput.value, category = article.querySelector(".category-select"), code = article.querySelector(".code-select"), time = article.querySelector(".time-input"), state = taskStates.get(article);
      if (mold && !/^[0-9]{5}$/.test(mold)) { markInvalid(moldInput); errors.push("작업 " + n + "의 금형번호를 숫자 5자리로 입력해 주세요."); firstInvalid = firstInvalid || moldInput; }
      else if (mold && state.lookupState !== "found") { markInvalid(moldInput); errors.push("작업 " + n + "의 금형 조회 결과를 확인해 주세요."); firstInvalid = firstInvalid || moldInput; }
      if (!mold && category.value !== "H") { markInvalid(category); errors.push("작업 " + n + "은 금형번호가 없어 작업구분을 기타로 선택해야 합니다."); firstInvalid = firstInvalid || category; }
      if (!category.value) { markInvalid(category); errors.push("작업 " + n + "의 작업구분을 선택해 주세요."); firstInvalid = firstInvalid || category; }
      if (!selectedValues(".code-select",article).length) { markInvalid(code); errors.push("작업 " + n + "의 작업코드를 하나 이상 선택해 주세요."); firstInvalid = firstInvalid || code; }
      var minutes = Number(time.value); if (!Number.isInteger(minutes) || minutes < 10 || minutes > 1440 || minutes % 10 !== 0) { markInvalid(time); errors.push("작업 " + n + "의 시간은 10분 단위로 입력해 주세요."); firstInvalid = firstInvalid || time; }
    });
    if (updateTotalMinutes() > Number(CONFIG.MAX_TOTAL_MINUTES || 1440)) { errors.push("이번 등록의 총 작업시간은 1,440분을 넘을 수 없습니다."); firstInvalid = firstInvalid || taskList.querySelector(".time-input"); }
    if (!errors.length) return true;
    showStatus(errors[0] + (errors.length > 1 ? " 외 " + (errors.length - 1) + "건을 확인해 주세요." : ""),"error"); focusStatus(); if (firstInvalid) window.setTimeout(function () { firstInvalid.focus({preventScroll:true}); firstInvalid.scrollIntoView({behavior:"smooth",block:"center"}); },200); return false;
  }

  function buildRows() {
    var worker = employeeMaster.find(function (w) { return w.employeeId === workerNameInput.value; });
    return Array.from(taskList.querySelectorAll(".task-card")).map(function (article,index) {
      var mold = article.querySelector(".mold-input").value, processes = selectedValues(".process-select",article), state = taskStates.get(article);
      return { date:workDateInput.value, name:worker.name, Id:Number(worker.employeeId), swmno:mold ? mold + (processes.length ? "-" + processes.join(",") : "") : null, proc:processes.length ? processes.join(",") : null, car:mold ? state.car : null, part:mold ? state.part : null, cat:article.querySelector(".category-select").value, code:selectedValues(".code-select",article).join(","), time:Number(article.querySelector(".time-input").value), remark:composeRemark(article), submission_id:submissionId, line_no:index + 1 };
    });
  }

  function publicErrorMessage(status,payload) {
    var code = payload && payload.code ? payload.code : "", message = payload && payload.message ? payload.message : "";
    if (status === 401 || status === 403 || code === "42501") return "저장 권한이 없습니다. Supabase 설정 SQL을 다시 실행해 주세요.";
    if (status === 404 || code === "PGRST202" || code === "PGRST205") return "Supabase 저장 함수를 찾지 못했습니다. 설정 SQL을 먼저 실행해 주세요.";
    if (code === "23502" && /column\s+[\"']?no[\"']?/i.test(message)) return "Supabase의 no 컬럼 자동번호 설정을 확인해 주세요.";
    if (code === "23505") return "이미 등록된 값과 충돌했습니다. 잠시 후 다시 시도해 주세요.";
    if (code === "P0001") return "이전 제출과 현재 화면의 내용이 다릅니다. 기존 등록을 확인한 뒤 새 제출로 전환해 주세요.";
    if (status === 400 || code === "PGRST204" || code === "22023" || code === "23514") return "저장 값과 Supabase 설정이 맞지 않습니다. 최신 설정 SQL을 실행해 주세요.";
    return "등록하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  async function submitRows(rows) {
    var controller = new AbortController(), timeout = window.setTimeout(function () { controller.abort(); },Number(CONFIG.REQUEST_TIMEOUT_MS) || 15000), endpoint = new URL("/rest/v1/rpc/" + encodeURIComponent(CONFIG.WORKLOG_RPC),CONFIG.SUPABASE_URL);
    try { var response = await fetch(endpoint.toString(),{ method:"POST",headers:{ apikey:CONFIG.SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json",Accept:"application/json" },body:JSON.stringify({_rows:rows}),signal:controller.signal }); if (!response.ok) { var payload = null; try { payload = await response.json(); } catch (e) { payload = null; } var error = new Error(publicErrorMessage(response.status,payload)); error.status = response.status; error.payload = payload; throw error; } return response.json(); }
    finally { window.clearTimeout(timeout); }
  }
  function setSubmitting(value) { isSubmitting = value; submitButton.classList.toggle("is-loading",value); submitButton.disabled = value || !navigator.onLine || !configurationValid; submitButtonLabel.textContent = value ? "등록 중" : "작업일보 등록"; }
  function resetTasksAfterSuccess() { taskStates.forEach(function (state) { window.clearTimeout(state.lookupTimer); }); taskStates.clear(); taskList.innerHTML = ""; submissionId = createSubmissionId(); createTask(); storageRemove(sessionStorage,STORAGE_KEYS.sessionDraft); storageRemove(localStorage,STORAGE_KEYS.localDraft); hideConflictAction(); }
  async function handleSubmit(event) {
    event.preventDefault(); hideConflictAction(); if (!navigator.onLine) { showStatus("오프라인 상태입니다. 온라인 연결 후 등록해 주세요.","error"); focusStatus(); return; } if (!configurationValid || !validateForm()) return;
    var rows = buildRows(), total = updateTotalMinutes(); setSubmitting(true); showStatus(rows.length + "개 작업을 등록하는 중입니다.","info");
    try { await submitRows(rows); resetTasksAfterSuccess(); showStatus(rows.length + "개 작업, 총 " + total + "분이 등록되었습니다.","success"); focusStatus(); if (navigator.vibrate) navigator.vibrate(35); }
    catch (error) { var conflict = Boolean(error.payload && error.payload.code === "P0001"), message = error.name === "AbortError" ? "응답 시간이 초과되었습니다. 입력값을 바꾸지 말고 다시 등록해 주세요." : error.status ? error.message : "연결 응답을 확인하지 못했습니다. 연결 후 다시 등록해 주세요."; showStatus(message,"error"); conflictAction.hidden = !conflict; focusStatus(); console.error("Worklog submission failed",{status:error.status || null,code:error.payload && error.payload.code ? error.payload.code : null}); }
    finally { setSubmitting(false); scheduleDraftSave(); }
  }

  function serializeDraft() {
    var worker = employeeMaster.find(function (w) { return w.employeeId === workerNameInput.value; });
    return { version:3,savedAt:Date.now(),submissionId:submissionId,remember:rememberInput.checked,department:departmentInput.value,team:teamInput.value,date:workDateInput.value,name:worker ? worker.name : "",employeeId:employeeIdInput.value,tasks:Array.from(taskList.querySelectorAll(".task-card")).map(function (article) { var state = taskStates.get(article); return { swmno:article.querySelector(".mold-input").value,car:state.car,part:state.part,proc:selectedValues(".process-select",article),cat:article.querySelector(".category-select").value,classification:selectedValues(".classification-select",article),code:selectedValues(".code-select",article),equipment:selectedValues(".equipment-select",article),time:article.querySelector(".time-input").value,remark:article.querySelector(".remark-input").value }; }) };
  }
  function saveProfile() { if (!rememberInput.checked) { storageRemove(localStorage,STORAGE_KEYS.profile); return; } storageSet(localStorage,STORAGE_KEYS.profile,JSON.stringify({version:3,savedAt:Date.now(),department:departmentInput.value,team:teamInput.value,employeeId:employeeIdInput.value})); }
  function saveDraft() {
    var draft = serializeDraft(), hasTask = draft.tasks.some(function (t) { return Boolean(t.swmno || t.proc.length || t.classification.length || t.code.length || t.equipment.length || t.remark || (t.time && String(t.time) !== "30")); }), hasIdentity = Boolean(draft.department || draft.team || draft.employeeId || (draft.date && draft.date !== getKoreanToday()));
    if (!hasTask && !hasIdentity) { storageRemove(sessionStorage,STORAGE_KEYS.sessionDraft); storageRemove(localStorage,STORAGE_KEYS.localDraft); saveProfile(); return; }
    storageSet(sessionStorage,STORAGE_KEYS.sessionDraft,JSON.stringify(draft)); if (rememberInput.checked) { storageSet(localStorage,STORAGE_KEYS.localDraft,JSON.stringify(draft)); saveProfile(); } else { storageRemove(localStorage,STORAGE_KEYS.localDraft); storageRemove(localStorage,STORAGE_KEYS.profile); }
  }
  function scheduleDraftSave() { window.clearTimeout(draftTimer); draftTimer = window.setTimeout(saveDraft,250); }
  function loadRestoredState() {
    var sessionDraft = safeJsonParse(storageGet(sessionStorage,STORAGE_KEYS.sessionDraft)), localDraft = safeJsonParse(storageGet(localStorage,STORAGE_KEYS.localDraft)), profile = safeJsonParse(storageGet(localStorage,STORAGE_KEYS.profile)), now = Date.now(), maxAge = 7 * 24 * 60 * 60 * 1000;
    function fresh(v) { var savedAt = Number(v && v.savedAt); return Boolean(v && v.version === 3 && savedAt > 0 && now >= savedAt && now - savedAt <= maxAge); }
    var draft = [sessionDraft,localDraft].filter(fresh).sort(function (a,b) { return b.savedAt - a.savedAt; })[0] || null, identity = draft || (fresh(profile) ? profile : null);
    if (identity) { departmentInput.value = identity.department || ""; populateTeams(identity.team || ""); populateWorkers(identity.name || "",identity.employeeId || ""); rememberInput.checked = Boolean(draft ? draft.remember : profile); }
    if (!draft) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.submissionId || "")) submissionId = draft.submissionId;
    workDateInput.value = draft.date || getKoreanToday(); if (Array.isArray(draft.tasks)) draft.tasks.slice(0,Number(CONFIG.MAX_TASKS || 10)).forEach(createTask); showStatus("저장된 작성 내용을 복원했습니다. 입력값을 확인해 주세요.","info"); return true;
  }
  function refreshTaskDepartmentOptions() { Array.from(taskList.querySelectorAll(".task-card")).forEach(function (article) { renderDepartmentOptions(article,"",[],selectedValues(".classification-select",article),[]); updateMoldMode(article,true); }); }
  function updateNetworkState() { var online = navigator.onLine; networkBanner.hidden = online; if (!isSubmitting) { submitButton.disabled = !online || !configurationValid; submitButtonLabel.textContent = !configurationValid ? "연결 설정 확인 필요" : online ? "작업일보 등록" : "온라인 연결 필요"; } if (online && appStatus.classList.contains("error") && /오프라인/.test(appStatus.textContent)) hideStatus(); }
  function validateConfiguration() { try { var url = new URL(CONFIG.SUPABASE_URL); return url.protocol === "https:" && /^sb_publishable_/.test(CONFIG.SUPABASE_PUBLISHABLE_KEY || "") && Boolean(CONFIG.WORKLOG_RPC); } catch (e) { return false; } }
  function registerServiceWorker() { if (!("serviceWorker" in navigator) || (location.protocol !== "https:" && location.hostname !== "localhost")) return; navigator.serviceWorker.register("./sw.js").catch(function (e) { console.warn("Service worker registration failed",e); }); }

  async function initialize() {
    var today = getKoreanToday(); workDateInput.value = today; workDateInput.min = shiftIsoDate(today,-31); workDateInput.max = shiftIsoDate(today,1);
    var loadErrors = [];
    try {
      var moldPayload = await loadJson(CONFIG.MOLD_MASTER_FILE,"금형 기준정보를 불러오지 못했습니다.");
      moldMaster = moldPayload.records || {};
      if (!Object.keys(moldMaster).length) throw new Error("금형 기준정보가 비어 있습니다.");
    } catch (moldError) { loadErrors.push(moldError.message); }
    try {
      var employeePayload = await loadJson(CONFIG.EMPLOYEE_MASTER_FILE,"작업자 기준정보를 불러오지 못했습니다.");
      employeeMaster = employeePayload.workers || [];
      if (!employeeMaster.length) throw new Error("작업자 기준정보가 비어 있습니다.");
    } catch (employeeError) { loadErrors.push(employeeError.message); }
    populateDepartments("");
    if (loadErrors.length) { showStatus(loadErrors.join(" ") + " 배포 파일을 확인해 주세요.","error"); configurationValid = false; }
    var restored = loadRestoredState(); if (!restored || !taskList.children.length) createTask(); configurationValid = configurationValid && validateConfiguration(); if (!configurationValid && appStatus.hidden) showStatus("Supabase 연결 또는 기준정보 설정을 확인해 주세요.","error");
    addTaskTop.addEventListener("click",function () { var article = createTask(); if (article) { article.scrollIntoView({behavior:"smooth",block:"start"}); article.querySelector(".mold-input").focus({preventScroll:true}); scheduleDraftSave(); } }); addTaskBottom.addEventListener("click",function () { addTaskTop.click(); });
    departmentInput.addEventListener("change",function () { populateTeams(""); populateWorkers("",""); refreshTaskDepartmentOptions(); scheduleDraftSave(); }); teamInput.addEventListener("change",function () { populateWorkers("",""); scheduleDraftSave(); }); workerNameInput.addEventListener("change",function () { applySelectedWorker(); scheduleDraftSave(); }); workDateInput.addEventListener("input",scheduleDraftSave);
    rememberInput.addEventListener("change",function () { saveDraft(); showStatus(rememberInput.checked ? "작업자 정보와 작성 중 내용을 이 기기에 7일간 저장합니다." : "7일 보관 자료를 삭제했습니다.","info"); });
    newSubmissionButton.addEventListener("click",function () { if (newSubmissionButton.dataset.confirm !== "1") { newSubmissionButton.dataset.confirm = "1"; newSubmissionButton.textContent = "기존 등록 확인 완료 — 새 제출 ID 만들기"; showStatus("기존 등록 내역을 확인했다면 버튼을 한 번 더 눌러 주세요.","info"); focusStatus(); return; } submissionId = createSubmissionId(); hideConflictAction(); scheduleDraftSave(); showStatus("현재 화면을 새 제출로 전환했습니다.","info"); focusStatus(); });
    document.addEventListener("click", function (event) { if (!event.target.closest(".multi-dropdown")) closeOtherDropdowns(null); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeOtherDropdowns(null); });
    form.addEventListener("submit",handleSubmit); window.addEventListener("online",updateNetworkState); window.addEventListener("offline",updateNetworkState); window.addEventListener("pagehide",saveDraft); updateTaskNumbers(); updateTotalMinutes(); updateNetworkState(); registerServiceWorker();
  }
  initialize();
})();
