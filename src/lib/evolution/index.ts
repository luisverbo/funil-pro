const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (!digits.startsWith('55')) digits = '55' + digits
  return digits
}

// delayMs: a Evolution API mostra "digitando…" no WhatsApp durante esse tempo antes de enviar
export async function sendTextMessage(instanceName: string, phone: string, message: string, delayMs?: number) {
  const normalizedPhone = normalizePhone(phone)
  const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ number: normalizedPhone, text: message, ...(delayMs ? { delay: delayMs } : {}) }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Evolution API error: ${res.status} — ${body}`)
  }
  return res.json()
}

const MIMETYPE_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/avi',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}

export async function sendMediaMessage(
  instanceName: string,
  phone: string,
  mediaUrl: string,
  mediaType: 'image' | 'video' | 'document',
  caption: string
) {
  const normalizedPhone = normalizePhone(phone)
  const rawFileName = mediaUrl.split('/').pop()?.split('?')[0] ?? 'arquivo'
  const ext = rawFileName.split('.').pop()?.toLowerCase() ?? ''
  const mimetype = MIMETYPE_MAP[ext] ?? (
    mediaType === 'image' ? 'image/jpeg' :
    mediaType === 'video' ? 'video/mp4' :
    'application/octet-stream'
  )

  const res = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({
      number: normalizedPhone,
      mediatype: mediaType,
      mimetype,
      media: mediaUrl,
      caption,
      fileName: rawFileName,
    }),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Evolution API sendMedia error: ${res.status} — ${errBody}`)
  }
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

export async function getInstanceQRCode(instanceName: string): Promise<{ qrcode?: { base64?: string }; instance?: { state?: string } }> {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
    headers: { apikey: EVOLUTION_API_KEY },
  })
  if (!res.ok) return {}
  return res.json()
}

export async function getInstanceStatus(instanceName: string): Promise<{ instance?: { state?: string; profileName?: string; profilePictureUrl?: string } }> {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
    headers: { apikey: EVOLUTION_API_KEY },
  })
  if (!res.ok) return {}
  return res.json()
}

export async function deleteInstance(instanceName: string) {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
    method: 'DELETE',
    headers: { apikey: EVOLUTION_API_KEY },
  })
  return res.ok
}

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

// Baixa a mídia de uma mensagem recebida (áudio, imagem...) em base64
export async function getMediaBase64(instanceName: string, messageKey: { id?: string; remoteJid?: string; fromMe?: boolean }): Promise<{ base64: string; mimetype?: string } | null> {
  const res = await fetch(`${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ message: { key: messageKey }, convertToMp4: false }),
  })
  if (!res.ok) return null
  const json = await res.json().catch(() => null) as { base64?: string; mimetype?: string } | null
  if (!json?.base64) return null
  return { base64: json.base64, mimetype: json.mimetype }
}
