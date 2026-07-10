/**
 * Asia/Karachi date grouping utilities.
 *
 * Storage: every timestamp is stored in UTC (Prisma DateTime).
 * Display / "today" / "this month" / closing-date grouping MUST use
 * Asia/Karachi. These helpers guarantee that, especially for records
 * created near midnight UTC.
 *
 * Implementation note: we use the Intl API to extract Asia/Karachi
 * wall-clock components from any UTC instant, then construct UTC
 * instants for "start of KHI day" and "end of KHI day" using the
 * fixed +05:00 offset. This avoids depending on date-fns timezone
 * prototype quirks (TZDate.toInstant) that are version-fragile.
 */

export const BUSINESS_TZ = 'Asia/Karachi'
/** Asia/Karachi is permanently UTC+5 (no DST). */
const KHI_OFFSET_MINUTES = 5 * 60

/** Format a Date as yyyy-MM-dd in Asia/Karachi. */
export function bizDateString(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  // toLocaleString with en-CA gives yyyy-MM-dd format.
  return d.toLocaleString('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** Format a Date as yyyy-MM in Asia/Karachi. */
export function bizMonthString(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const parts = d.toLocaleString('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
  }).split('-')
  return `${parts[0]}-${parts[1]}`
}

/** Hour-of-day in Asia/Karachi for a UTC instant (0-23). */
export function bizHour(date: Date | string | number): number {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return Number(
    d.toLocaleString('en-GB', {
      timeZone: BUSINESS_TZ,
      hour: '2-digit',
      hour12: false,
    }),
  )
}

/** "Today" in Asia/Karachi, as { start, end } UTC instants + a label. */
export function bizTodayRange(now: Date = new Date()): { start: Date; end: Date; label: string } {
  const label = bizDateString(now)
  const start = new Date(`${label}T00:00:00+05:00`)
  const end = new Date(`${label}T23:59:59.999+05:00`)
  return { start, end, label }
}

/** "This month" in Asia/Karachi, as { start, end } UTC instants + a label. */
export function bizMonthRange(now: Date = new Date()): { start: Date; end: Date; label: string } {
  const label = bizMonthString(now)
  // Year-month → first day → start, then end = first day of next month - 1ms.
  const [y, m] = label.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1) - KHI_OFFSET_MINUTES * 60 * 1000)
  // last calendar day of month in KHI = same UTC month-length since offset is constant.
  const daysInMonth = new Date(y, m, 0).getDate()
  const end = new Date(Date.UTC(y, m - 1, daysInMonth, 23, 59, 59, 999) - KHI_OFFSET_MINUTES * 60 * 1000)
  return { start, end, label }
}

/** Format a UTC instant for display in Asia/Karachi. */
export function bizFormat(date: Date | string | number, fmt: 'date' | 'datetime' | 'datetimes' = 'datetime'): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (fmt === 'date') {
    return bizDateString(d)
  }
  if (fmt === 'datetimes') {
    return d.toLocaleString('en-CA', {
      timeZone: BUSINESS_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).replace(',', '')
  }
  return d.toLocaleString('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).replace(',', '')
}

/** Format date only (no time) — used in tables. */
export function bizDate(date: Date | string | number): string {
  return bizDateString(date)
}

/**
 * Debug helper used by the Phase 1 gate: given a UTC instant near
 * midnight, return which Asia/Karachi business day it falls into and
 * the full UTC range that maps to that same business day. This is the
 * function the gate "records near midnight" test invokes.
 */
export function bizDayForInstant(instant: Date): {
  bizDay: string
  startUtc: Date
  endUtc: Date
  hourInBiz: number
} {
  const bizDay = bizDateString(instant)
  const startUtc = new Date(`${bizDay}T00:00:00+05:00`)
  const endUtc = new Date(`${bizDay}T23:59:59.999+05:00`)
  return {
    bizDay,
    startUtc,
    endUtc,
    hourInBiz: bizHour(instant),
  }
}
