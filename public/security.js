"use strict";
window.WorklogSecurity = (() => {
  // Erase only this application's legacy local drafts and caches.
  function purgeLegacy() {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of Object.keys(storage)) if (/^worklog\./.test(key)) storage.removeItem(key);
    }
  }
  try { purgeLegacy(); } catch {}
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  async function api(path, data) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {
        method:"POST", credentials:"same-origin", cache:"no-store",
        headers:{"Content-Type":"application/json","X-Worklog-Request":"1"},
        body:JSON.stringify(data), signal:controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && path !== "/api/login") {
          document.querySelector("main").hidden = true;
          location.replace("/login.html");
        }
        if (result.code === "PIN_REQUIRED" && location.pathname !== "/pin.html") location.replace("/pin.html");
        const error = new Error(result.message || "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.");
        error.status = response.status; error.code = result.code; throw error;
      }
      return result;
    } finally { clearTimeout(timer); }
  }
  async function requireWorker() {
    const worker = await api("/api/me", {});
    if (worker.must_change_pin) { location.replace("/pin.html"); return null; }
    return worker;
  }
  const logout = document.getElementById("logoutButton");
  if (logout) logout.addEventListener("click", async () => {
    logout.disabled = true;
    try { await api("/api/logout", {}); location.replace("/login.html"); }
    catch { logout.disabled = false; alert("로그아웃에 실패했습니다. 연결을 확인하고 다시 시도하세요."); }
  });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  // Don't leave personal data visible in the back-forward cache.
  window.addEventListener("pagehide", () => {
    document.querySelector("main")?.replaceChildren();
  });
  return Object.freeze({api,requireWorker});
})();

