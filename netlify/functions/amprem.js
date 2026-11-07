const API_URL =
  'https://anita-studio.netlify.app/.netlify/functions/amprem';

const ALLOWED_ACTIONS = new Set([
  'send-magiclink',
  'verify-account'
]);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':
      process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  const respond = (statusCode, payload) => ({
    statusCode,
    headers,
    body: JSON.stringify(payload)
  });

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, {
      success: false,
      message: 'Method not allowed.'
    });
  }

  let body;

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, {
      success: false,
      message: 'Request body bukan JSON valid.'
    });
  }

  const { action, email, rawLink } = body;

  if (!ALLOWED_ACTIONS.has(action)) {
    return respond(400, {
      success: false,
      message: 'Action tidak didukung.'
    });
  }

  if (
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return respond(400, {
      success: false,
      message: 'Alamat email tidak valid.'
    });
  }

  if (action === 'verify-account') {
    if (
      typeof rawLink !== 'string' ||
      rawLink.length > 4096
    ) {
      return respond(400, {
        success: false,
        message: 'Tautan verifikasi tidak valid.'
      });
    }

    try {
      const parsed = new URL(rawLink);

      if (parsed.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      return respond(400, {
        success: false,
        message: 'Tautan harus berupa URL HTTPS yang valid.'
      });
    }
  }

  try {
    const payload = {
      action,
      email: email.trim()
    };

    if (action === 'verify-account') {
      payload.rawLink = rawLink;
    }

    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });

    const result = await upstream.json().catch(() => ({}));

    if (!upstream.ok || result.success !== true) {
      return respond(
        upstream.status >= 400 ? upstream.status : 502,
        {
          success: false,
          message:
            typeof result.message === 'string'
              ? result.message
              : 'Permintaan gagal diproses.'
        }
      );
    }

    return respond(200, {
      success: true,
      message:
        result.message ||
        (action === 'send-magiclink'
          ? 'Magic link berhasil dikirim.'
          : 'Verifikasi berhasil.')
    });

  } catch (error) {
    console.error('AMPREM ERROR:', error.message);

    return respond(502, {
      success: false,
      message: 'Tidak dapat menghubungi server API.'
    });
  }
};
