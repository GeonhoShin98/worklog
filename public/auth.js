"use strict";
(async () => {
  const changing = document.body.dataset.page === "pin";
  const form = document.getElementById("authForm");
  const message = document.getElementById("authMessage");
  const button = document.getElementById("authButton");
  if (changing) {
    try {
      const me = await WorklogSecurity.api("/api/me",{});
      document.getElementById("backToWork").hidden = me.must_change_pin;
    } catch { return; }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    message.textContent = ""; button.disabled = true;
    try {
      if (changing) {
        const pin = document.getElementById("newPin").value;
        if (pin !== document.getElementById("confirmPin").value) throw new Error("새 PIN이 일치하지 않습니다.");
        await WorklogSecurity.api("/api/pin", {current_pin:document.getElementById("pin").value,new_pin:pin});
        location.replace("/login.html?changed=1");
      } else {
        const result = await WorklogSecurity.api("/api/login",{
          employee_no:document.getElementById("employeeNo").value.trim(),
          pin:document.getElementById("pin").value
        });
        location.replace(result.must_change_pin ? "/pin.html" : "/");
      }
    } catch(error) { message.textContent = error.message; }
    finally {
      document.getElementById("pin").value = "";
      button.disabled = false;
    }
  });
  if (!changing && location.search === "?changed=1") message.textContent = "PIN이 변경되었습니다. 새 PIN으로 로그인하세요.";
})();

