const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

export async function sendTextMessage(instanceName: string, phone: string, message: string) {
  const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ number: phone, text: message }),
  })
  if (!res.ok) throw new Error(`Evolution API error: ${res.status}`)
  return res.json()
}

export async function sendMediaMessage(
  instanceName: string,
  phone: string,
  mediaUrl: string,
  mediaType: 'image' | 'video' | 'document',
  caption: string
) {
  const res = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({
      number: phone,
      mediatype: mediaType,
      media: mediaUrl,
      caption,
    }),
  })
  if (!res.ok) throw new Error(`Evolution API error: ${res.status}`)
  return res.json()
}

export async function createInstance(instanceName: string) {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
  })
  if (!res.ok) throw new Error(`Evolution API error: ${res.status}`)
  return res.json()
}

// Get QR code for an instance
export async function getInstanceQRCode(instanceName: string): Promise<{ qrcode?: { base64?: string }; instance?: { state?: string } }> {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
    headers: { apikey: EVOLUTION_API_KEY },
  })
  if (!res.ok) return {}
  return res.json()
}

// Get instance connection status
export async function getInstanceStatus(instanceName: string): Promise<{ instance?: { state?: string; profileName?: string; profilePictureUrl?: string } }> {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
    headers: { apikey: EVOLUTION_API_KEY },
  })
  if (!res.ok) return {}
  return res.json()
}

// Delete/disconnect instance
export async function deleteInstance(instanceName: string) {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
    method: 'DELETE',
    headers: { apikey: EVOLUTION_API_KEY },
  })
  return res.ok
}

// Set webhook URL on instance
export async function setInstanceWebhook(instanceName: string, webhookUrl: string) {
  const res = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    }),
  })
  if (!res.ok) throw new Error(`Evolution webhook set error: ${res.status}`)
  return res.json()
}
