(function () {
  "use strict";

  var CONFIG = { MAX_TASKS:10, MAX_TOTAL_MINUTES:1440 };
  var CATEGORY_OPTIONS = {}, CLASSIFICATION_OPTIONS = [], CODE_OPTIONS = {}, EQUIPMENT_OPTIONS = {};
  var currentWorker = null;
  var loggedAccount = null, proxyMode = false;

  var form = document.getElementById("worklogForm");
  var taskList = document.getElementById("taskList");
  var taskTemplate = document.getElementById("taskTemplate");
  var departmentInput = document.getElementById("department");
  var teamInput = document.getElementById("team");
  var workDateInput = document.getElementById("workDate");
  var workerNameInput = document.getElementById("workerName");
  var employeeIdInput = document.getElementById("employeeId");
  var addTaskBottom = document.getElementById("addTaskBottom");
  var taskCount = document.getElementById("taskCount");
  var totalMinutes = document.getElementById("totalMinutes");
  var submitButton = document.getElementById("submitButton");
  var submitButtonLabel = submitButton.querySelector(".button-label");
  var appStatus = document.getElementById("appStatus");
  var networkBanner = document.getElementById("networkBanner");
  var conflictAction = document.getElementById("conflictAction");
  var newSubmissionButton = document.getElementById("newSubmissionButton");
  var viewToggle = document.getElementById("viewToggle");
  var lookupView = document.getElementById("lookupView");
  var lookupForm = document.getElementById("lookupForm");
  var lookupPeriodType = document.getElementById("lookupPeriodType");
  var lookupDayField = document.getElementById("lookupDayField");
  var lookupMonthField = document.getElementById("lookupMonthField");
  var lookupDateInput = document.getElementById("lookupDate");
  var lookupMonthInput = document.getElementById("lookupMonth");
  var lookupDepartmentInput = document.getElementById("lookupDepartment");
  var lookupTeamInput = document.getElementById("lookupTeam");
  var lookupWorkerNameInput = document.getElementById("lookupWorkerName");
  var lookupEmployeeIdInput = document.getElementById("lookupEmployeeId");
  var lookupButton = document.getElementById("lookupButton");
  var lookupButtonLabel = lookupButton.querySelector(".lookup-button-label");
  var lookupResults = document.getElementById("lookupResults");
  var lookupMessage = document.getElementById("lookupMessage");
  var lookupResultList = document.getElementById("lookupResultList");
  var lookupGrandTotal = document.getElementById("lookupGrandTotal");

  var taskSequence = 0;
  var taskStates = new Map();
  var isSubmitting = false;
  var isLookingUp = false;
  var submissionId = createSubmissionId();
  var mobileTaskLayout = window.matchMedia("(max-width: 767px)");

  function createSubmissionId() { return crypto.randomUUID(); }

  function getKoreanToday() {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
    var values = {}; parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function shiftIsoDate(iso, days) {
    var p = iso.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2,"0") + "-" + String(d.getUTCDate()).padStart(2,"0");
  }

  function cleanText(value, max) { return String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().slice(0, max); }
  function showStatus(message, type) { appStatus.textContent = message; appStatus.className = "app-status " + (type || "info"); appStatus.hidden = false; }
  function hideStatus() { appStatus.hidden = true; appStatus.textContent = ""; appStatus.className = "app-status"; }
  function focusStatus() { appStatus.focus({ preventScroll:true }); appStatus.scrollIntoView({ behavior:"smooth", block:"center" }); }
  function hideConflictAction() { conflictAction.hidden = true; newSubmissionButton.dataset.confirm = "0"; newSubmissionButton.textContent = "확인 후 현재 화면을 새 제출로 전환"; }

  function optionObjects(list) { return (list || []).map(function (item) { return { value:item[0], label:item[0] + " · " + item[1] }; }); }
  function setSelectOptions(select, options, placeholder, selectedValues, compactSelected) {
    var selected = Array.isArray(selectedValues) ? selectedValues.map(String) : [String(selectedValues || "")];
    select.replaceChildren();
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
    menu.replaceChildren();
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

  function applyIdentity() {
    [[departmentInput,lookupDepartmentInput,"department"],[teamInput,lookupTeamInput,"team"],[workerNameInput,lookupWorkerNameInput,"name"],[employeeIdInput,lookupEmployeeIdInput,"employee_no"]].forEach(function(pair) {
      pair[0].value = currentWorker[pair[2]]; pair[1].value = currentWorker[pair[2]];
    });
  }

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
      setLookupValues(article,"",""); setLookupState(article,"no-mold","미등록 작업");
      renderDepartmentOptions(article,"H",codes,classes,equipment); return;
    }
    setDropdownDisabled(process, false); renderDepartmentOptions(article,category,codes,classes,equipment);
  }

  async function lookupMold(article) {
    var mold = article.querySelector(".mold-input").value;
    if (!/^[0-9]{5}$/.test(mold)) return;
    setLookupValues(article,"",""); setLookupState(article,"loading","조회 중");
    try {
      var record = await WorklogSecurity.api("/api/mold", { number:mold });
      if (!article.isConnected || article.querySelector(".mold-input").value !== mold) return;
      if (!record) { setLookupState(article,"not-found","조회 실패"); return; }
      setLookupValues(article,record.car,record.part); setLookupState(article,"found","조회 성공");
    } catch (error) {
      if (article.isConnected && article.querySelector(".mold-input").value === mold) setLookupState(article,"error","조회 실패");
    }
  }

  function configureTaskIds(article, id) {
    article.querySelector(".task-body").id = "task-body-" + id;
    article.querySelector(".task-toggle").setAttribute("aria-controls", "task-body-" + id);
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
      var digits = moldInput.value.replace(/\D/g,"").slice(0,5); moldInput.value = digits; window.clearTimeout(taskStates.get(article).lookupTimer); setLookupValues(article,"",""); setLookupState(article,"idle","조회 중"); updateMoldMode(article,true);
      if (digits.length === 5) taskStates.get(article).lookupTimer = window.setTimeout(function () { lookupMold(article); },120);
      else if (digits.length) { setLookupValues(article,"",""); setLookupState(article,"idle","조회 실패"); }
      
    });
    var timeInput = article.querySelector(".time-input");
    function changeTime(delta) {
      var current = Number(timeInput.value) || 30;
      timeInput.value = String(Math.min(1440, Math.max(10, current + delta)));
      updateTotalMinutes(); 
    }
    function normalizeTime() {
      var minutes = Number(timeInput.value);
      if (!Number.isFinite(minutes)) minutes = 10;
      timeInput.value = String(Math.min(1440, Math.max(10, Math.round(minutes / 10) * 10)));
      updateTotalMinutes(); 
    }
    article.querySelector(".time-minus").addEventListener("click", function () { changeTime(-10); });
    article.querySelector(".time-plus").addEventListener("click", function () { changeTime(10); });
    timeInput.addEventListener("input", function () { updateTotalMinutes(); });
    timeInput.addEventListener("change", normalizeTime);
    var categoryInput = article.querySelector(".category-select");
    categoryInput.addEventListener("focus", function () { restoreSelectLabels(categoryInput); });
    categoryInput.addEventListener("blur", function () { compactSelectValue(categoryInput); });
    categoryInput.addEventListener("change", function () {
      renderCodeOptions(article, selectedValues(".code-select", article));
      compactSelectValue(categoryInput);
      
    });
    article.querySelector(".remark-input").addEventListener("input",function (event) { article.querySelector(".remark-count").textContent = event.target.value.length + "/240"; });
    article.addEventListener("input", function () { updateTaskSummary(article); });
    article.addEventListener("change", function () { updateTaskSummary(article); });
    article.querySelector(".task-toggle").addEventListener("click", function () {
      if (!mobileTaskLayout.matches) return;
      if (article.querySelector(".task-body").hidden) activateTask(article);
      else setTaskCollapsed(article, true);
    });
    article.querySelector(".collapse-task").addEventListener("click", function () {
      setTaskCollapsed(article, true); article.querySelector(".task-toggle").focus({preventScroll:true}); article.scrollIntoView({behavior:"smooth",block:"start"});
    });
    article.querySelector(".add-next-task").addEventListener("click", addTaskForEditing);
    article.querySelector(".remove-task").addEventListener("click",function () {
      if (taskList.children.length <= 1) { showStatus("최소 1개의 작업 항목은 유지해야 합니다.","error"); return; }
      var neighbor = article.nextElementSibling || article.previousElementSibling;
      window.clearTimeout(taskStates.get(article).lookupTimer); taskStates.delete(article); article.remove();
      updateTaskNumbers(); updateTotalMinutes(); 
      if (mobileTaskLayout.matches && neighbor) { activateTask(neighbor); neighbor.querySelector(".task-toggle").focus({preventScroll:true}); }
    });
    taskList.appendChild(article); updateMoldMode(article,true); if (moldInput.value.length === 5) lookupMold(article); updateTaskNumbers(); updateTotalMinutes(); return article;
  }

  function updateTaskSummary(article) {
    var mold = article.querySelector(".mold-input").value, processes = selectedValues(".process-select",article), codes = selectedValues(".code-select",article);
    var category = article.querySelector(".category-select").value, minutes = Number(article.querySelector(".time-input").value);
    var parts = [mold ? mold + (processes.length ? "-" + processes.join(",") : "") : "미등록 작업"];
    if (category) parts.push(category + (codes.length ? " / " + codes.join(",") : ""));
    parts.push(Number.isFinite(minutes) && minutes > 0 ? formatWorkMinutes(minutes) : "시간 미입력");
    if (!category || !codes.length) parts.push("선택 필요");
    article.querySelector(".task-summary").textContent = parts.join(" · ");
  }
  function setTaskCollapsed(article, collapsed) {
    var shouldCollapse = mobileTaskLayout.matches && collapsed;
    if (shouldCollapse) closeOtherDropdowns(null);
    article.classList.toggle("is-collapsed", shouldCollapse);
    article.querySelector(".task-body").hidden = shouldCollapse;
    var toggle = article.querySelector(".task-toggle");
    toggle.disabled = !mobileTaskLayout.matches;
    toggle.setAttribute("aria-expanded", String(!shouldCollapse));
    article.querySelector(".task-toggle-label").textContent = shouldCollapse ? "수정 ▾" : "접기 ▴";
    updateTaskSummary(article);
  }
  function activateTask(article) {
    Array.from(taskList.querySelectorAll(".task-card")).forEach(function (item) { setTaskCollapsed(item, item !== article); });
  }
  function addTaskForEditing() {
    var article = createTask();
    if (!article) return;
    activateTask(article);
    article.scrollIntoView({behavior:"smooth",block:"start"});
    article.querySelector(mobileTaskLayout.matches ? ".task-toggle" : ".mold-input").focus({preventScroll:true});
    
  }
  function updateTaskNumbers() {
    var articles = Array.from(taskList.querySelectorAll(".task-card"));
    articles.forEach(function (article,index) {
      article.querySelector(".task-number").textContent = "작업 " + (index + 1);
      article.querySelector(".task-toggle").disabled = !mobileTaskLayout.matches;
      var remove = article.querySelector(".remove-task"); remove.hidden = articles.length === 1; remove.setAttribute("aria-label","작업 " + (index + 1) + " 삭제");
      article.querySelector(".add-next-task").disabled = articles.length >= Number(CONFIG.MAX_TASKS || 10);
      updateTaskSummary(article);
    });
    taskCount.textContent = String(articles.length); var atLimit = articles.length >= Number(CONFIG.MAX_TASKS || 10); addTaskBottom.disabled = atLimit; addTaskBottom.textContent = atLimit ? "작업 항목 최대 10개" : "＋ 작업 항목 추가";
  }
  function updateTotalMinutes() { var total = Array.from(taskList.querySelectorAll(".time-input")).reduce(function (sum,input) { var value = Number(input.value); return sum + (Number.isFinite(value) && value > 0 ? value : 0); },0); totalMinutes.textContent = String(Math.round(total)); taskList.querySelectorAll(".task-card").forEach(updateTaskSummary); return total; }
  function clearValidationState() { form.querySelectorAll("[aria-invalid='true']").forEach(function (e) { e.removeAttribute("aria-invalid"); }); form.querySelectorAll(".has-error").forEach(function (e) { e.classList.remove("has-error"); }); }
  function markInvalid(element) { if (!element) return; element.setAttribute("aria-invalid","true"); var group = element.closest(".field-group"); if (group) group.classList.add("has-error"); }
  function validateForm() {
    clearValidationState(); var errors = [], firstInvalid = null;
    [workDateInput,departmentInput,teamInput,workerNameInput,employeeIdInput].forEach(function (input) { if (!input.value || !input.checkValidity()) { markInvalid(input); errors.push("작업자 필수 정보를 확인해 주세요."); firstInvalid = firstInvalid || input; } });
    Array.from(taskList.querySelectorAll(".task-card")).forEach(function (article,index) {
      var n = index + 1, moldInput = article.querySelector(".mold-input"), mold = moldInput.value, category = article.querySelector(".category-select"), code = article.querySelector(".code-select"), time = article.querySelector(".time-input"), state = taskStates.get(article);
      if (mold && !/^[0-9]{5}$/.test(mold)) { markInvalid(moldInput); errors.push("작업 " + n + "의 금형번호를 숫자 5자리로 입력해 주세요."); firstInvalid = firstInvalid || moldInput; }
      else if (mold && state.lookupState !== "found") { markInvalid(moldInput); errors.push("작업 " + n + "의 금형 조회 결과를 확인해 주세요."); firstInvalid = firstInvalid || moldInput; }
      if (!mold && category.value !== "H") { markInvalid(category); errors.push("작업 " + n + "은 금형번호가 없어 작업구분을 기타로 선택해야 합니다."); firstInvalid = firstInvalid || category; }
      if (!category.value) { markInvalid(category); errors.push("작업 " + n + "의 작업구분을 선택해 주세요."); firstInvalid = firstInvalid || category; }
      if (!selectedValues(".code-select",article).length) { markInvalid(code); errors.push("작업 " + n + "의 작업코드를 하나 이상 선택해 주세요."); firstInvalid = firstInvalid || code.querySelector(".multi-dropdown-toggle"); }
      var minutes = Number(time.value); if (!Number.isInteger(minutes) || minutes < 10 || minutes > 1440 || minutes % 10 !== 0) { markInvalid(time); errors.push("작업 " + n + "의 시간은 10분 단위로 입력해 주세요."); firstInvalid = firstInvalid || time; }
    });
    if (updateTotalMinutes() > Number(CONFIG.MAX_TOTAL_MINUTES || 1440)) { errors.push("이번 등록의 총 작업시간은 1,440분을 넘을 수 없습니다."); firstInvalid = firstInvalid || taskList.querySelector(".time-input"); }
    if (!errors.length) return true;
    showStatus(errors[0] + (errors.length > 1 ? " 외 " + (errors.length - 1) + "건을 확인해 주세요." : ""),"error"); focusStatus();
    if (firstInvalid) {
      var invalidTask = firstInvalid.closest(".task-card"); if (invalidTask) activateTask(invalidTask);
      window.setTimeout(function () { firstInvalid.focus({preventScroll:true}); firstInvalid.scrollIntoView({behavior:"smooth",block:"center"}); },200);
    }
    return false;
  }

  function buildRows() {
    return Array.from(taskList.querySelectorAll(".task-card")).map(function(article) {
      return {
        mold:article.querySelector(".mold-input").value || null,
        processes:selectedValues(".process-select",article),
        cat:article.querySelector(".category-select").value,
        codes:selectedValues(".code-select",article),
        classification:selectedValues(".classification-select",article),
        equipment:selectedValues(".equipment-select",article),
        time:Number(article.querySelector(".time-input").value),
        remark:article.querySelector(".remark-input").value.trim()
      };
    });
  }
  function submitRows(rows) {
    var payload = { submission_id:submissionId, date:workDateInput.value, tasks:rows };
    return proxyMode ? WorklogSecurity.api("/api/admin-submit", {employee_no:currentWorker.employee_no,payload:payload}) : WorklogSecurity.api("/api/submit",payload);
  }

  function formatWorkMinutes(value) {
    var minutes = Math.max(0, Number(value) || 0);
    return Math.floor(minutes / 60) + "H " + (minutes % 60) + "M";
  }
  function formatWorkDate(value) {
    var parts = String(value || "").split("-");
    if (parts.length !== 3) return String(value || "");
    var dayNames = ["일","월","화","수","목","금","토"];
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return parts[0] + "." + parts[1] + "." + parts[2] + " (" + dayNames[date.getDay()] + ")";
  }
  function lookupRange() {
    if (lookupPeriodType.value === "month") {
      var parts = lookupMonthInput.value.split("-").map(Number);
      if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
      var lastDay = new Date(parts[0], parts[1], 0).getDate();
      return { from:lookupMonthInput.value + "-01", to:lookupMonthInput.value + "-" + String(lastDay).padStart(2,"0") };
    }
    return lookupDateInput.value ? { from:lookupDateInput.value, to:lookupDateInput.value } : null;
  }
  function updateLookupPeriodFields() {
    var monthly = lookupPeriodType.value === "month";
    lookupDayField.hidden = monthly; lookupDateInput.disabled = monthly;
    lookupMonthField.hidden = !monthly; lookupMonthInput.disabled = !monthly;
  }
  function setLookupLoading(value) {
    isLookingUp = value;
    lookupButton.disabled = value || !navigator.onLine;
    lookupButton.classList.toggle("is-loading", value);
    lookupButtonLabel.textContent = value ? "조회 중" : "조회하기";
  }
  function renderLookupRows(rows) {
    lookupResultList.replaceChildren();
    var total = rows.reduce(function (sum, row) { return sum + (Number(row.total_minutes) || 0); }, 0);
    lookupGrandTotal.textContent = formatWorkMinutes(total);
    lookupResults.hidden = false;
    lookupMessage.className = "lookup-message";
    if (!rows.length) {
      lookupMessage.textContent = "선택한 기간에 등록된 작업이 없습니다.";
      return;
    }
    lookupMessage.textContent = rows.length + "일의 근무시간을 조회했습니다.";
    rows.forEach(function (row) {
      var item = document.createElement("li"), date = document.createElement("time"), meta = document.createElement("span"), duration = document.createElement("strong");
      date.dateTime = row.work_date; date.textContent = formatWorkDate(row.work_date);
      meta.textContent = Number(row.task_count || 0) + "건";
      duration.textContent = formatWorkMinutes(row.total_minutes);
      item.appendChild(date); item.appendChild(meta); item.appendChild(duration); lookupResultList.appendChild(item);
    });
  }
  function requestLookupSummary(range) {
    if (proxyMode) return WorklogSecurity.api("/api/admin-report", {from:range.from,to:range.to,employee_no:currentWorker.employee_no}).then(function(r){return r.summary;});
    return WorklogSecurity.api("/api/summary", { from:range.from, to:range.to });
  }
  async function handleLookup(event) {
    event.preventDefault();
    lookupResults.hidden = false; lookupResultList.replaceChildren(); lookupGrandTotal.textContent = "0H 0M"; lookupMessage.className = "lookup-message";
    if (!navigator.onLine) { lookupMessage.textContent = "온라인 연결 후 조회해 주세요."; lookupMessage.classList.add("error"); return; }
    var range = lookupRange();
    if (!range) { lookupMessage.textContent = "조회 기간과 작업자를 모두 선택해 주세요."; lookupMessage.classList.add("error"); return; }
    setLookupLoading(true); lookupMessage.textContent = "근무시간을 조회하고 있습니다.";
    try { renderLookupRows(await requestLookupSummary(range)); }
    catch (error) { lookupMessage.textContent = error.name === "AbortError" ? "조회 응답 시간이 초과되었습니다. 다시 시도해 주세요." : error.message; lookupMessage.classList.add("error"); console.error("Worklog lookup failed", {status:error.status || null,code:error.payload && error.payload.code ? error.payload.code : null}); }
    finally { setLookupLoading(false); }
  }
  function switchView() {
    var showLookup = lookupView.hidden;
    if (showLookup) applyIdentity();
    form.hidden = showLookup; lookupView.hidden = !showLookup; conflictAction.hidden = true; hideStatus();
    viewToggle.textContent = showLookup ? "조회" : "일보";
    viewToggle.setAttribute("aria-pressed", String(showLookup));
    viewToggle.setAttribute("aria-label", showLookup ? "작업일보 작성 화면으로 전환" : "작업 조회 화면으로 전환");
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function setSubmitting(value) { isSubmitting = value; document.getElementById("proxyEmployee").disabled = value; submitButton.classList.toggle("is-loading",value); submitButton.disabled = value || !navigator.onLine; submitButtonLabel.textContent = value ? "등록 중" : "작업일보 등록"; }
  function resetTasksAfterSuccess() { taskStates.forEach(function (state) { window.clearTimeout(state.lookupTimer); }); taskStates.clear(); taskList.replaceChildren(); submissionId = createSubmissionId(); createTask(); hideConflictAction(); }
  async function handleSubmit(event) {
    event.preventDefault(); if (isSubmitting) return; hideConflictAction(); if (!navigator.onLine) { showStatus("오프라인 상태입니다. 온라인 연결 후 등록해 주세요.","error"); focusStatus(); return; } if (!validateForm()) return;
    var rows = buildRows(), total = updateTotalMinutes(); setSubmitting(true); showStatus(rows.length + "개 작업을 등록하는 중입니다.","info");
    try { await submitRows(rows); resetTasksAfterSuccess(); showStatus(rows.length + "개 작업, 총 " + total + "분이 등록되었습니다.","success"); focusStatus(); if (navigator.vibrate) navigator.vibrate(35); }
    catch (error) { var conflict = Boolean(error.code === "CONFLICT"), message = error.name === "AbortError" ? "응답 시간이 초과되었습니다. 입력값을 바꾸지 말고 다시 등록해 주세요." : error.status ? error.message : "연결 응답을 확인하지 못했습니다. 연결 후 다시 등록해 주세요."; showStatus(message,"error"); conflictAction.hidden = !conflict; focusStatus(); console.error("Worklog submission failed",{status:error.status || null,code:error.payload && error.payload.code ? error.payload.code : null}); }
    finally { setSubmitting(false); }
  }

  function updateNetworkState() { var online = navigator.onLine; networkBanner.hidden = online; if (!isSubmitting) { submitButton.disabled = !online; submitButtonLabel.textContent = online ? "작업일보 등록" : "온라인 연결 필요"; } if (!isLookingUp) { lookupButton.disabled = !online; lookupButtonLabel.textContent = online ? "조회하기" : "온라인 연결 필요"; } if (online && appStatus.classList.contains("error") && /오프라인/.test(appStatus.textContent)) hideStatus(); }
  async function initialize() {
    try {
      currentWorker = await WorklogSecurity.requireWorker();
      if (!currentWorker) return;
      loggedAccount = currentWorker;
      proxyMode = loggedAccount.role === "admin" && new URLSearchParams(location.search).get("proxy") === "1";
      document.getElementById("adminLink").hidden = loggedAccount.role !== "admin";
      async function loadOptions(worker) {
        var options = await WorklogSecurity.api(proxyMode ? "/api/admin-options" : "/api/options", proxyMode ? {employee_no:worker.employee_no} : {});
        CATEGORY_OPTIONS[worker.department] = options.categories;
        CODE_OPTIONS[worker.department] = options.codes;
        EQUIPMENT_OPTIONS[worker.department] = options.equipment;
        CLASSIFICATION_OPTIONS = options.classifications;
      }
      await loadOptions(currentWorker);
      if (proxyMode) {
        document.getElementById("identityNote").textContent = "선택한 작업자의 정보가 자동 입력됩니다. 입력 중 내용은 새로고침하면 사라집니다.";
        var workers = (await WorklogSecurity.api("/api/admin-employees",{})).filter(function(w){return w.active && w.has_account;});
        var selector = document.getElementById("proxyEmployee");
        workers.forEach(function(w){selector.appendChild(new Option(w.department+" · "+w.team+" · "+w.name+" ("+w.employee_no+")",w.employee_no));});
        selector.value = currentWorker.employee_no;
        document.getElementById("proxyField").hidden = false;
        selector.addEventListener("change",async function(){
          var next = workers.find(function(w){return w.employee_no===selector.value;});
          if (!next || isSubmitting) return;
          selector.disabled = true; submitButton.disabled = true;
          try { await loadOptions(next); currentWorker = next; applyIdentity(); resetTasksAfterSuccess(); lookupResults.hidden = true; hideStatus(); }
          catch(error) { selector.value=currentWorker.employee_no; showStatus(error.message,"error"); }
          finally { selector.disabled=false; submitButton.disabled=!navigator.onLine; }
        });
      }
      applyIdentity();
      var today = getKoreanToday(); workDateInput.value = today;
      workDateInput.min = shiftIsoDate(today,-31); workDateInput.max = shiftIsoDate(today,1);
      lookupDateInput.value = today; lookupMonthInput.value = today.slice(0,7); updateLookupPeriodFields();
      createTask(); activateTask(taskList.lastElementChild);
      document.getElementById("authenticatedContent").hidden = false;
      mobileTaskLayout.addEventListener("change", function() {
        activateTask(taskList.querySelector(".task-card:not(.is-collapsed)") || taskList.lastElementChild);
      });
      addTaskBottom.addEventListener("click", addTaskForEditing);
      viewToggle.addEventListener("click", switchView);
      lookupPeriodType.addEventListener("change", updateLookupPeriodFields);
      lookupForm.addEventListener("submit", handleLookup);
      newSubmissionButton.addEventListener("click",function() {
        if (newSubmissionButton.dataset.confirm !== "1") {
          newSubmissionButton.dataset.confirm = "1"; newSubmissionButton.textContent = "기존 등록 확인 완료 — 새 제출";
          return;
        }
        submissionId = createSubmissionId(); hideConflictAction();
      });
      document.addEventListener("click",function(event) { if (!event.target.closest(".multi-dropdown")) closeOtherDropdowns(null); });
      document.addEventListener("keydown",function(event) { if (event.key === "Escape") closeOtherDropdowns(null); });
      form.addEventListener("submit",handleSubmit);
      window.addEventListener("online",updateNetworkState); window.addEventListener("offline",updateNetworkState);
      updateNetworkState();
    } catch(error) {
      if (error.status === 401 || error.code === "PIN_REQUIRED") return;
      document.getElementById("authenticatedContent").hidden = false;
      form.hidden = true; showStatus(error.message,"error");
    }
  }
  initialize();
})();

