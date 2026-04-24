// Trigger an n8n webhook with optional data
export const triggerN8N = async (action: string, data: any) => {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('N8N_WEBHOOK_URL not set in env variables.');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
    });
    if (!response.ok) {
      console.error('Failed to trigger n8n webhook', await response.text());
    } else {
      console.log(`Successfully triggered n8n action: ${action}`);
    }
  } catch (error) {
    console.error('Error triggering n8n:', error);
  }
};
