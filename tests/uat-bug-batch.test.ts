import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolveAnswerLanguage } from '../src/lib/ai/safety-core.ts'
import { GeminiClientError, runGeminiWithSingleRetry } from '../src/lib/ai/gemini-client-core.ts'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const deliveryView = await source('src/components/erp/views/delivery-view.tsx')
const accountsView = await source('src/components/erp/views/accounts-view.tsx')
const aiAssistant = await source('src/components/erp/ai-assistant.tsx')
const askRoute = await source('src/app/api/ai/ask/route.ts')
const geminiClient = await source('src/lib/ai/gemini-client.ts')

// ── A. Rider false-empty loading state ────────────────────────────────────

test('Riders tab gates the true empty state behind loading and error checks', () => {
  const loadingAt = deliveryView.indexOf('ridersQ.isLoading')
  const errorAt = deliveryView.indexOf('ridersQ.isError')
  const emptyAt = deliveryView.indexOf('No riders yet.')
  assert.ok(loadingAt > -1 && errorAt > -1 && emptyAt > -1)
  assert.ok(emptyAt > loadingAt, 'empty state must be gated behind the loading check')
})

test('Riders count reflects loaded rows and never shows a premature zero', () => {
  assert.match(deliveryView, /Riders \(\{ridersQ\.isLoading \? '…' : riders\.length\}\)/)
  assert.doesNotMatch(deliveryView, /Riders \(\{riders\.length\}\)/)
})

// ── B. Roman Urdu contract ────────────────────────────────────────────────

test('Roman Urdu selection is authoritative unless the prompt asks for the other language', () => {
  assert.equal(resolveAnswerLanguage('Please explain this Trial Balance report.', 'roman-urdu'), 'roman-urdu')
  assert.equal(resolveAnswerLanguage('Aaj business ki position kya hai?', 'simple-english'), 'simple-english')
  assert.equal(resolveAnswerLanguage('Please answer in English.', 'roman-urdu'), 'simple-english')
  assert.equal(resolveAnswerLanguage('Roman Urdu mein batao.', 'simple-english'), 'roman-urdu')
})

test('language is part of the AI request contract and reaches the system instruction', () => {
  assert.match(askRoute, /language: z\.enum\(AI_LANGUAGES\)/)
  assert.match(askRoute, /resolveAnswerLanguage\(parsed\.data\.prompt, parsed\.data\.language\)/)
  assert.match(aiAssistant, /language: AiLanguage/)
  assert.match(geminiClient, /buildSystemInstruction\(args\.language/)
})

// ── C. Mojibake ───────────────────────────────────────────────────────────

test('no mojibake remains in the touched client-facing views', () => {
  assert.doesNotMatch(deliveryView, /\u00e2\u20ac/)
  assert.doesNotMatch(accountsView, /\u00e2\u20ac/)
})

// ── D. AI retry / loading UX ──────────────────────────────────────────────

test('automatic retry is bounded and owned by the backend', async () => {
  let calls = 0
  await assert.rejects(
    runGeminiWithSingleRetry({
      call: async () => { calls += 1; throw new GeminiClientError('timeout', null, 'CLIENT_TIMEOUT') },
      validate: () => ({ valid: true, value: 'x' }),
    }),
    (error: unknown) => error instanceof GeminiClientError && error.category === 'timeout',
  )
  assert.equal(calls, 2)
})

test('non-transient failures are not automatically retried', async () => {
  let calls = 0
  await assert.rejects(
    runGeminiWithSingleRetry({
      call: async () => { calls += 1; throw new GeminiClientError('invalid_api_key', 401, 'INVALID') },
      validate: () => ({ valid: true, value: 'x' }),
    }),
    (error: unknown) => error instanceof GeminiClientError && error.category === 'invalid_api_key',
  )
  assert.equal(calls, 1)
})

test('frontend shows an honest in-progress status and a manual retry control', () => {
  assert.match(aiAssistant, /Still working — a slow connection can make this take a little longer\./)
  assert.match(aiAssistant, /RotateCcw[^>]*\/> Retry/)
  assert.doesNotMatch(aiAssistant, /The response could not be completed\. Retrying/)
})
