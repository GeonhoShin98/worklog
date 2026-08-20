(function () {
  "use strict";

  var CONFIG = window.WORKLOG_CONFIG || {};
  var STORAGE_KEYS = {
    sessionDraft: "worklog.sessionDraft.v2",
    localDraft: "worklog.localDraft.v2",
    profile: "worklog.profile.v2"
  };
  var CATEGORY_OPTIONS = {
    "사상반": [
      { value: "B", label: "B · 초도" },
      { value: "C", label: "C · 정규" },
      { value: "D", label: "D · ECO" },
      { value: "E", label: "E · ECR" },
      { value: "F", label: "F · 생산지원" },
      { value: "G", label: "G · 불량" },
      { value: "H", label: "H · 기타" },
      { value: "I", label: "I · 이관(출장)" }
    ],
    "기계반": [
      { value: "A", label: "A · 신작" },
      { value: "C", label: "C · 수정" },
      { value: "D", label: "D · ECO" },
      { value: "E", label: "E · ECR" },
      { value: "F", label: "F · 생산지원" },
      { value: "G", label: "G · 불량" },
      { value: "H", label: "H · 기타" }
    ]
  };
  var CODE_OPTIONS = {
    "사상반": [
      { value: "F", label: "F · 사상" },
      { value: "D", label: "D · D/S" },
      { value: "T", label: "T · T/O" },
      { value: "S", label: "S · SAMPLE" },
      { value: "B", label: "B · 핸드워크" },
      { value: "C", label: "C · 출장이동" },
      { value: "E", label: "E · 기술지원" },
      { value: "P", label: "P · 도색" },
      { value: "W", label: "W · 작업진행" },
      { value: "1", label: "1 · 청소" },
      { value: "2", label: "2 · 교육/회의" },
      { value: "3", label: "3 · 대기" },
      { value: "4", label: "4 · 훈련" },
      { value: "5", label: "5 · 외출" },
      { value: "6", label: "6 · 장비고장" },
      { value: "7", label: "7 · 공구제작" },
      { value: "8", label: "8 · 기타" }
    ],
    "기계반": [
      { value: "M", label: "M · 면삭" },
      { value: "C", label: "C · COPY" },
      { value: "G", label: "G · 윤곽가공" },
      { value: "X", label: "X · 무인가공" },
      { value: "W", label: "W · 작업진행" },
      { value: "O", label: "O · SET'G" },
      { value: "1", label: "1 · 청소" },
      { value: "2", label: "2 · 교육/회의" },
      { value: "3", label: "3 · 대기" },
      { value: "4", label: "4 · 훈련" },
      { value: "5", label: "5 · 외출" },
      { value: "6", label: "6 · 장비고장" },
      { value: "7", label: "7 · 공구제작" },
      { value: "8", label: "8 · 기타" }
    ]
  };

  var form = document.getElementById("worklogForm");
  var taskList = document.getElementById("taskList");
  var taskTemplate = document.getElementById("taskTemplate");
  var departmentInput = document.getElementById("department");
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
  var moldMaster = null;
  var masterLoadError = null;
  var masterPromise = null;
  var draftTimer = null;
  var isSubmitting = false;
  var configurationValid = true;
  var submissionId = createSubmissionId();

  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  }

  function getKoreanToday() {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) {
      values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function shiftIsoDate(isoDate, days) {
    var parts = isoDate.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    var year = String(date.getUTCFullYear());
    var month = String(date.getUTCMonth() + 1).padStart(2, "0");
    var day = String(date.getUTCDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function safeJsonParse(value) {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function storageGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      console.warn("Draft storage is unavailable", error);
    }
  }

  function storageRemove(storage, key) {
    try {
      storage.removeItem(key);
    } catch (error) {
      return;
    }
  }

  function showStatus(message, type) {
    appStatus.textContent = message;
    appStatus.className = "app-status " + (type || "info");
    appStatus.hidden = false;
  }

  function hideStatus() {
    appStatus.hidden = true;
    appStatus.textContent = "";
    appStatus.className = "app-status";
  }

  function hideConflictAction() {
    conflictAction.hidden = true;
    newSubmissionButton.dataset.confirm = "0";
    newSubmissionButton.textContent = "확인 후 현재 화면을 새 제출로 전환";
  }

  function focusStatus() {
    appStatus.focus({ preventScroll: true });
    appStatus.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function cleanText(value, maxLength) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim()
      .slice(0, maxLength);
  }

  function setLookupState(article, state, message) {
    var taskState = taskStates.get(article);
    if (!taskState) {
      return;
    }
    taskState.lookupState = state;
    article.dataset.lookup = state;
    article.querySelector(".lookup-status").textContent = message;
  }

  function setLookupValues(article, car, part) {
    var taskState = taskStates.get(article);
    if (!taskState) {
      return;
    }
    taskState.car = cleanText(car, 120);
    taskState.part = cleanText(part, 180);
    article.querySelector(".car-value").textContent = taskState.car || "—";
    article.querySelector(".part-value").textContent = taskState.part || "—";
  }

  function resetLookup(article, message) {
    var candidateField = article.querySelector(".candidate-field");
    var candidateSelect = article.querySelector(".candidate-select");
    var unregisteredOption = article.querySelector(".unregistered-option");
    var allowUnregistered = article.querySelector(".allow-unregistered");
    candidateField.hidden = true;
    candidateSelect.required = false;
    candidateSelect.innerHTML = "";
    candidateSelect.appendChild(new Option("차종 · 품명을 선택해 주세요", ""));
    unregisteredOption.hidden = true;
    allowUnregistered.checked = false;
    setLookupValues(article, "", "");
    setLookupState(article, "idle", message || "5자리 숫자를 입력해 주세요.");
  }

  function normalizeCandidates(records) {
    var unique = new Map();
    (records || []).forEach(function (record) {
      var car = cleanText(record.car || record.car_model, 120);
      var part = cleanText(record.part || record.part_name, 180);
      if (!car && !part) {
        return;
      }
      var key = car + "\u0000" + part;
      if (!unique.has(key)) {
        unique.set(key, { car: car || "미등록차종", part: part || "미등록품명" });
      }
    });
    return Array.from(unique.values());
  }

  async function loadLocalMaster() {
    var response = await fetch(CONFIG.MOLD_MASTER_FILE, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("금형 기준정보 파일을 불러오지 못했습니다.");
    }
    var payload = await response.json();
    if (!payload || !payload.records) {
      throw new Error("금형 기준정보 형식이 올바르지 않습니다.");
    }
    moldMaster = payload.records;
    return moldMaster;
  }

  async function fetchRemoteCandidates(prefix) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, Number(CONFIG.REQUEST_TIMEOUT_MS) || 15000);
    var endpoint = new URL(
      "/rest/v1/" + encodeURIComponent(CONFIG.MOLD_MASTER_TABLE),
      CONFIG.SUPABASE_URL
    );
    endpoint.searchParams.set("select", "swmno,car_model,part_name");
    endpoint.searchParams.set("swmno", "like." + prefix + "*");
    endpoint.searchParams.set("limit", "50");
    try {
      var response = await fetch(endpoint.toString(), {
        headers: {
          apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY,
          Accept: "application/json"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error("금형 기준정보 조회에 실패했습니다.");
      }
      return normalizeCandidates(await response.json());
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function getCandidates(prefix) {
    if (CONFIG.MOLD_MASTER_SOURCE === "supabase") {
      return fetchRemoteCandidates(prefix);
    }
    await masterPromise;
    return normalizeCandidates(moldMaster[prefix] || []);
  }

  function applyCandidate(article, candidate, message) {
    setLookupValues(article, candidate.car, candidate.part);
    setLookupState(article, "found", message || "금형 기준정보를 확인했습니다.");
    article.querySelector(".unregistered-option").hidden = true;
    article.querySelector(".allow-unregistered").checked = false;
  }

  async function lookupMold(article) {
    var taskState = taskStates.get(article);
    if (!taskState) {
      return;
    }
    var moldInput = article.querySelector(".mold-input");
    var prefix = moldInput.value;
    var requestToken = taskState.lookupToken + 1;
    taskState.lookupToken = requestToken;

    if (!/^[0-9]{5}$/.test(prefix)) {
      resetLookup(article, prefix ? "금형번호는 숫자 5자리여야 합니다." : "5자리 숫자를 입력해 주세요.");
      scheduleDraftSave();
      return;
    }

    setLookupValues(article, "", "");
    setLookupState(article, "loading", "금형 기준정보를 확인하는 중입니다.");
    article.querySelector(".candidate-field").hidden = true;
    article.querySelector(".unregistered-option").hidden = true;

    try {
      var candidates = await getCandidates(prefix);
      if (
        !taskStates.has(article) ||
        !article.isConnected ||
        taskState.lookupToken !== requestToken ||
        moldInput.value !== prefix
      ) {
        return;
      }
      taskState.candidates = candidates;

      if (candidates.length === 0) {
        article.querySelector(".unregistered-option").hidden = false;
        setLookupState(
          article,
          "not-found",
          "등록된 금형을 찾지 못했습니다. 번호를 확인하거나 미등록으로 계속해 주세요."
        );
        setLookupValues(article, "", "");
        if (taskState.restoreUnregistered) {
          article.querySelector(".allow-unregistered").checked = true;
          article.querySelector(".allow-unregistered").dispatchEvent(new Event("change"));
          taskState.restoreUnregistered = false;
        }
        scheduleDraftSave();
        return;
      }

      if (candidates.length === 1) {
        applyCandidate(article, candidates[0]);
        scheduleDraftSave();
        return;
      }

      var candidateField = article.querySelector(".candidate-field");
      var candidateSelect = article.querySelector(".candidate-select");
      candidateSelect.innerHTML = "";
      candidateSelect.appendChild(new Option("차종 · 품명을 선택해 주세요", ""));
      candidates.forEach(function (candidate, index) {
        candidateSelect.appendChild(
          new Option(candidate.car + " · " + candidate.part, String(index))
        );
      });
      candidateSelect.required = true;
      candidateField.hidden = false;
      setLookupState(
        article,
        "choice",
        "같은 번호에 여러 품목이 있습니다. 차종과 품명을 선택해 주세요."
      );
      if (taskState.restoreCandidate) {
        var restoredIndex = candidates.findIndex(function (candidate) {
          return (
            candidate.car === taskState.restoreCandidate.car &&
            candidate.part === taskState.restoreCandidate.part
          );
        });
        if (restoredIndex >= 0) {
          candidateSelect.value = String(restoredIndex);
          candidateSelect.dispatchEvent(new Event("change"));
        }
        taskState.restoreCandidate = null;
      }
      scheduleDraftSave();
    } catch (error) {
      if (
        !taskStates.has(article) ||
        !article.isConnected ||
        taskState.lookupToken !== requestToken
      ) {
        return;
      }
      masterLoadError = error;
      setLookupValues(article, "", "");
      setLookupState(
        article,
        "error",
        "기준정보를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 입력해 주세요."
      );
      console.error("Mold lookup failed", error);
    }
  }

  function makeChipOption(groupName, option, selected) {
    var label = document.createElement("label");
    label.className = "chip-option";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.name = groupName;
    input.value = option.value;
    input.checked = Boolean(selected);
    var text = document.createElement("span");
    text.textContent = option.label;
    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  function renderProcessOptions(article, selectedValues) {
    var container = article.querySelector(".process-options");
    var groupName = "process-" + article.dataset.taskId;
    container.innerHTML = "";
    for (var value = 1; value <= 9; value += 1) {
      var stringValue = String(value);
      container.appendChild(
        makeChipOption(
          groupName,
          { value: stringValue, label: stringValue },
          selectedValues.indexOf(stringValue) >= 0
        )
      );
    }
  }

  function renderDepartmentOptions(article, selectedCategory, selectedCodes) {
    var department = departmentInput.value;
    var categorySelect = article.querySelector(".category-select");
    var codeContainer = article.querySelector(".code-options");
    var categoryOptions = CATEGORY_OPTIONS[department] || [];
    var codeOptions = CODE_OPTIONS[department] || [];
    var groupName = "code-" + article.dataset.taskId;

    categorySelect.innerHTML = "";
    categorySelect.appendChild(
      new Option(department ? "작업구분 선택" : "소속을 먼저 선택해 주세요", "")
    );
    categoryOptions.forEach(function (option) {
      categorySelect.appendChild(new Option(option.label, option.value));
    });
    if (categoryOptions.some(function (option) { return option.value === selectedCategory; })) {
      categorySelect.value = selectedCategory;
    }

    codeContainer.innerHTML = "";
    codeOptions.forEach(function (option) {
      codeContainer.appendChild(
        makeChipOption(groupName, option, selectedCodes.indexOf(option.value) >= 0)
      );
    });
    article.querySelector(".code-help").textContent = department
      ? "해당 작업코드를 모두 선택해 주세요."
      : "소속을 선택하면 코드가 표시됩니다.";
  }

  function selectedValues(containerSelector, article) {
    return Array.from(article.querySelectorAll(containerSelector + " input:checked")).map(
      function (input) {
        return input.value;
      }
    );
  }

  function configureTaskIds(article, taskId) {
    var pairs = [
      [".mold-input", ".dynamic-label", "mold-"],
      [".candidate-select", ".candidate-label", "candidate-"],
      [".category-select", ".category-label", "category-"],
      [".time-input", ".time-label", "time-"],
      [".remark-input", ".remark-label", "remark-"]
    ];
    pairs.forEach(function (pair) {
      var input = article.querySelector(pair[0]);
      var label = article.querySelector(pair[1]);
      var id = pair[2] + taskId;
      input.id = id;
      input.name = id;
      label.htmlFor = id;
    });
    var lookupStatus = article.querySelector(".lookup-status");
    lookupStatus.id = "mold-status-" + taskId;
    article.querySelector(".mold-input").setAttribute("aria-describedby", lookupStatus.id);
    article.querySelector(".allow-unregistered").name = "allow-unregistered-" + taskId;
    article.querySelector(".no-mold-input").name = "no-mold-" + taskId;
    var processField = article.querySelector(".process-field");
    var processHelp = processField.querySelector(".field-help");
    processHelp.id = "process-help-" + taskId;
    processField.setAttribute("aria-describedby", processHelp.id);
    var codeField = article.querySelector(".code-field");
    var codeHelp = codeField.querySelector(".code-help");
    codeHelp.id = "code-help-" + taskId;
    codeField.setAttribute("aria-describedby", codeHelp.id);
  }

  function createTask(initialData) {
    if (taskList.children.length >= Number(CONFIG.MAX_TASKS || 10)) {
      showStatus("작업 항목은 최대 10개까지 등록할 수 있습니다.", "error");
      return null;
    }
    var article = taskTemplate.content.firstElementChild.cloneNode(true);
    var taskId = taskSequence + 1;
    taskSequence = taskId;
    article.dataset.taskId = String(taskId);
    article.dataset.lookup = "idle";
    configureTaskIds(article, taskId);
    taskStates.set(article, {
      lookupState: "idle",
      lookupToken: 0,
      candidates: [],
      car: "",
      part: "",
      lookupTimer: null,
      restoreCandidate: null,
      restoreUnregistered: false
    });

    var data = initialData || {};
    var processValues = Array.isArray(data.proc) ? data.proc : String(data.proc || "").split(",").filter(Boolean);
    var codeValues = Array.isArray(data.code) ? data.code : String(data.code || "").split(",").filter(Boolean);
    renderProcessOptions(article, processValues);
    renderDepartmentOptions(article, data.cat || "", codeValues);

    var moldInput = article.querySelector(".mold-input");
    var noMoldInput = article.querySelector(".no-mold-input");
    var candidateSelect = article.querySelector(".candidate-select");
    var allowUnregistered = article.querySelector(".allow-unregistered");
    var timeInput = article.querySelector(".time-input");
    var remarkInput = article.querySelector(".remark-input");
    var removeButton = article.querySelector(".remove-task");

    timeInput.value = data.time === 0 || data.time ? String(data.time) : "30";
    remarkInput.value = cleanText(data.remark, 300);
    article.querySelector(".remark-count").textContent = remarkInput.value.length + "/300";

    moldInput.addEventListener("input", function () {
      var digits = moldInput.value.replace(/\D/g, "").slice(0, 5);
      if (moldInput.value !== digits) {
        moldInput.value = digits;
      }
      var taskState = taskStates.get(article);
      window.clearTimeout(taskState.lookupTimer);
      resetLookup(
        article,
        digits.length === 5 ? "금형 기준정보를 확인합니다." : "5자리 숫자를 입력해 주세요."
      );
      if (digits.length === 5) {
        taskState.lookupTimer = window.setTimeout(function () {
          lookupMold(article);
        }, 180);
      }
      scheduleDraftSave();
    });

    noMoldInput.addEventListener("change", function () {
      var taskState = taskStates.get(article);
      window.clearTimeout(taskState.lookupTimer);
      taskState.lookupToken += 1;
      article.querySelector(".required-marker").hidden = noMoldInput.checked;
      if (noMoldInput.checked) {
        moldInput.value = "";
        moldInput.required = false;
        moldInput.disabled = true;
        article.querySelector(".candidate-field").hidden = true;
        article.querySelector(".candidate-select").required = false;
        article.querySelector(".unregistered-option").hidden = true;
        article.querySelector(".allow-unregistered").checked = false;
        setLookupValues(article, "", "");
        setLookupState(article, "no-mold", "금형번호 없는 작업으로 등록됩니다.");
      } else {
        moldInput.disabled = false;
        moldInput.required = true;
        resetLookup(article, "5자리 숫자를 입력해 주세요.");
        moldInput.focus();
      }
      scheduleDraftSave();
    });

    candidateSelect.addEventListener("change", function () {
      var taskState = taskStates.get(article);
      var index = Number(candidateSelect.value);
      if (candidateSelect.value !== "" && taskState.candidates[index]) {
        applyCandidate(article, taskState.candidates[index], "선택한 금형 기준정보를 적용했습니다.");
      } else {
        setLookupValues(article, "", "");
        setLookupState(article, "choice", "차종과 품명을 선택해 주세요.");
      }
      scheduleDraftSave();
    });

    allowUnregistered.addEventListener("change", function () {
      if (allowUnregistered.checked) {
        setLookupValues(article, "미등록금형", "미등록품명");
        setLookupState(
          article,
          "unregistered",
          "미등록 금형으로 저장됩니다. 번호를 한 번 더 확인해 주세요."
        );
      } else {
        setLookupValues(article, "", "");
        setLookupState(
          article,
          "not-found",
          "등록된 금형을 찾지 못했습니다. 번호를 확인하거나 미등록으로 계속해 주세요."
        );
      }
      scheduleDraftSave();
    });

    timeInput.addEventListener("input", function () {
      updateTotalMinutes();
      scheduleDraftSave();
    });

    article.querySelectorAll(".quick-times button").forEach(function (button) {
      button.addEventListener("click", function () {
        timeInput.value = button.dataset.minutes;
        updateTotalMinutes();
        scheduleDraftSave();
      });
    });

    remarkInput.addEventListener("input", function () {
      article.querySelector(".remark-count").textContent = remarkInput.value.length + "/300";
      scheduleDraftSave();
    });

    article.addEventListener("change", function (event) {
      if (event.target.matches(".process-options input, .code-options input, .category-select")) {
        scheduleDraftSave();
      }
    });

    removeButton.addEventListener("click", function () {
      if (taskList.children.length <= 1) {
        showStatus("최소 1개의 작업 항목은 유지해야 합니다.", "error");
        return;
      }
      var state = taskStates.get(article);
      if (state) {
        window.clearTimeout(state.lookupTimer);
        state.lookupToken += 1;
      }
      taskStates.delete(article);
      article.remove();
      updateTaskNumbers();
      updateTotalMinutes();
      scheduleDraftSave();
    });

    taskList.appendChild(article);
    updateTaskNumbers();
    updateTotalMinutes();

    if (data.car || data.part) {
      taskStates.get(article).restoreCandidate = {
        car: cleanText(data.car, 120),
        part: cleanText(data.part, 180)
      };
    }
    taskStates.get(article).restoreUnregistered = Boolean(data.unregistered);
    if (data.noMold) {
      noMoldInput.checked = true;
      noMoldInput.dispatchEvent(new Event("change"));
    } else if (data.swmno) {
      moldInput.value = String(data.swmno).replace(/\D/g, "").slice(0, 5);
      if (moldInput.value.length === 5) {
        lookupMold(article);
      }
    }
    return article;
  }

  function updateTaskNumbers() {
    var articles = Array.from(taskList.querySelectorAll(".task-card"));
    articles.forEach(function (article, index) {
      article.querySelector(".task-title").textContent = "작업 " + (index + 1);
      var removeButton = article.querySelector(".remove-task");
      removeButton.hidden = articles.length === 1;
      removeButton.setAttribute("aria-label", "작업 " + (index + 1) + " 삭제");
    });
    taskCount.textContent = String(articles.length);
    var atLimit = articles.length >= Number(CONFIG.MAX_TASKS || 10);
    addTaskTop.disabled = atLimit;
    addTaskBottom.disabled = atLimit;
    addTaskBottom.textContent = atLimit ? "작업 항목 최대 10개" : "＋ 작업 항목 추가";
  }

  function updateTotalMinutes() {
    var total = Array.from(taskList.querySelectorAll(".time-input")).reduce(function (sum, input) {
      var value = Number(input.value);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    totalMinutes.textContent = String(Math.round(total));
    return total;
  }

  function clearValidationState() {
    form.querySelectorAll("[aria-invalid='true']").forEach(function (element) {
      element.removeAttribute("aria-invalid");
    });
    form.querySelectorAll(".has-error").forEach(function (element) {
      element.classList.remove("has-error");
    });
  }

  function markInvalid(element) {
    if (!element) {
      return;
    }
    element.setAttribute("aria-invalid", "true");
    var group = element.closest(".field-group");
    if (group) {
      group.classList.add("has-error");
    }
  }

  function validateForm() {
    clearValidationState();
    var errors = [];
    var firstInvalid = null;

    [departmentInput, workDateInput, workerNameInput, employeeIdInput].forEach(function (input) {
      var invalidName = input === workerNameInput && !cleanText(input.value, 30);
      var invalidEmployeeId =
        input === employeeIdInput &&
        (Number(input.value) < 100000000 || Number(input.value) > 999999999);
      if (!input.checkValidity() || invalidName || invalidEmployeeId) {
        markInvalid(input);
        errors.push(input === employeeIdInput ? "사번은 숫자 9자리로 입력해 주세요." : "작업자 필수 정보를 확인해 주세요.");
        if (!firstInvalid) {
          firstInvalid = input;
        }
      }
    });

    Array.from(taskList.querySelectorAll(".task-card")).forEach(function (article, index) {
      var number = index + 1;
      var moldInput = article.querySelector(".mold-input");
      var categorySelect = article.querySelector(".category-select");
      var timeInput = article.querySelector(".time-input");
      var codeInputs = article.querySelectorAll(".code-options input");
      var taskState = taskStates.get(article);

      if (taskState.lookupState !== "no-mold") {
        if (!/^[0-9]{5}$/.test(moldInput.value)) {
          markInvalid(moldInput);
          errors.push("작업 " + number + "의 금형번호를 숫자 5자리로 입력해 주세요.");
          firstInvalid = firstInvalid || moldInput;
        } else if (taskState.lookupState !== "found" && taskState.lookupState !== "unregistered") {
          markInvalid(moldInput);
          errors.push("작업 " + number + "의 금형 조회 결과를 확인해 주세요.");
          firstInvalid = firstInvalid || moldInput;
        }
      }

      if (!categorySelect.value) {
        markInvalid(categorySelect);
        errors.push("작업 " + number + "의 작업구분을 선택해 주세요.");
        firstInvalid = firstInvalid || categorySelect;
      }

      if (!Array.from(codeInputs).some(function (input) { return input.checked; })) {
        article.querySelector(".code-field").classList.add("has-error");
        article.querySelector(".code-field").setAttribute("aria-invalid", "true");
        errors.push("작업 " + number + "의 작업코드를 하나 이상 선택해 주세요.");
        firstInvalid = firstInvalid || codeInputs[0];
      }

      var minutes = Number(timeInput.value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        markInvalid(timeInput);
        errors.push("작업 " + number + "의 시간은 1~1,440분 사이의 정수로 입력해 주세요.");
        firstInvalid = firstInvalid || timeInput;
      }
    });

    if (updateTotalMinutes() > Number(CONFIG.MAX_TOTAL_MINUTES || 1440)) {
      errors.push("이번 등록의 총 작업시간은 1,440분을 넘을 수 없습니다.");
      firstInvalid = firstInvalid || taskList.querySelector(".time-input");
    }

    if (errors.length) {
      showStatus(errors[0] + (errors.length > 1 ? " 외 " + (errors.length - 1) + "건을 확인해 주세요." : ""), "error");
      focusStatus();
      if (firstInvalid) {
        window.setTimeout(function () {
          firstInvalid.focus({ preventScroll: true });
          firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 250);
      }
      return false;
    }
    return true;
  }

  function buildRows() {
    var date = workDateInput.value;
    var name = cleanText(workerNameInput.value, 30);
    var employeeId = Number(employeeIdInput.value);
    return Array.from(taskList.querySelectorAll(".task-card")).map(function (article, index) {
      var taskState = taskStates.get(article);
      var hasMold = taskState.lookupState !== "no-mold";
      var processes = selectedValues(".process-options", article);
      return {
        date: date,
        name: name,
        Id: employeeId,
        swmno: hasMold ? article.querySelector(".mold-input").value : null,
        proc: processes.length ? processes.join(",") : null,
        car: hasMold ? taskState.car : null,
        part: hasMold ? taskState.part : null,
        cat: article.querySelector(".category-select").value,
        code: selectedValues(".code-options", article).join(","),
        time: Number(article.querySelector(".time-input").value),
        remark: cleanText(article.querySelector(".remark-input").value, 300) || null,
        submission_id: submissionId,
        line_no: index + 1
      };
    });
  }

  function publicErrorMessage(status, payload) {
    var code = payload && payload.code ? payload.code : "";
    var message = payload && payload.message ? payload.message : "";
    if (status === 401 || status === 403 || code === "42501") {
      return "저장 권한이 없습니다. 동봉된 Supabase 설정 SQL을 다시 확인해 주세요.";
    }
    if (status === 404 || code === "PGRST202" || code === "PGRST205") {
      return "Supabase 저장 함수를 찾지 못했습니다. 동봉된 설정 SQL을 먼저 실행해 주세요.";
    }
    if (code === "23502" && /column\s+["']?no["']?/i.test(message)) {
      return "Supabase의 no 컬럼에 자동번호 설정이 필요합니다. 동봉된 설정 SQL을 먼저 적용해 주세요.";
    }
    if (code === "23505") {
      return "이미 등록된 값과 충돌했습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (code === "P0001") {
      return "이전 제출과 현재 화면의 내용이 다릅니다. 아래 새 제출 전환은 기존 등록 내역을 확인한 뒤에만 사용해 주세요.";
    }
    if (status === 400 || code === "PGRST204" || code === "22023" || code === "23514") {
      return "저장할 값과 Supabase 컬럼 설정이 맞지 않습니다. 설정 SQL과 컬럼명을 확인해 주세요.";
    }
    return "등록하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  }

  async function submitRows(rows) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, Number(CONFIG.REQUEST_TIMEOUT_MS) || 15000);
    var endpoint = new URL(
      "/rest/v1/rpc/" + encodeURIComponent(CONFIG.WORKLOG_RPC),
      CONFIG.SUPABASE_URL
    );
    try {
      var response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ _rows: rows }),
        signal: controller.signal
      });
      if (!response.ok) {
        var payload = null;
        try {
          payload = await response.json();
        } catch (error) {
          payload = null;
        }
        var requestError = new Error(publicErrorMessage(response.status, payload));
        requestError.status = response.status;
        requestError.payload = payload;
        throw requestError;
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function setSubmitting(active) {
    isSubmitting = active;
    form.setAttribute("aria-busy", active ? "true" : "false");
    submitButton.classList.toggle("is-loading", active);
    form.querySelectorAll("input, select, textarea, button").forEach(function (control) {
      if (control === submitButton) {
        return;
      }
      if (active) {
        control.dataset.submitDisabled = control.disabled ? "1" : "0";
        control.disabled = true;
      } else if (Object.prototype.hasOwnProperty.call(control.dataset, "submitDisabled")) {
        control.disabled = control.dataset.submitDisabled === "1";
        delete control.dataset.submitDisabled;
      }
    });
    submitButtonLabel.textContent = active
      ? "등록 중"
      : !configurationValid
        ? "연결 설정 확인 필요"
        : navigator.onLine
          ? "작업일보 등록"
          : "온라인 연결 필요";
    submitButton.disabled = active || !navigator.onLine || !configurationValid;
    addTaskTop.disabled = active || taskList.children.length >= Number(CONFIG.MAX_TASKS || 10);
    addTaskBottom.disabled = active || taskList.children.length >= Number(CONFIG.MAX_TASKS || 10);
  }

  function resetTasksAfterSuccess() {
    taskStates.forEach(function (state) {
      window.clearTimeout(state.lookupTimer);
    });
    taskStates.clear();
    taskList.innerHTML = "";
    taskSequence = 0;
    submissionId = createSubmissionId();
    createTask();
    storageRemove(sessionStorage, STORAGE_KEYS.sessionDraft);
    storageRemove(localStorage, STORAGE_KEYS.localDraft);
    if (rememberInput.checked) {
      saveProfile();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    hideStatus();
    hideConflictAction();
    if (!navigator.onLine) {
      showStatus("오프라인 상태에서는 등록할 수 없습니다. 연결 후 다시 눌러 주세요.", "error");
      focusStatus();
      return;
    }
    if (!validateForm()) {
      return;
    }
    var rows = buildRows();
    var total = updateTotalMinutes();
    setSubmitting(true);
    showStatus(rows.length + "개 작업을 안전하게 등록하는 중입니다.", "info");
    try {
      await submitRows(rows);
      resetTasksAfterSuccess();
      showStatus(rows.length + "개 작업, 총 " + total + "분이 등록되었습니다.", "success");
      focusStatus();
      if (navigator.vibrate) {
        navigator.vibrate(35);
      }
    } catch (error) {
      var isSubmissionConflict = Boolean(error.payload && error.payload.code === "P0001");
      var message = error.name === "AbortError"
        ? "응답 시간이 초과되었습니다. 입력값을 바꾸지 말고 등록 버튼을 다시 눌러 저장 여부를 안전하게 확인해 주세요."
        : error.status
          ? error.message
          : "연결 응답을 확인하지 못했습니다. 입력값을 바꾸지 말고 연결 후 등록 버튼을 다시 눌러 주세요.";
      showStatus(message, "error");
      conflictAction.hidden = !isSubmissionConflict;
      focusStatus();
      console.error("Worklog submission failed", {
        status: error.status || null,
        code: error.payload && error.payload.code ? error.payload.code : null
      });
    } finally {
      setSubmitting(false);
      scheduleDraftSave();
    }
  }

  function serializeDraft() {
    return {
      version: 2,
      savedAt: Date.now(),
      submissionId: submissionId,
      remember: rememberInput.checked,
      department: departmentInput.value,
      date: workDateInput.value,
      name: workerNameInput.value,
      employeeId: employeeIdInput.value,
      tasks: Array.from(taskList.querySelectorAll(".task-card")).map(function (article) {
        var taskState = taskStates.get(article);
        return {
          swmno: article.querySelector(".mold-input").value,
          noMold: taskState.lookupState === "no-mold",
          car: taskState.car,
          part: taskState.part,
          unregistered: taskState.lookupState === "unregistered",
          proc: selectedValues(".process-options", article),
          cat: article.querySelector(".category-select").value,
          code: selectedValues(".code-options", article),
          time: article.querySelector(".time-input").value,
          remark: article.querySelector(".remark-input").value
        };
      })
    };
  }

  function saveProfile() {
    if (!rememberInput.checked) {
      storageRemove(localStorage, STORAGE_KEYS.profile);
      return;
    }
    storageSet(
      localStorage,
      STORAGE_KEYS.profile,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        department: departmentInput.value,
        name: workerNameInput.value,
        employeeId: employeeIdInput.value
      })
    );
  }

  function saveDraft() {
    var draft = serializeDraft();
    var hasTaskContent = draft.tasks.some(function (task) {
      return Boolean(
        task.swmno ||
        task.noMold ||
        task.proc.length ||
        task.cat ||
        task.code.length ||
        task.remark ||
        (task.time && String(task.time) !== "30")
      );
    });
    var hasIdentityContent = Boolean(
      draft.department ||
      draft.name ||
      draft.employeeId ||
      (draft.date && draft.date !== getKoreanToday())
    );
    if (!hasTaskContent && !hasIdentityContent) {
      storageRemove(sessionStorage, STORAGE_KEYS.sessionDraft);
      storageRemove(localStorage, STORAGE_KEYS.localDraft);
      saveProfile();
      return;
    }
    storageSet(sessionStorage, STORAGE_KEYS.sessionDraft, JSON.stringify(draft));
    if (rememberInput.checked) {
      storageSet(localStorage, STORAGE_KEYS.localDraft, JSON.stringify(draft));
      saveProfile();
    } else {
      storageRemove(localStorage, STORAGE_KEYS.localDraft);
      storageRemove(localStorage, STORAGE_KEYS.profile);
    }
  }

  function scheduleDraftSave() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, 250);
  }

  function loadRestoredState() {
    var sessionDraft = safeJsonParse(storageGet(sessionStorage, STORAGE_KEYS.sessionDraft));
    var localDraft = safeJsonParse(storageGet(localStorage, STORAGE_KEYS.localDraft));
    var profile = safeJsonParse(storageGet(localStorage, STORAGE_KEYS.profile));
    var maxDraftAge = 7 * 24 * 60 * 60 * 1000;
    var now = Date.now();
    function isFresh(value) {
      var savedAt = Number(value && value.savedAt);
      return Boolean(
        value &&
        value.version === 2 &&
        savedAt > 0 &&
        now >= savedAt &&
        now - savedAt <= maxDraftAge
      );
    }
    if (sessionDraft && !isFresh(sessionDraft)) {
      storageRemove(sessionStorage, STORAGE_KEYS.sessionDraft);
    }
    if (localDraft && !isFresh(localDraft)) {
      storageRemove(localStorage, STORAGE_KEYS.localDraft);
    }
    if (profile && !isFresh(profile)) {
      storageRemove(localStorage, STORAGE_KEYS.profile);
      profile = null;
    }
    var draft = [sessionDraft, localDraft]
      .filter(isFresh)
      .sort(function (left, right) {
        return Number(right.savedAt) - Number(left.savedAt);
      })[0] || null;
    if (draft) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.submissionId || "")) {
        submissionId = draft.submissionId;
      }
      departmentInput.value = draft.department || "";
      workDateInput.value = draft.date || getKoreanToday();
      workerNameInput.value = draft.name || "";
      employeeIdInput.value = String(draft.employeeId || "").replace(/\D/g, "").slice(0, 9);
      rememberInput.checked = Boolean(draft.remember);
      if (Array.isArray(draft.tasks) && draft.tasks.length) {
        draft.tasks.slice(0, Number(CONFIG.MAX_TASKS || 10)).forEach(function (task) {
          createTask(task);
        });
      }
      showStatus("저장된 작성 내용을 복원했습니다. 작업일자와 입력값을 확인해 주세요.", "info");
      return true;
    }
    if (profile) {
      departmentInput.value = profile.department || "";
      workerNameInput.value = profile.name || "";
      employeeIdInput.value = String(profile.employeeId || "").replace(/\D/g, "").slice(0, 9);
      rememberInput.checked = true;
    }
    return false;
  }

  function handleDepartmentChange() {
    Array.from(taskList.querySelectorAll(".task-card")).forEach(function (article) {
      renderDepartmentOptions(article, "", []);
    });
    showStatus("소속에 맞게 작업구분과 작업코드를 새로 표시했습니다.", "info");
    scheduleDraftSave();
  }

  function updateNetworkState() {
    var online = navigator.onLine;
    networkBanner.hidden = online;
    if (!isSubmitting) {
      submitButton.disabled = !online || !configurationValid;
      submitButtonLabel.textContent = !configurationValid
        ? "연결 설정 확인 필요"
        : online
          ? "작업일보 등록"
          : "온라인 연결 필요";
    }
    if (online && appStatus.classList.contains("error") && /오프라인/.test(appStatus.textContent)) {
      hideStatus();
    }
  }

  function validateConfiguration() {
    try {
      var url = new URL(CONFIG.SUPABASE_URL);
      return (
        url.protocol === "https:" &&
        /^sb_publishable_/.test(CONFIG.SUPABASE_PUBLISHABLE_KEY || "") &&
        Boolean(CONFIG.WORKLOG_TABLE) &&
        Boolean(CONFIG.WORKLOG_RPC)
      );
    } catch (error) {
      return false;
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      return;
    }
    navigator.serviceWorker.register("./sw.js").catch(function (error) {
      console.warn("Service worker registration failed", error);
    });
  }

  function initialize() {
    var today = getKoreanToday();
    workDateInput.value = today;
    workDateInput.min = shiftIsoDate(today, -31);
    workDateInput.max = shiftIsoDate(today, 1);
    masterPromise = CONFIG.MOLD_MASTER_SOURCE === "supabase"
      ? Promise.resolve(null)
      : loadLocalMaster().catch(function (error) {
          masterLoadError = error;
          throw error;
        });

    var restored = loadRestoredState();
    if (!restored || taskList.children.length === 0) {
      createTask();
    }

    masterPromise.catch(function () {
      Array.from(taskList.querySelectorAll(".task-card")).forEach(function (article) {
        if (article.querySelector(".mold-input").value.length === 5) {
          setLookupState(
            article,
            "error",
            "금형 기준정보 파일을 불러오지 못했습니다. 배포 파일을 확인해 주세요."
          );
        }
      });
    });

    configurationValid = validateConfiguration();
    if (!configurationValid) {
      showStatus("Supabase 연결 설정이 올바르지 않습니다. config.js를 확인해 주세요.", "error");
      submitButton.disabled = true;
    }

    addTaskTop.addEventListener("click", function () {
      var article = createTask();
      if (article) {
        article.scrollIntoView({ behavior: "smooth", block: "start" });
        article.querySelector(".mold-input").focus({ preventScroll: true });
        scheduleDraftSave();
      }
    });
    addTaskBottom.addEventListener("click", function () {
      addTaskTop.click();
    });
    departmentInput.addEventListener("change", handleDepartmentChange);
    employeeIdInput.addEventListener("input", function () {
      employeeIdInput.value = employeeIdInput.value.replace(/\D/g, "").slice(0, 9);
      scheduleDraftSave();
    });
    [workDateInput, workerNameInput].forEach(function (input) {
      input.addEventListener("input", scheduleDraftSave);
    });
    rememberInput.addEventListener("change", function () {
      saveDraft();
      showStatus(
        rememberInput.checked
          ? "작업자 정보와 작성 중 내용을 이 기기에 7일간 저장합니다."
          : "7일 보관 자료를 삭제했습니다. 현재 탭에서는 작성 중 내용을 계속 보호합니다.",
        "info"
      );
    });
    newSubmissionButton.addEventListener("click", function () {
      if (newSubmissionButton.dataset.confirm !== "1") {
        newSubmissionButton.dataset.confirm = "1";
        newSubmissionButton.textContent = "기존 등록 확인 완료 — 새 제출 ID 만들기";
        showStatus("기존 등록 내역을 확인했다면 버튼을 한 번 더 눌러 주세요.", "info");
        focusStatus();
        return;
      }
      submissionId = createSubmissionId();
      hideConflictAction();
      scheduleDraftSave();
      showStatus("현재 화면을 새 제출로 전환했습니다. 입력값과 중복 여부를 확인한 뒤 등록해 주세요.", "info");
      focusStatus();
    });
    form.addEventListener("submit", handleSubmit);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    window.addEventListener("pagehide", saveDraft);

    updateTaskNumbers();
    updateTotalMinutes();
    updateNetworkState();
    registerServiceWorker();
  }

  initialize();
})();
