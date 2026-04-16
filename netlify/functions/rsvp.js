exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { name, email, tickets } = JSON.parse(event.body);

  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const apiKey = process.env.GHL_API_KEY;
  const ticketCount = parseInt(tickets) || 1;

  // Create or update contact with book-launch tag
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
      source: 'book launch page',
      tags: ['book-launch'],
      customField: {},
    }),
  });

  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create contact' }) };
  }

  const contact = await res.json();
  const contactId = contact.contact?.id;

  // Add contact to book-launch workflow (replace with actual workflow ID)
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, tickets: ticketCount }),
  };
};
