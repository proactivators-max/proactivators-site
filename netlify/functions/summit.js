const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  // ORIGIN ALLOWLIST — block direct-endpoint spam bots. Real browser
  // submissions from the site always send Origin: https://proactivatorsclub.com.
  // Silent fake-success so bots can't detect they were blocked.
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  if (!origin.includes('proactivatorsclub.com')) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  const { name, email, hp } = JSON.parse(event.body);

  // Honeypot: hidden field only bots fill. Pretend success, create nothing.
  if (hp) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    console.error('summit: GHL_API_KEY env var is missing');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server misconfigured: GHL_API_KEY not set' }) };
  }

  const res = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstName,
      lastName,
      name: (name || '').trim(),
      email: email.trim(),
      source: 'summit waitlist',
      tags: ['website', 'summit-waitlist'],
    }),
  });

  if (!res.ok) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to create contact' }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
