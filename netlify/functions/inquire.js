const TYPE_TAGS = {
  speaker: 'speaker_inquiry',
  workshop: 'workshop_inquiry',
  boardroom: 'boardroom_application',
};

// Slugify a value into a hyphen-safe tag suffix.
function slug(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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
  const tags = ['website', 'website_b2b', tag];

  // Encode page-specific dropdown answers as searchable tags so Gabriel can
  // segment in GHL without needing custom-field IDs configured.
  if (fields && typeof fields === 'object') {
    const taggable = ['audienceSize', 'engagementType', 'budgetRange', 'teamSize', 'formatPreference', 'paymentPlan', 'commitment', 'bookRead'];
    for (const key of taggable) {
      const s = slug(fields[key]);
      if (s) tags.push(`${key.toLowerCase()}-${s}`);
    }
  }

  // Mirror the working /join.js shape: only fields known to be accepted by
  // GHL v1 contacts API. No customField / companyName — those caused the
  // earlier 500s.
  const payload = {
    firstName,
    lastName,
    name: (name || '').trim(),
    email: email.trim(),
    source: 'website_b2b',
    tags,
  };
  if (phone) payload.phone = String(phone).trim();

  const res = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('GHL contact create failed', res.status, errText);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create contact' }) };
  }

  // Best-effort: attach a note with the full submission so the long-form
  // textareas (message, drift areas, why-the-boardroom essay) are visible
  // on the contact record. If this call fails, the contact is already
  // created — we don't fail the user's form.
  try {
    const data = await res.json();
    const contactId = data.contact?.id || data.id;
    if (contactId) {
      const noteLines = [
        `B2B INQUIRY — ${tag.toUpperCase()}`,
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
      await fetch(`https://rest.gohighlevel.com/v1/contacts/${contactId}/notes/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: noteLines.join('\n') }),
      }).catch((e) => console.error('Note attach error:', e));
    }
  } catch (e) {
    console.error('Note attach setup failed:', e);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
