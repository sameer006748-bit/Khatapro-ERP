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

export type BusinessDateRange = { from: string; to: string }

type DateSearchParams = { get(name: string): string | null }

function addBusinessDays(label: string, days: number): string {
  const [year, month, day] = label.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

/** Preset date-only ranges in the business timezone; safe for URL/API use. */
export function bizPresetDateRange(preset: 'today' | 'last3' | 'last7' | 'month', now: Date = new Date()): BusinessDateRange {
  const today = bizDateString(now)
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'last3') return { from: calendarDaysBefore(today, 2), to: today }
  if (preset === 'last7') return { from: calendarDaysBefore(today, 6), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  throw new Error(`Unknown preset: ${preset}`)
}

function calendarDaysBefore(dateStr: string, count: number): string {
  return addBusinessDays(dateStr, -count)
}

export function isBusinessDateLabel(label: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day
}

export function isBusinessDateRange(value: BusinessDateRange): boolean {
  return isBusinessDateLabel(value.from)
    && isBusinessDateLabel(value.to)
    && value.from <= value.to
}

/** Serialize the one supported dashboard URL contract: from/to date-only labels. */
export function dashboardDateRangeQuery(range: BusinessDateRange): string {
  if (!isBusinessDateRange(range)) throw new Error('INVALID_DATE_RANGE')
  return new URLSearchParams({ from: range.from, to: range.to }).toString()
}

/**
 * Parse the dashboard URL contract. Missing/blank dates default to Karachi
 * Today; either single supplied date becomes an inclusive one-day range.
 * `today` remains a read-only compatibility alias for old bookmarked URLs.
 */
export function resolveDashboardDateRange(
  params: DateSearchParams,
  now: Date = new Date(),
): BusinessDateRange | null {
  const defaultDate = bizDateString(now)
  const from = params.get('from')?.trim() || ''
  const to = params.get('to')?.trim() || ''
  const legacyToday = params.get('today')?.trim() || ''
  const single = from || to || legacyToday || defaultDate
  const range = {
    from: from || (to ? to : single),
    to: to || (from ? from : single),
  }
  return isBusinessDateRange(range) ? range : null
}

/** Format a Date as yyyy-MM-dd in Asia/Karachi. */
export function bizDateString(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) throw new Error('Invalid Date')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
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
