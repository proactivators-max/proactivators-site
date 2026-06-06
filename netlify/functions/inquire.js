// Mirror the homepage newsletter form (handleJoin) payload shape exactly,
// because that's the one shape we know GHL v1 accepts. Anything beyond
// firstName/lastName/name/email/source/tags goes into a contact note,
// best-effort — never fail the user's form for note-attach problems.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TYPE_TAGS = {
  speaker: 'speaker_inquiry',
  workshop: 'workshop_inquiry',
  boardroom: 'BoardroomApp',
  'lets-talk': 'lets_talk_inquiry',
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

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, name, email, phone, organization, role, fields, hp } = body;

  // Honeypot: hidden field only bots fill. Pretend success, create nothing.
  if (hp) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  if (!TYPE_TAGS[type]) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid type' }) };
  }
  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    console.error('inquire: GHL_API_KEY env var is missing');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server misconfigured: GHL_API_KEY not set' }) };
  }

  const parts = (name || '').trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  // EXACT shape of what handleJoin posts on the homepage newsletter form.
  // No customField, no companyName, no phone, no extra tags — those caused
  // the previous 500s.
  const ghlBody = {
    firstName,
    lastName,
    name: (name || '').trim(),
    email: email.trim(),
    source: 'website form',
    tags: ['website', TYPE_TAGS[type]],
  };

  console.log('inquire: posting contact to GHL', { tag: TYPE_TAGS[type], email: ghlBody.email });

  let res;
  try {
    res = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ghlBody),
    });
  } catch (e) {
    console.error('inquire: fetch threw', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Network error', details: e.message }) };
  }

  const responseText = await res.text();
  console.log('inquire: GHL responded', res.status, responseText.slice(0, 500));

  if (!res.ok) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'GHL ' + res.status, details: responseText.slice(0, 800) }),
    };
  }

  // Contact created. Best-effort: attach a note with everything else
  // (phone, organization, role, all the page-specific fields). If this
  // fails, the user's form still succeeds — we already have the lead.
  try {
    const data = JSON.parse(responseText);
    const contactId = data.contact?.id || data.id;
    if (contactId) {
      const noteLines = [
        `B2B INQUIRY — ${TYPE_TAGS[type].toUpperCase()}`,
        `Name: ${(name || '').trim()}`,
        `Email: ${email.trim()}`,
      ];
      if (phone) noteLines.push(`Phone: ${phone}`);
      if (organization) noteLines.push(`Organization: ${organization}`);
      if (role) noteLines.push(`Role: ${role}`);
      noteLines.push('', 'Submission:');
      if (fields && typeof fields === 'object') {
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined && v !== null && v !== '') {
            noteLines.push(`  ${k}: ${v}`);
          }
        }
      }
      const noteRes = await fetch(`https://rest.gohighlevel.com/v1/contacts/${contactId}/notes/`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: noteLines.join('\n') }),
      });
      console.log('inquire: note attach status', noteRes.status);
    }
  } catch (e) {
    console.error('inquire: note attach failed', e.message);
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
