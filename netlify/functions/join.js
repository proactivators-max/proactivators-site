exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { name, email } = JSON.parse(event.body);

  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const apiKey = process.env.GHL_API_KEY;

  // Create or update contact with tag
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
      source: 'website form',
      tags: ['website'],
    }),
  });

  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create contact' }) };
  }

  const contact = await res.json();
  const contactId = contact.contact?.id;

  // Add contact to Newsletter workflow
  if (contactId) {
    await fetch(`https://rest.gohighlevel.com/v1/contacts/${contactId}/workflow/f32c3ef5-ca07-4961-b874-0daec0b5c760`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
    }).catch(() => {});
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
