import { NextResponse } from 'next/server'
import { sendMeetingReminders } from '@/lib/agents/remind'

export const maxDuration = 60

export async function GET() {
  return NextResponse.json(await sendMeetingReminders())
}

export async function POST() {
  return NextResponse.json(await sendMeetingReminders())
}
