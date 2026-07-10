/**
 * Test endpoint for Phase 1 gate #12: "Confirm Asia/Karachi date grouping
 * utility works for records near midnight."
 *
 * Given a UTC ISO instant, returns the Asia/Karachi business day it
 * falls into, plus the full UTC range that maps to that same business
 * day. The browser test calls this with instants at 19:30 UTC (which is
 * 00:30 next-day in Asia/Karachi) and 18:30 UTC (which is 23:30 same-day
 * in Asia/Karachi) and asserts the boundary.
 */
import { NextResponse } from 'next/server'
import { bizDayForInstant } from '@/lib/dates'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const iso = url.searchParams.get('instant')
  if (!iso) {
    // Default: test the current instant + two synthetic near-midnight instants.
    const now = new Date()
    const a = new Date('2026-07-09T19:30:00Z') // 00:30 next-day KHI
    const b = new Date('2026-07-09T18:30:00Z') // 23:30 same-day KHI
    return NextResponse.json({
      now: bizDayForInstant(now),
      nearMidnightNextDay: bizDayForInstant(a),
      nearMidnightSameDay: bizDayForInstant(b),
      note: 'Asia/Karachi is UTC+5. 19:30Z = 00:30+1day KHI; 18:30Z = 23:30 same-day KHI.',
    })
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return NextResponse.json({ error: 'BAD_DATE' }, { status: 400 })
  return NextResponse.json(bizDayForInstant(d))
}
