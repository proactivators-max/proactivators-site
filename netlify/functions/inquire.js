const TYPE_TAGS = {
  speaker: 'speaker_inquiry',
  workshop: 'workshop_inquiry',
  boardroom: 'boardroom_application',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, name, email, phone, organization, role, fields } = body;

  if (!TYPE_TAGS[type]) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid type' }) };
  }
  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const apiKey = process.env.GHL_API_KEY;

  const tag = TYPE_TAGS[type];

  // Stash extra page-specific fields on the GHL contact's customField array
  // so Gabriel sees the full submission on the contact record.
  const customField = [];
  if (organization) customField.push({ key: 'organization', value: organization });
  if (role) customField.push({ key: 'role', value: role });
  if (fields && typeof fields === 'object') {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') {
        customField.push({ key, value: String(value) });
      }
    }
  }

  const payload = {
    firstName,
    lastName,
    name: (name || '').trim(),
    email: email.trim(),
    source: 'website_b2b',
    tags: ['website', 'website_b2b', tag],
  };
  if (phone) payload.phone = phone.trim();
  if (organization) payload.companyName = organization;
  if (customField.length) payload.customField = customField;

  const res = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create contact' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
