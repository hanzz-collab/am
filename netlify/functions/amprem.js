
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const SATRIAM_BASE = "https://satriam.satriadeveloperz.workers.dev";
const STORE_NAME = "amprem-access";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function makePin() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);

  let value = "";

  for (let i = 0; i < 8; i++) {
    value += chars[bytes[i] % chars.length];
  }

  return `AM-${value.slice(0, 4)}-${value.slice(4)}`;
}

function validDeviceId(value) {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 200
  );
}

function validPin(value) {
  return (
    typeof value === "string" &&
    /^AM-lanna-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/i.test(
      value.trim()
    )
  );
}

function getAccessStore() {
  // Netlify Functions v2 akan menerima kredensial Blobs otomatis.
  return getStore(STORE_NAME);
}

export default async (request, context) => {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return response(200, { success: true });
  }

  if (request.method !== "POST") {
    return response(405, {
      success: false,
      message: "Method tidak diizinkan.",
    });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return response(400, {
      success: false,
      message: "Format JSON tidak valid.",
    });
  }

  try {
    const { action } = body;

    // =========================================
    // ADMIN: GENERATE PIN
    // =========================================
    if (action === "admin-generate-pin") {
      const adminSecret = process.env.AMPREM_ADMIN_KEY;

      if (
        !adminSecret ||
        !safeEqual(body.adminKey, adminSecret)
      ) {
        return response(401, {
          success: false,
          message: "Admin key tidak valid.",
        });
      }

      const store = getAccessStore();

      let pin;
      let key;
      let existing;

      // Pastikan PIN tidak bentrok dengan PIN yang sudah ada.
      do {
        pin = makePin();
        key = `pin:${sha256(pin)}`;
        existing = await store.get(key, {
          type: "json",
        });
      } while (existing);

      await store.setJSON(key, {
        createdAt: new Date().toISOString(),
        label:
          typeof body.label === "string"
            ? body.label.slice(0, 80)
            : "",
        deviceHash: null,
        activatedAt: null,
        revoked: false,
      });

      // PIN asli hanya dikirim sekali ke admin.
      return response(200, {
        success: true,
        pin,
        message:
          "PIN berhasil dibuat. Salin sekarang dan simpan dengan aman.",
      });
    }

    // =========================================
    // ADMIN: REVOKE PIN
    // =========================================
    if (action === "admin-revoke-pin") {
      const adminSecret = process.env.AMPREM_ADMIN_KEY;

      if (
        !adminSecret ||
        !safeEqual(body.adminKey, adminSecret)
      ) {
        return response(401, {
          success: false,
          message: "Admin key tidak valid.",
        });
      }

      if (!validPin(body.pin)) {
        return response(400, {
          success: false,
          message: "Format PIN tidak valid.",
        });
      }

      const store = getAccessStore();

      const key = `pin:${sha256(
        body.pin.trim().toUpperCase()
      )}`;

      const record = await store.get(key, {
        type: "json",
      });

      if (!record) {
        return response(404, {
          success: false,
          message: "PIN tidak ditemukan.",
        });
      }

      await store.setJSON(key, {
        ...record,
        revoked: true,
        revokedAt: new Date().toISOString(),
      });

      return response(200, {
        success: true,
        message: "PIN berhasil dinonaktifkan.",
      });
    }

    // =========================================
    // USER: ACTIVATE PIN
    // =========================================
    if (action === "activate-pin") {
      const pin =
        typeof body.pin === "string"
          ? body.pin.trim().toUpperCase()
          : "";

      const deviceId = body.deviceId;

      if (!validPin(pin)) {
        return response(400, {
          success: false,
          message: "Format PIN tidak valid.",
        });
      }

      if (!validDeviceId(deviceId)) {
        return response(400, {
          success: false,
          message:
            "ID perangkat tidak valid. Muat ulang halaman.",
        });
      }

      const store = getAccessStore();
      const key = `pin:${sha256(pin)}`;

      const record = await store.get(key, {
        type: "json",
      });

      if (!record || record.revoked) {
        return response(403, {
          success: false,
          message:
            "PIN tidak ditemukan atau sudah dinonaktifkan.",
        });
      }

      const deviceHash = sha256(deviceId);

      // Aktivasi pertama mengikat PIN ke perangkat.
      if (!record.deviceHash) {
        await store.setJSON(key, {
          ...record,
          deviceHash,
          activatedAt: new Date().toISOString(),
        });

        return response(200, {
          success: true,
          message:
            "PIN berhasil diaktifkan dan dikunci ke perangkat ini.",
        });
      }

      // Tolak perangkat berbeda.
      if (!safeEqual(record.deviceHash, deviceHash)) {
        return response(403, {
          success: false,
          message:
            "PIN ini sudah terikat ke perangkat lain.",
        });
      }

      // Perangkat yang sama boleh masuk kembali.
      return response(200, {
        success: true,
        message: "Perangkat dikenali. Akses diberikan.",
      });
    }

    // =========================================
    // SATRIAM EMAIL VERIFICATION
    // =========================================
    const { email, rawLink } = body;

    if (
      !email ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return response(400, {
        success: false,
        message: "Email tidak valid.",
      });
    }

    let endpoint;
    let payload;

    if (action === "send-magiclink") {
      endpoint = "/api/satriam/send-link";

      payload = {
        email: email.trim(),
      };
    } else if (action === "verify-account") {
      if (!rawLink || typeof rawLink !== "string") {
        return response(400, {
          success: false,
          message: "Magic link tidak ditemukan.",
        });
      }

      let parsedLink;

      try {
        parsedLink = new URL(rawLink);
      } catch {
        return response(400, {
          success: false,
          message: "Format magic link tidak valid.",
        });
      }

      if (parsedLink.protocol !== "https:") {
        return response(400, {
          success: false,
          message: "Magic link harus menggunakan HTTPS.",
        });
      }

      endpoint = "/api/satriam/verify-link";

      payload = {
        email: email.trim(),
        magicLink: rawLink.trim(),
      };
    } else {
      return response(400, {
        success: false,
        message: "Action tidak dikenal.",
      });
    }

    const upstream = await fetch(
      `${SATRIAM_BASE}${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      }
    );

    const rawResult = await upstream.text();

    let result;

    try {
      result = JSON.parse(rawResult);
    } catch {
      result = {
        message: rawResult,
      };
    }

    if (
      !upstream.ok ||
      result.success === false ||
      result.ok === false
    ) {
      return response(upstream.status || 502, {
        success: false,
        message:
          result.message ||
          "Verifikasi dari Satriam gagal.",
      });
    }

    return response(200, {
      success: true,
      message:
        result.message ||
        (
          action === "send-magiclink"
            ? "Permintaan magic link berhasil dikirim."
            : "Permintaan verifikasi berhasil diproses."
        ),
      data: result.data ?? null,
    });

  } catch (error) {
    console.error("[AMPREM FUNCTION]", error);

    return response(502, {
      success: false,
      message:
        error.name === "TimeoutError"
          ? "Server terlalu lama merespons."
          : "Terjadi kesalahan pada server. Periksa konfigurasi Netlify.",
    });
  }
};
