"use strict";
(async () => {
  const changing = document.body.dataset.page === "pin";
  const form = document.getElementById("authForm");
  const message = document.getElementById("authMessage");
  const button = document.getElementById("authButton");
  for (const input of form.querySelectorAll('[data-ascii]')) {
    const clean = () => {
      if (/[^A-Za-z0-9]/.test(input.value)) {
        input.value = input.value.replace(/[^A-Za-z0-9]/g, "");
        message.textContent = "영문과 숫자만 입력할 수 있습니다.";
      }
    };
    input.addEventListener("input", event => { if (!event.isComposing) clean(); });
    input.addEventListener("compositionend", clean);
  }
  if (changing) {
    try {
      const me = await WorklogSecurity.api("/api/me",{});
      document.getElementById("backToWork").hidden = me.must_change_pin;
      document.getElementById("backToWork").href = me.role === "admin" ? "/admin.html" : "/";
    } catch { return; }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    message.textContent = ""; button.disabled = true;
    try {
      if (changing) {
        const pin = document.getElementById("newPin").value;
        if (pin !== document.getElementById("confirmPin").value) throw new Error("새 비밀번호가 일치하지 않습니다.");
        await WorklogSecurity.api("/api/pin", {current_pin:document.getElementById("pin").value,new_pin:pin});
        location.replace("/login.html?changed=1");
      } else {
        const result = await WorklogSecurity.api("/api/login",{
          employee_no:document.getElementById("employeeNo").value.trim(),
          pin:document.getElementById("pin").value
        });
        if (result.must_change_pin) location.replace("/pin.html");
        else {
          const me = await WorklogSecurity.api("/api/me", {});
          location.replace(me.role === "admin" ? "/admin.html" : "/");
        }
      }
    } catch(error) { message.textContent = error.message; }
    finally {
      document.getElementById("pin").value = "";
      button.disabled = false;
    }
  });
  if (!changing && location.search === "?changed=1") message.textContent = "비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.";
})();

