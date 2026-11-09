
(() => {
  "use strict";

  const API_URL = "/.netlify/functions/amprem";
  const REQUEST_TIMEOUT = 25000;

  const $ = (id) => document.getElementById(id);

  // Status akses hanya disimpan di memori.
  // Refresh halaman akan mengatur ulang nilainya menjadi false.
  let isUnlocked = false;
  let pendingEmail = "";
  let successWasShown = false;

  // =========================================
  // DEVICE ID
  // =========================================

  function getDeviceId() {
    const storageKey = "amprem_device_id_v1";

    try {
      let deviceId = localStorage.getItem(storageKey);

      if (!deviceId) {
        deviceId = (
          "amprem-" +
          crypto.randomUUID() +
          "-" +
          crypto.randomUUID()
        );

        localStorage.setItem(storageKey, deviceId);
      }

      return deviceId;
    } catch {
      throw new Error(
        "Browser tidak dapat menyimpan ID perangkat. Aktifkan penyimpanan browser."
      );
    }
  }

  // =========================================
  // API
  // =========================================

  async function api(action, payload = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          action,
          ...payload
        }),
        signal: controller.signal,
        cache: "no-store"
      });

      const raw = await response.text();

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("Respons server tidak valid.");
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Permintaan gagal diproses."
        );
      }

      return data;

    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Server terlalu lama merespons.");
      }

      throw error;

    } finally {
      clearTimeout(timeout);
    }
  }

  // =========================================
  // MESSAGE
  // =========================================

  function showMessage(element, message, success = false) {
    if (!element) return;

    element.textContent = message;
    element.hidden = false;
    element.style.color = success ? "#53634f" : "#9a493d";
  }

  function clearMessage(element) {
    if (!element) return;

    element.textContent = "";
    element.hidden = true;
  }

  function setButtonLoading(button, loading, loadingText, normalText) {
    if (!button) return;

    button.disabled = loading;

    const span = button.querySelector("span");

    if (span) {
      span.textContent = loading
        ? loadingText
        : normalText;
    } else {
      button.textContent = loading
        ? loadingText
        : normalText;
    }
  }

  // =========================================
  // STEP NAVIGATION
  // =========================================

  function goToStep(step) {
    if (!isUnlocked) return;

    const steps = [
      $("step1"),
      $("step2"),
      $("step3")
    ];

    steps.forEach((element, index) => {
      if (!element) return;

      element.classList.toggle(
        "active",
        index + 1 === step
      );
    });

    document.querySelectorAll(".progress-step").forEach((item) => {
      const number = Number(item.dataset.step);

      item.classList.toggle("active", number === step);
      item.classList.toggle("completed", number < step);
    });

    const heading = $("panelHeading");

    if (heading) {
      heading.textContent = step === 1
        ? "Verify your email"
        : step === 2
          ? "Check your inbox"
          : "Verification complete";
    }
  }

  // =========================================
  // LOCK / UNLOCK
  // =========================================

  function lockApplication() {
    isUnlocked = false;
    pendingEmail = "";
    successWasShown = false;

    document.documentElement.classList.add("amprem-locked");

    const pinModal = $("accessPinModal");
    const welcomeModal = $("welcomeModal");
    const successModal = $("successModal");
    const appShell = $("appShell");

    if (pinModal) {
      pinModal.hidden = false;
      pinModal.classList.remove("is-hidden");
      pinModal.setAttribute("aria-hidden", "false");
    }

    if (welcomeModal) {
      welcomeModal.hidden = true;
      welcomeModal.classList.add("is-hidden");
      welcomeModal.setAttribute("aria-hidden", "true");
    }

    if (successModal) {
      successModal.hidden = true;
      successModal.classList.add("is-hidden");
    }

    if (appShell) {
      appShell.hidden = true;
    }

    const pinInput = $("accessPin");
    const pinMessage = $("accessPinMessage");

    if (pinInput) pinInput.value = "";
    clearMessage(pinMessage);

    document.body.style.overflow = "hidden";
  }

  function unlockApplication() {
    isUnlocked = true;

    document.documentElement.classList.remove("amprem-locked");

    const pinModal = $("accessPinModal");
    const welcomeModal = $("welcomeModal");
    const appShell = $("appShell");

    if (pinModal) {
      pinModal.hidden = true;
      pinModal.classList.add("is-hidden");
      pinModal.setAttribute("aria-hidden", "true");
    }

    if (appShell) {
      appShell.hidden = false;
    }

    if (welcomeModal) {
      welcomeModal.hidden = false;
      welcomeModal.classList.remove("is-hidden");
      welcomeModal.setAttribute("aria-hidden", "false");
    }

    document.body.style.overflow = "hidden";
  }

  // =========================================
  // PIN ACTIVATION
  // =========================================

  const accessPinForm = $("accessPinForm");

  accessPinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isUnlocked) return;

    const pinInput = $("accessPin");
    const submitButton = $("btnAccessPin");
    const message = $("accessPinMessage");

    const pin = pinInput?.value
      ?.trim()
      .toUpperCase();

    if (!pin) {
      showMessage(message, "Masukkan PIN akses terlebih dahulu.");
      return;
    }

    setButtonLoading(
      submitButton,
      true,
      "Memeriksa PIN...",
      "Buka akses"
    );

    clearMessage(message);

    try {
      const deviceId = getDeviceId();

      const result = await api("activate-pin", {
        pin,
        deviceId
      });

      if (!result.success) {
        throw new Error(result.message || "PIN tidak valid.");
      }

      showMessage(
        message,
        result.message || "PIN berhasil diverifikasi.",
        true
      );

      unlockApplication();

    } catch (error) {
      showMessage(message, error.message);

      if (pinInput) {
        pinInput.focus();
      }

    } finally {
      setButtonLoading(
        submitButton,
        false,
        "Memeriksa PIN...",
        "Buka akses"
      );
    }
  });

  // =========================================
  // WELCOME MODAL
  // =========================================

  $("btnWelcomeContinue")?.addEventListener("click", () => {
    if (!isUnlocked) return;

    const welcomeModal = $("welcomeModal");

    if (welcomeModal) {
      welcomeModal.classList.add("is-hidden");
      welcomeModal.hidden = true;
      welcomeModal.setAttribute("aria-hidden", "true");
    }

    document.body.style.overflow = "";
    goToStep(1);
  });

  // =========================================
  // SEND MAGIC LINK
  // =========================================

  $("sendForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isUnlocked) {
      lockApplication();
      return;
    }

    const emailInput = $("email");
    const button = $("btnSend");
    const result = $("result1");

    const email = emailInput?.value?.trim() || "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMessage(result, "Masukkan alamat email yang valid.");
      return;
    }

    clearMessage(result);

    setButtonLoading(
      button,
      true,
      "Mengirim...",
      "Send verification link"
    );

    try {
      const data = await api("send-magiclink", {
        email
      });

      pendingEmail = email;

      const preview = $("emailPreview");

      if (preview) {
        preview.textContent = email;
      }

      showMessage(
        result,
        data.message || "Permintaan pengiriman berhasil diproses.",
        true
      );

      goToStep(2);

    } catch (error) {
      showMessage(result, error.message);

    } finally {
      setButtonLoading(
        button,
        false,
        "Mengirim...",
        "Send verification link"
      );
    }
  });

  // =========================================
  // VERIFY MAGIC LINK
  // =========================================

  $("verifyForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isUnlocked) {
      lockApplication();
      return;
    }

    const linkInput = $("magicLink");
    const button = $("btnVerify");
    const result = $("result2");

    const rawLink = linkInput?.value?.trim() || "";

    if (!pendingEmail) {
      showMessage(
        result,
        "Email belum dipilih. Silakan mulai dari awal."
      );
      goToStep(1);
      return;
    }

    let parsedLink;

    try {
      parsedLink = new URL(rawLink);
    } catch {
      showMessage(result, "Format verification link tidak valid.");
      return;
    }

    if (parsedLink.protocol !== "https:") {
      showMessage(result, "Link harus menggunakan HTTPS.");
      return;
    }

    clearMessage(result);

    setButtonLoading(
      button,
      true,
      "Memverifikasi...",
      "Verify email"
    );

    try {
      const data = await api("verify-account", {
        email: pendingEmail,
        rawLink
      });

      const finalEmail = $("finalEmail");

      if (finalEmail) {
        finalEmail.textContent = pendingEmail;
      }

      goToStep(3);
      showSuccessModal();

      showMessage(
        result,
        data.message || "Verifikasi berhasil diproses.",
        true
      );

    } catch (error) {
      showMessage(result, error.message);

    } finally {
      setButtonLoading(
        button,
        false,
        "Memverifikasi...",
        "Verify email"
      );
    }
  });

  // =========================================
  // SUCCESS MODAL
  // =========================================

  function showSuccessModal() {
    if (!isUnlocked || successWasShown) return;

    const email = $("finalEmail")?.textContent?.trim() || "—";
    const modal = $("successModal");
    const modalEmail = $("modalPremiumEmail");

    if (modalEmail) {
      modalEmail.textContent = email;
    }

    if (modal) {
      modal.hidden = false;
      modal.classList.remove("is-hidden");
      modal.setAttribute("aria-hidden", "false");
    }

    successWasShown = true;
    document.body.style.overflow = "hidden";
  }

  function hideSuccessModal() {
    const modal = $("successModal");

    if (modal) {
      modal.classList.add("is-hidden");
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }

    document.body.style.overflow = "";
  }

  $("btnCloseSuccess")?.addEventListener("click", () => {
    hideSuccessModal();
  });

  $("btnVerifyAnother")?.addEventListener("click", () => {
    hideSuccessModal();
    successWasShown = false;
    restartVerification();
  });

  // =========================================
  // BACK / RESTART
  // =========================================

  $("btnBack")?.addEventListener("click", () => {
    if (!isUnlocked) return;

    pendingEmail = "";

    if ($("email")) $("email").value = "";
    if ($("magicLink")) $("magicLink").value = "";

    clearMessage($("result1"));
    clearMessage($("result2"));

    goToStep(1);
  });

  function restartVerification() {
    if (!isUnlocked) return;

    pendingEmail = "";
    successWasShown = false;

    if ($("email")) $("email").value = "";
    if ($("magicLink")) $("magicLink").value = "";
    if ($("finalEmail")) $("finalEmail").textContent = "—";
    if ($("modalPremiumEmail")) $("modalPremiumEmail").textContent = "—";

    clearMessage($("result1"));
    clearMessage($("result2"));

    hideSuccessModal();
    goToStep(1);
  }

  $("btnRestart")?.addEventListener("click", restartVerification);

  // =========================================
  // BROWSER RESTORE / BACK-FORWARD CACHE
  // =========================================

  window.addEventListener("pageshow", (event) => {
    // Jika halaman dipulihkan dari BFCache,
    // minta PIN lagi.
    if (event.persisted) {
      lockApplication();
      return;
    }

    // Pastikan halaman awal tetap terkunci.
    if (!isUnlocked) {
      lockApplication();
    }
  });

  // =========================================
  // INITIAL STATE
  // =========================================

  // Selalu mulai dalam kondisi terkunci.
  // Tidak ada status unlock yang disimpan ke storage.
  lockApplication();

})();
