/**
 * Deterministic trend shaping for the command-center hero KPIs.
 *
 * Nothing here invents data. A comparison exists only when both the selected
 * period and the equally long preceding period were actually measured, and a
 * series exists only when a real per-day source covers every day in the range.
 * Flow metrics (sales, cash movement) can be bucketed by day; point-in-time
 * balances (receivables, payables) cannot, and callers must not try.
 */

export type TrendDirection = 'up' | 'down' | 'flat'

export type MetricComparison = {
  /** The measured value of the equally long preceding period. */
  previous: number
  delta: number
  direction: TrendDirection
  /**
   * Share of change, or null when a share would be meaningless — a zero or
   * negative base has no defensible percentage.
   */
  percent: number | null
}

/** A pre-normalised point: `date` is already a business-timezone day label. */
export type SeriesPoint = { date: string | null; value: number }

export function buildMetricComparison(input: {
  current: number | null
  previous: number | null
}): MetricComparison | null {
  const { current, previous } = input
  if (current === null || previous === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  const delta = current - previous
  return {
    previous,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    percent: previous > 0 ? Math.round((delta / previous) * 100) : null,
  }
}

/**
 * Buckets points into one value per day label. Returns null when there is no
 * readable shape to draw: fewer than two days, no measured source, or a period
 * with no movement at all (the card already states that in words).
 */
export function buildDailySeries(input: {
  labels: string[] | null
  points: SeriesPoint[] | null
}): number[] | null {
  const { labels, points } = input
  if (!labels || labels.length < 2 || !points) return null
  const buckets = new Map<string, number>(labels.map((label) => [label, 0]))
  for (const point of points) {
    if (!point.date || !Number.isFinite(point.value)) continue
    const bucket = point.date.slice(0, 10)
    const running = buckets.get(bucket)
    if (running === undefined) continue
    buckets.set(bucket, running + point.value)
  }
  const series = labels.map((label) => buckets.get(label) ?? 0)
  return series.some((value) => value !== 0) ? series : null
}

/**
 * Maps a series onto a unit box for an inline sparkline. A single flat value
 * renders on the mid-line instead of dividing by a zero range.
 */
export function sparklinePoints(series: number[], width: number, height: number): string | null {
  if (series.length < 2 || width <= 0 || height <= 0) return null
  const min = Math.min(...series, 0)
  const max = Math.max(...series, 0)
  const span = max - min
  const step = width / (series.length - 1)
  return series
    .map((value, index) => {
      const ratio = span === 0 ? 0.5 : (value - min) / span
      const y = height - ratio * height
      return `${(index * step).toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
