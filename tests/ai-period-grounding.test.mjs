import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const [period, route, context, assistant, home, safety, numbers] = await Promise.all([
  readFile('src/lib/ai/ai-period.ts', 'utf8'), readFile('src/app/api/ai/ask/route.ts', 'utf8'),
  readFile('src/lib/ai/ai-context.ts', 'utf8'), readFile('src/components/erp/ai-assistant.tsx', 'utf8'),
  readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8'), readFile('src/lib/ai/safety-core.ts', 'utf8'), readFile('src/lib/ai/financial-safety.ts', 'utf8'),
])
for (const [name, pattern] of [
  ['Today range', /preset === 'today'/], ['Last 3 Days range', /last-3-days/], ['Last 7 Days range', /last-7-days/], ['This Month range', /this-month/],
  ['Valid Custom range', /isBusinessDateRange\(range\)/], ['Invalid end-before-start', /INVALID_AI_PERIOD/], ['Malformed range rejection', /INVALID_PERIOD/],
  ['Home-selected range reaches AI', /khatapro-ai-period/], ['Elsewhere default is labelled', /preset: 'this-month'/], ['Owner business isolation', /session\.businessId/],
  ['Salesman scope', /own_sales_only/], ['Rider scope', /assigned_deliveries_only/], ['restricted/inactive denial', /canUseAiForScreen/],
  ['client business override rejected', /\)\.strict\(\)/], ['unsupported figure refusal', /figure available nahi hai/], ['invented money rejected', /financialAnswerIsSupported/],
  ['current snapshot labels', /current_snapshot/], ['read-only request rejection', /READ_ONLY_REQUEST/], ['no stale cross-period context', /period: args\.period/], ['no stale cross-business context', /session\.businessId/],
]) test(name, () => assert.match(`${period}\n${route}\n${context}\n${assistant}\n${home}\n${safety}\n${numbers}`, pattern))
