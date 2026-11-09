(() => {
  "use strict";

  const API = "/.netlify/functions/amprem";
  const TIMEOUT_MS = 20000;
  const $ = (id) => document.getElementById(id);
  const panels = { 1: $("step1"), 2: $("step2"), 3: $("step3") };
  const stepItems = [...document.querySelectorAll(".progress-step")];
  const rules = [...document.querySelectorAll(".progress-rule")];
  let pendingEmail = "";

  function goToStep(step) {
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle("active", Number(key) === step));
    stepItems.forEach((item) => {
      const number = Number(item.dataset.step);
      item.classList.toggle("active", number === step);
      item.classList.toggle("done", number < step);
    });
    rules.forEach((rule, index) => rule.style.background = index + 1 < step ? "var(--accent)" : "var(--line)");
    $("panelHeading").textContent = step === 1 ? "Verify your email" : step === 2 ? "One last step" : "All done";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function message(el, text, type = "") {
    el.hidden = false;
    el.className = `message ${type}`.trim();
    el.textContent = text;
  }

  function loading(button, busy, label) {
    button.disabled = busy;
    button.querySelector("span").textContent = busy ? "Please wait…" : label;
  }

  async function callAPI(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.message) data.message = `Request failed (${response.status})`;
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Server terlalu lama merespons. Coba lagi.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  $("sendForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("email").value.trim();
    const result = $("result1");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message(result, "Masukkan alamat email yang valid.", "error");
      return;
    }
    const button = $("btnSend");
    loading(button, true, "Send verification link");
    message(result, "Mengirim tautan verifikasi…");
    try {
      const data = await callAPI({ action: "send-magiclink", email });
      if (!data.success) throw new Error(data.message || "Gagal mengirim tautan.");
      pendingEmail = email;
      $("emailPreview").textContent = email;
      message(result, data.message || "Tautan verifikasi berhasil dikirim.", "success");
      setTimeout(() => goToStep(2), 700);
    } catch (error) {
      message(result, error.message || "Terjadi kesalahan.", "error");
    } finally {
      loading(button, false, "Send verification link");
    }
  });

  $("verifyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = pendingEmail;
    const rawLink = $("magicLink").value.trim();
    const result = $("result2");
    if (!email) {
      message(result, "Sesi email tidak ditemukan. Silakan mulai kembali.", "error");
      goToStep(1);
      return;
    }
    if (!rawLink) {
      message(result, "Masukkan tautan verifikasi dari email.", "error");
      return;
    }
    let parsed;
    try { parsed = new URL(rawLink); } catch { message(result, "Format tautan tidak valid.", "error"); return; }
    if (parsed.protocol !== "https:") {
      message(result, "Tautan harus menggunakan HTTPS.", "error");
      return;
    }

    const button = $("btnVerify");
    loading(button, true, "Verify email");
    message(result, "Memverifikasi alamat email…");
    try {
      const data = await callAPI({ action: "verify-account", email, rawLink });
      if (!data.success) throw new Error(data.message || "Verifikasi gagal.");
      $("finalEmail").textContent = email;
      message(result, data.message || "Email berhasil diverifikasi.", "success");
      setTimeout(() => goToStep(3), 700);
    } catch (error) {
      message(result, error.message || "Terjadi kesalahan.", "error");
    } finally {
      loading(button, false, "Verify email");
    }
  });

  $("btnBack").addEventListener("click", () => {
    $("magicLink").value = "";
    $("result2").hidden = true;
    goToStep(1);
    $("email").focus();
  });

  $("btnRestart").addEventListener("click", () => {
    pendingEmail = "";
    $("email").value = "";
    $("magicLink").value = "";
    $("result1").hidden = true;
    $("result2").hidden = true;
    goToStep(1);
    $("email").focus();
  });

  goToStep(1);
})();
