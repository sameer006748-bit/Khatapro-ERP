import { BUSINESS_TZ, bizDateString, isBusinessDateRange, type BusinessDateRange } from '../dates.ts'

export const AI_PERIOD_PRESETS = ['today', 'last-3-days', 'last-7-days', 'this-month', 'custom'] as const
export type AiPeriodPreset = (typeof AI_PERIOD_PRESETS)[number]
export type AiPeriodInput = { preset: AiPeriodPreset; from?: string; to?: string }
export type ResolvedAiPeriod = BusinessDateRange & { preset: AiPeriodPreset; label: string; timezone: typeof BUSINESS_TZ }
const MAX_CUSTOM_DAYS = 366

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function resolveAiPeriod(input: AiPeriodInput | undefined, now: Date = new Date()): ResolvedAiPeriod {
  const today = bizDateString(now)
  const preset = input?.preset ?? 'this-month'
  if (preset === 'today') return { preset, from: today, to: today, label: 'Today', timezone: BUSINESS_TZ }
  if (preset === 'last-3-days') return { preset, from: addDays(today, -2), to: today, label: 'Last 3 Days', timezone: BUSINESS_TZ }
  if (preset === 'last-7-days') return { preset, from: addDays(today, -6), to: today, label: 'Last 7 Days', timezone: BUSINESS_TZ }
  if (preset === 'this-month') return { preset, from: `${today.slice(0, 8)}01`, to: today, label: 'This Month', timezone: BUSINESS_TZ }
  const range = { from: input?.from ?? '', to: input?.to ?? '' }
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1
  if (!isBusinessDateRange(range) || days > MAX_CUSTOM_DAYS) throw new Error('INVALID_AI_PERIOD')
  return { preset, ...range, label: 'Custom Range', timezone: BUSINESS_TZ }
}
