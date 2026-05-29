import { Resend } from 'resend'

export function getResendClient(apiKey?: string) {
  return new Resend(apiKey ?? process.env.RESEND_API_KEY!)
}

export async function sendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
}: {
  apiKey?: string
  from: string
  to: string
  subject: string
  html: string
}) {
  const resend = getResendClient(apiKey)
  return resend.emails.send({ from, to, subject, html })
}
