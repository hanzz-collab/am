import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const SATRIAM_BASE = "https://satriam.satriadeveloperz.workers.dev";
const STORE_NAME = "amprem-access";
const DEFAULT_SESSION_DAYS = 30;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function response(status, data) {
  return new Response(JSON.stringify(data), { status, headers });
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  return left.length === right.length &&
    crypto.timingSafeEqual(left, right);
}

function makePin() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let value = "";

  for (let i = 0; i < 8; i++) {
    value += chars[bytes[i] % chars.length];
  }

  return `AM-LANNA-${value.slice(0, 4)}-${value.slice(4)}`;
}

function getEncryptionKey() {
  const secret = process.env.AMPREM_PIN_ENCRYPTION_KEY;

  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error(
      "AMPREM_PIN_ENCRYPTION_KEY belum diatur atau formatnya salah. Gunakan 64 karakter hexadecimal."
    );
  }

  return Buffer.from(secret, "hex");
}

function encryptPin(pin) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(pin, "utf8"),
    cipher.final(),
  ]);

  return {
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: encrypted.toString("hex"),
  };
}

function decryptPin(encryptedPin) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encryptedPin.iv, "hex")
  );

  decipher.setAuthTag(Buffer.from(encryptedPin.tag, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPin.data, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function validDeviceId(value) {
  return typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 200;
}

function validPin(value) {
  return typeof value === "string" &&
    /^AM-LANNA-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/i.test(value.trim());
}

function getAccessStore() {
  return getStore(STORE_NAME);
}

function verifyAdmin(body) {
  const adminSecret = process.env.AMPREM_ADMIN_KEY;

  return Boolean(
    adminSecret &&
    safeEqual(body.adminKey, adminSecret)
  );
}

function isPinExpired(record) {
  if (!record?.expiresAt) return false;

  const expiry = Date.parse(record.expiresAt);

  // Jika format expiry rusak, akses ditolak.
  if (!Number.isFinite(expiry)) return true;

  return Date.now() >= expiry;
}

function getPinStatus(record) {
  if (record.revoked) return "revoked";
  if (isPinExpired(record)) return "expired";
  if (record.deviceHash) return "used";

  return "active";
}

function getSessionDays() {
  const configured = Number(process.env.AMPREM_SESSION_DAYS);

  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), 365)
    : DEFAULT_SESSION_DAYS;
}

function getPinKeys(pin) {
  const normalized = pin.trim().toUpperCase();
  const original = pin.trim();

  return [
    `pin:${sha256(normalized)}`,
    `pin:${sha256(original)}`,
    `pin:${sha256(original.toLowerCase())}`,
  ];
}

async function findPinRecord(store, pin) {
  const keys = [...new Set(getPinKeys(pin))];

  for (const key of keys) {
    const record = await store.get(key, { type: "json" });

    if (record) {
      return { key, record };
    }
  }

  return null;
}

async function createSession(store, pinKey, deviceHash, pinRecord) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();

  let expiresAt = now + getSessionDays() * 24 * 60 * 60 * 1000;

  // Sesi tidak boleh melewati masa berlaku PIN.
  if (pinRecord.expiresAt) {
    const pinExpiry = Date.parse(pinRecord.expiresAt);

    if (!Number.isFinite(pinExpiry) || pinExpiry <= now) {
      throw new Error("PIN sudah kedaluwarsa.");
    }

    expiresAt = Math.min(expiresAt, pinExpiry);
  }

  const sessionData = {
    pinKey,
    deviceHash,
    sessionVersion: Number(pinRecord.sessionVersion || 0),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };

  await store.setJSON(`session:${sha256(token)}`, sessionData);

  return {
    sessionToken: token,
    expiresAt: sessionData.expiresAt,
  };
}

