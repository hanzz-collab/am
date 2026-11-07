const SATRIAM_BASE = 'https://satriam.satriadeveloperz.workers.dev';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  const response = (statusCode, data) => ({
    statusCode,
    headers,
    body: JSON.stringify(data)
  });

  if (event.httpMethod === 'OPTIONS') {
    return response(200, { success: true });
  }

  if (event.httpMethod !== 'POST') {
    return response(405, {
      success: false,
      message: 'Method tidak diizinkan.'
    });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, email, rawLink } = body;

    if (!email || typeof email !== 'string') {
      return response(400, {
        success: false,
        message: 'Email tidak valid.'
      });
    }

    let endpoint;
    let payload;

    if (action === 'send-magiclink') {
      endpoint = '/api/satriam/send-link';
      payload = { email: email.trim() };
    } else if (action === 'verify-account') {
      if (!rawLink || typeof rawLink !== 'string') {
        return response(400, {
          success: false,
          message: 'Magic link tidak ditemukan.'
        });
      }

      let parsedLink;

      try {
        parsedLink = new URL(rawLink);
      } catch {
        return response(400, {
          success: false,
          message: 'Format magic link tidak valid.'
        });
      }

      if (parsedLink.protocol !== 'https:') {
        return response(400, {
          success: false,
          message: 'Magic link harus menggunakan HTTPS.'
        });
      }

      endpoint = '/api/satriam/verify-link';
      payload = {
        email: email.trim(),
        magicLink: rawLink.trim()
      };
    } else {
      return response(400, {
        success: false,
        message: 'Action tidak dikenal.'
      });
    }

    const upstream = await fetch(`${SATRIAM_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000)
    });

    const rawResult = await upstream.text();

    let result;

    try {
      result = JSON.parse(rawResult);
    } catch {
      result = { message: rawResult };
    }

    if (!upstream.ok || result.success === false || result.ok === false) {
      return response(upstream.status || 502, {
        success: false,
        message: result.message || 'Verifikasi dari Satriam gagal.'
      });
    }

    return response(200, {
      success: true,
      message: result.message || (
        action === 'send-magiclink'
          ? 'Permintaan magic link berhasil dikirim.'
          : 'Permintaan verifikasi berhasil diproses.'
      ),
      data: result.data ?? null
    });

  } catch (error) {
    console.error('[AMPREM SATRIAM]', error);

    return response(502, {
      success: false,
      message: error.name === 'TimeoutError'
        ? 'Server Satriam timeout.'
        : 'Gagal menghubungi server verifikasi.'
    });
  }
};
