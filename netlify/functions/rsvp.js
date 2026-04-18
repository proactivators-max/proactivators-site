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

  const { name, email, phone, tickets } = JSON.parse(event.body);

  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const apiKey = process.env.GHL_API_KEY;
  const ticketCount = parseInt(tickets) || 1;

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
      phone: (phone || '').trim(),
      source: 'book launch page',
      tags: ['book-launch'],
      customField: {},
    }),
  });

  if (!res.ok) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to create contact' }) };
  }

  const contact = await res.json();
  const contactId = contact.contact?.id;

  const workflowId = process.env.GHL_LAUNCH_WORKFLOW_ID;
  if (contactId && workflowId) {
    await fetch(`https://rest.gohighlevel.com/v1/contacts/${contactId}/workflow/${workflowId}`, {
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
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, tickets: ticketCount }),
  };
};