async function validateSession(store, token, deviceId) {
  if (
    typeof token !== "string" ||
    token.length < 30 ||
    token.length > 200 ||
    !validDeviceId(deviceId)
  ) {
    return {
      valid: false,
      message: "Sesi tidak valid. Masukkan PIN kembali.",
    };
  }

  const sessionKey = `session:${sha256(token)}`;
  const session = await store.get(sessionKey, { type: "json" });

  if (!session) {
    return {
      valid: false,
      message: "Sesi tidak ditemukan. Masukkan PIN kembali.",
    };
  }

  const expiresAt = Date.parse(session.expiresAt || "");

  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    await store.delete(sessionKey);

    return {
      valid: false,
      message: "Sesi sudah kedaluwarsa. Masukkan PIN kembali.",
    };
  }

  const deviceHash = sha256(deviceId);

  if (!safeEqual(session.deviceHash, deviceHash)) {
    return {
      valid: false,
      message: "Sesi tidak cocok dengan perangkat ini.",
    };
  }

  // Periksa PIN asal setiap kali sesi digunakan.
  const pinRecord = await store.get(session.pinKey, { type: "json" });

  if (!pinRecord) {
    await store.delete(sessionKey);

    return {
      valid: false,
      message: "PIN sudah dihapus oleh admin.",
    };
  }

  if (pinRecord.revoked) {
    await store.delete(sessionKey);

    return {
      valid: false,
      message: "Akses PIN sudah dinonaktifkan oleh admin.",
    };
  }

  if (isPinExpired(pinRecord)) {
    await store.delete(sessionKey);

    return {
      valid: false,
      message: "PIN sudah kedaluwarsa. Hubungi admin.",
    };
  }

  if (!safeEqual(pinRecord.deviceHash, deviceHash)) {
    return {
      valid: false,
      message: "Perangkat tidak cocok dengan PIN ini.",
    };
  }

  // Mencegah sesi lama hidup kembali setelah PIN direaktivasi.
  const currentVersion = Number(pinRecord.sessionVersion || 0);
  const sessionVersion = Number(session.sessionVersion || 0);

  if (currentVersion !== sessionVersion) {
    await store.delete(sessionKey);

    return {
      valid: false,
      message: "Sesi lama sudah tidak berlaku. Masukkan PIN kembali.",
    };
  }

  return {
    valid: true,
    session,
    sessionKey,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export default async (request) => {
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
    const store = getAccessStore();

    // ==========================================
    // ADMIN: GENERATE PIN
    // ==========================================
    if (action === "admin-generate-pin") {
      if (!verifyAdmin(body)) {
        return response(401, {
          success: false,
          message: "Admin key tidak valid.",
        });
      }

      // Pastikan encryption key sudah tersedia.
      encryptPin("AMPREM-CHECK");

      const duration = String(body.duration || "30");
      const now = Date.now();

      let expiresAt = null;

      if (duration === "unlimited") {
        expiresAt = null;

      } else if (duration === "custom") {
        if (typeof body.expiresAt !== "string") {
          return response(400, {
            success: false,
            message: "Tanggal kedaluwarsa custom belum diisi.",
          });
        }

        const customExpiry = Date.parse(body.expiresAt);

        if (!Number.isFinite(customExpiry) || customExpiry <= now) {
          return response(400, {
            success: false,
            message: "Tanggal kedaluwarsa harus berada di masa depan.",
          });
        }

        expiresAt = new Date(customExpiry).toISOString();

      } else {
        const days = Number(duration);

        if (![1, 7, 30, 90].includes(days)) {
          return response(400, {
            success: false,
            message: "Durasi PIN tidak valid.",
          });
        }

        expiresAt = new Date(
          now + days * 24 * 60 * 60 * 1000
        ).toISOString();
      }

      let pin;
      let key;
      let existing;

      do {
        pin = makePin();
        key = `pin:${sha256(pin)}`;
        existing = await store.get(key, { type: "json" });
      } while (existing);

      const createdAt = new Date(now).toISOString();

      await store.setJSON(key, {
        createdAt,
        label: typeof body.label === "string"
          ? body.label.slice(0, 80)
          : "",
        encryptedPin: encryptPin(pin),
        deviceHash: null,
        activatedAt: null,
        expiresAt,
        revoked: false,
        sessionVersion: 0,
      });

      return response(200, {
        success: true,
        pin,
        createdAt,
        expiresAt,
        message: "PIN berhasil dibuat.",
      });
    }

    // ==========================================
    // ADMIN: LIST PINS
    // ==========================================
    if (action === "admin-list-pins") {
      if (!verifyAdmin(body)) {
        return response(401, {
          success: false,
          message: "Admin key tidak valid.",
        });
      }

      const { blobs } = await store.list({ prefix: "pin:" });

      const records = await Promise.all(
        blobs.map(async (blob) => {
          const record = await store.get(blob.key, { type: "json" });

          if (!record) return null;

          let pin = null;
          let legacy = false;

          if (record.encryptedPin) {
            try {
              pin = decryptPin(record.encryptedPin);
            } catch {
              legacy = true;
            }
          } else {
            legacy = true;
          }

          return {
            pin,
            legacy,
            label: record.label || "",
            createdAt: record.createdAt || null,
            activatedAt: record.activatedAt || null,
            expiresAt: record.expiresAt || null,
            revokedAt: record.revokedAt || null,
            reactivatedAt: record.reactivatedAt || null,
            status: getPinStatus(record),
          };
        })
      );

      const pins = records
        .filter(Boolean)
        .sort((a, b) =>
          new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        );

      return response(200, {
        success: true,
        total: pins.length,
        active: pins.filter(x => x.status === "active").length,
        used: pins.filter(x => x.status === "used").length,
        revoked: pins.filter(x => x.status === "revoked").length,
        expired: pins.filter(x => x.status === "expired").length,
        legacy: pins.filter(x => x.legacy).length,
        pins,
      });
    }

    // ==========================================
    // ADMIN: REVOKE / REACTIVATE / DELETE PIN
    // ==========================================
    if (
      action === "admin-revoke-pin" ||
      action === "admin-reactivate-pin" ||
      action === "admin-delete-pin"
    ) {
      if (!verifyAdmin(body)) {
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

      const found = await findPinRecord(store, body.pin);

      if (!found) {
        return response(404, {
          success: false,
          message: "PIN tidak ditemukan.",
        });
      }

      const { key, record } = found;

      // HAPUS PERMANEN
      if (action === "admin-delete-pin") {
        await store.delete(key);

        return response(200, {
          success: true,
          message: "PIN berhasil dihapus permanen.",
        });
      }

      // REVOKE
      if (action === "admin-revoke-pin") {
        if (record.revoked) {
          return response(400, {
            success: false,
            message: "PIN ini sudah dinonaktifkan.",
          });
        }

        const now = new Date().toISOString();

        await store.setJSON(key, {
          ...record,
          revoked: true,
          revokedAt: now,
          sessionVersion: Number(record.sessionVersion || 0) + 1,
        });

        return response(200, {
          success: true,
          message: "PIN berhasil dinonaktifkan. Semua sesi lama dibatalkan.",
        });
      }

      // REACTIVATE
      if (action === "admin-reactivate-pin") {
        if (!record.revoked) {
          return response(400, {
            success: false,
            message: "PIN ini tidak sedang dinonaktifkan.",
          });
        }

        if (isPinExpired(record)) {
          return response(400, {
            success: false,
            message: "PIN sudah kedaluwarsa dan tidak bisa diaktifkan kembali.",
          });
        }

        const now = new Date().toISOString();

        await store.setJSON(key, {
          ...record,
          revoked: false,
          reactivatedAt: now,
          sessionVersion: Number(record.sessionVersion || 0) + 1,
        });

        return response(200, {
          success: true,
          message: "PIN berhasil diaktifkan kembali. Pengguna harus memasukkan PIN ulang.",
        });
      }
    }

    // ==========================================
    // USER: ACTIVATE PIN
    // ==========================================
    if (action === "activate-pin") {
      const pin = typeof body.pin === "string"
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
          message: "ID perangkat tidak valid. Muat ulang halaman.",
        });
      }

      const found = await findPinRecord(store, pin);

      if (!found || found.record.revoked) {
        return response(403, {
          success: false,
          message: "PIN tidak ditemukan atau sudah dinonaktifkan.",
        });
      }

      const { key: pinKey } = found;
      let record = found.record;

      if (isPinExpired(record)) {
        return response(403, {
          success: false,
          message: "PIN sudah kedaluwarsa. Hubungi admin.",
        });
      }

      const deviceHash = sha256(deviceId);

      if (!record.deviceHash) {
        record = {
          ...record,
          deviceHash,
          activatedAt: new Date().toISOString(),
          sessionVersion: Number(record.sessionVersion || 0),
        };

        await store.setJSON(pinKey, record);

      } else if (!safeEqual(record.deviceHash, deviceHash)) {
        return response(403, {
          success: false,
          message: "PIN ini sudah terikat ke perangkat lain.",
        });
      }

      const session = await createSession(
        store,
        pinKey,
        deviceHash,
        record
      );

      return response(200, {
        success: true,
        ...session,
        message: "PIN berhasil diverifikasi. Sesi akses telah dibuat.",
      });
    }

    // ==========================================
    // USER: RESTORE / CHECK SESSION
    // ==========================================
    if (action === "verify-session") {
      const result = await validateSession(
        store,
        body.sessionToken,
        body.deviceId
      );

      if (!result.valid) {
        return response(401, {
          success: false,
          message: result.message,
        });
      }

      return response(200, {
        success: true,
        expiresAt: result.expiresAt,
        message: "Sesi akses masih aktif.",
      });
    }

    // ==========================================
    // USER: AUTHENTICATE EMAIL ACTIONS
    // ==========================================
    if (
      action === "send-magiclink" ||
      action === "verify-account"
    ) {
      const auth = await validateSession(
        store,
        body.sessionToken,
        body.deviceId
      );

      if (!auth.valid) {
        return response(401, {
          success: false,
          message: auth.message,
          sessionInvalid: true,
        });
      }
    }

    // ==========================================
    // SATRIAM EMAIL VERIFICATION
    // ==========================================
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
      result = { message: rawResult };
    }

    if (
      !upstream.ok ||
      result.success === false ||
      result.ok === false
    ) {
      return response(upstream.status || 502, {
        success: false,
        message: result.message || "Verifikasi dari Satriam gagal.",
      });
    }

    return response(200, {
      success: true,
      message: result.message || (
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
      message: error.message?.includes("AMPREM_PIN_ENCRYPTION_KEY")
        ? error.message
        : error.name === "TimeoutError"
          ? "Server terlalu lama merespons."
          : "Terjadi kesalahan pada server. Periksa konfigurasi Netlify.",
    });
  }
};
