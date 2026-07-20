import 'server-only'
import { AI_LIMITS } from '@/lib/ai/config'

type Bucket = { start: number; count: number }
const buckets = new Map<string, Bucket>()

export function consumeAiRequest(userId: string, now = Date.now()): boolean {
  const current = buckets.get(userId)
  if (!current || now - current.start >= 60_000) {
    buckets.set(userId, { start: now, count: 1 })
    return true
  }
  if (current.count >= AI_LIMITS.requestsPerMinute) return false
  current.count += 1
  return true
}
