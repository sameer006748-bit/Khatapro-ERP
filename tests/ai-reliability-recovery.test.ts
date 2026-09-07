import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  callGeminiCore,
  classifyGeminiFailure,
  GeminiClientError,
  runGeminiWithSingleRetry,
} from '../src/lib/ai/gemini-client-core.ts'
import {
  financialContextContract,
  isMissingContextAnswer,
  requestedFinancialFacts,
} from '../src/lib/ai/financial-context-contract.ts'
import { financialAnswerIsSupported, financialAnswerUsesSupportedValue } from '../src/lib/ai/financial-safety.ts'
import { paisasToRupees } from '../src/lib/ai/money-units.ts'
import { buildSystemInstruction, resolveAnswerLanguage } from '../src/lib/ai/safety-core.ts'

const complete = '{"simpleAnswer":"Aaj ki sales PKR 20,000.00 hain.","accountingEffect":"Sales activity record hui hai.","nextCheck":"Sales List verify karein."}'

function validateComplete(text: string) {
  return text === complete
    ? { valid: true as const, value: text }
    : { valid: false as const, retryable: true, reason: 'incomplete' }
}

test('one successful Ask contract produces one provider attempt', async () => {
  let calls = 0
  const result = await runGeminiWithSingleRetry({
    call: async () => { calls += 1; return complete },
    validate: validateComplete,
  })
  assert.equal(calls, 1)
  assert.equal(result, complete)
})

test('frontend has no automatic retry loop and leaves Retry as a manual action', async () => {
  const assistant = await readFile(new URL('../src/components/erp/ai-assistant.tsx', import.meta.url), 'utf8')
  assert.equal(assistant.match(/fetch\('\/api\/ai\/ask'/g)?.length, 1)
  assert.match(assistant, /onClick=\{\(\) => void submit\(lastRequest\)\}/)
  assert.doesNotMatch(assistant, /setInterval|retryDelay|maxRetries/)
})

test('upstream 429 without Retry-After is classified as quota exhaustion', () => {
  assert.equal(classifyGeminiFailure(429, 'RESOURCE_EXHAUSTED', [], false), 'quota_exceeded')
})

test('upstream 429 with Retry-After is classified as rate limited', () => {
  assert.equal(classifyGeminiFailure(429, 'RESOURCE_EXHAUSTED', [], true), 'rate_limited')
})

for (const category of ['quota_exceeded', 'rate_limited', 'invalid_api_key', 'permission_denied'] as const) {
  test(`${category} is never retried automatically`, async () => {
    let calls = 0
    await assert.rejects(
      runGeminiWithSingleRetry({
        call: async () => { calls += 1; throw new GeminiClientError(category, 429, 'RESOURCE_EXHAUSTED') },
        validate: validateComplete,
      }),
      (error: unknown) => error instanceof GeminiClientError && error.category === category,
    )
    assert.equal(calls, 1)
  })
}

for (const category of ['timeout', 'provider_unavailable'] as const) {
  test(`${category} receives exactly one backend-owned retry`, async () => {
    let calls = 0
    await assert.rejects(
      runGeminiWithSingleRetry({
        call: async () => { calls += 1; throw new GeminiClientError(category, null, 'TRANSIENT') },
        validate: validateComplete,
      }),
      (error: unknown) => error instanceof GeminiClientError && error.category === category,
    )
    assert.equal(calls, 2)
  })
}

test('MAX_TOKENS remains distinct and is not retried', async () => {
  let calls = 0
  await assert.rejects(
    runGeminiWithSingleRetry({
      call: async () => { calls += 1; throw new GeminiClientError('truncated', 200, 'MAX_TOKENS') },
      validate: validateComplete,
    }),
    (error: unknown) => error instanceof GeminiClientError && error.googleErrorCode === 'MAX_TOKENS',
  )
  assert.equal(calls, 1)
})

test('local invalid structure is not mislabeled as provider unavailability or retried', async () => {
  let calls = 0
  await assert.rejects(
    runGeminiWithSingleRetry({
      call: async () => { calls += 1; return 'not-json' },
      validate: () => ({ valid: false, retryable: true, reason: 'invalid_structure' }),
    }),
    (error: unknown) => error instanceof GeminiClientError
      && error.category === 'invalid_response'
      && error.googleErrorCode === 'LOCAL_INVALID_RESPONSE',
  )
  assert.equal(calls, 1)
})

test('Gemini request merges the structured JSON response contract into generationConfig', async () => {
  let capturedBody = ''
  const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = String(init?.body)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: complete }] }, finishReason: 'STOP' }] }), { status: 200 })
  }) as typeof fetch
  await callGeminiCore({
    apiKey: 'test-key',
    url: 'https://example.invalid',
    body: { generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } } },
    outputTokens: 2048,
    timeoutMs: 100,
    thinking: { thinkingLevel: 'low' },
    fetchImpl: mockFetch,
  })
  const body = JSON.parse(capturedBody)
  assert.equal(body.generationConfig.responseMimeType, 'application/json')
  assert.deepEqual(body.generationConfig.responseSchema, { type: 'OBJECT' })
  assert.equal(body.generationConfig.maxOutputTokens, 2048)
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' })
})

test('Today sales, expense and profit/loss intents are selected deterministically', () => {
  assert.deepEqual(requestedFinancialFacts('Aaj ki sales kitni hain?'), ['sales'])
  assert.deepEqual(requestedFinancialFacts('Aaj ka expense kitna hai?'), ['expenses'])
  assert.deepEqual(requestedFinancialFacts('Aaj ka profit/loss simple Roman Urdu mein batao.'), ['profitLoss'])
})

test('current payable and receivables intents are selected as snapshots', () => {
  assert.deepEqual(requestedFinancialFacts('Mera current payable kitna hai?'), ['payables'])
  assert.deepEqual(requestedFinancialFacts('Meri current receivables kitni hain?'), ['receivables'])
})

test('all five requested financial facts are recognized as available, including zero', () => {
  const context = {
    periodActivity: { sales: { billedRupees: '0.00' }, expenses: { totalRupees: '21313.45' }, profitLoss: { netProfitRupees: '-880.00' } },
    currentSnapshot: { payables: { totalRupees: '150100.00' }, receivables: { totalRupees: '20000.00' } },
  }
  for (const prompt of [
    'Aaj ki sales kitni hain?',
    'Aaj ka expense kitna hai?',
    'Aaj ka profit/loss batao.',
    'Mera current payable kitna hai?',
    'Meri current receivables kitni hain?',
  ]) {
    const contract = financialContextContract(prompt, context)
    assert.equal(contract.hasRelevantFacts, true)
    assert.deepEqual(contract.missing, [])
  }
})

test('a missing requested aggregate is explicit instead of silently reaching the model', () => {
  const contract = financialContextContract('Aaj ki sales kitni hain?', { periodActivity: {}, currentSnapshot: {} })
  assert.deepEqual(contract.missing, ['sales'])
  assert.equal(contract.hasRelevantFacts, false)
})

test('available deterministic context cannot accept either missing-data fallback phrase', () => {
  assert.equal(isMissingContextAnswer('Not enough relevant data is available for this question.'), true)
  assert.equal(isMissingContextAnswer('Is sawal ke liye zaroori business data available nahi hai.'), true)
})

test('Roman Urdu survives selection and demands Latin-script Roman Urdu while preserving facts', () => {
  const language = resolveAnswerLanguage('Aaj ki sales kitni hain?', 'roman-urdu')
  const instruction = buildSystemInstruction(language)
  assert.equal(language, 'roman-urdu')
  assert.match(instruction, /Reply only in natural, professional Roman Urdu using Latin script/)
  assert.match(instruction, /Do not write an English sentence/)
  assert.match(instruction, /number, entity name and technical code exactly/)
  assert.match(instruction, /Is sawal ke liye zaroori business data available nahi hai/)
  assert.doesNotMatch(instruction, /put exactly "Not enough relevant data/)
})

test('explicit English request remains the only language override', () => {
  assert.equal(resolveAnswerLanguage('Please answer in English.', 'roman-urdu'), 'simple-english')
  assert.equal(resolveAnswerLanguage('Please explain sales.', 'roman-urdu'), 'roman-urdu')
})

test('paisa conversion happens exactly once for known production magnitudes', () => {
  assert.equal(paisasToRupees(2_000_000n), '20000.00')
  assert.equal(paisasToRupees(2_131_345n), '21313.45')
  assert.equal(paisasToRupees(15_010_000n), '150100.00')
})

test('all known 100x regressions are rejected by the financial answer guard', () => {
  const allowed = [
    { label: 'Sales', amountRupees: '20000.00', classification: 'period_activity' as const },
    { label: 'Expenses', amountRupees: '21313.45', classification: 'period_activity' as const },
    { label: 'Payables', amountRupees: '150100.00', classification: 'current_snapshot' as const },
  ]
  assert.equal(financialAnswerIsSupported('PKR 20,000.00; PKR 21,313.45; PKR 150,100.00.', allowed), true)
  assert.equal(financialAnswerIsSupported('PKR 2,000,000.', allowed), false)
  assert.equal(financialAnswerIsSupported('PKR 2,131,345.', allowed), false)
  assert.equal(financialAnswerIsSupported('PKR 15,010,000.', allowed), false)
  assert.equal(financialAnswerUsesSupportedValue('Business position available hai.', allowed), false)
  assert.equal(financialAnswerUsesSupportedValue('Sales PKR 20,000.00 hain.', allowed), true)
})

test('Ask route distinguishes local throttling, upstream limits, incomplete output and bad context', async () => {
  const route = await readFile(new URL('../src/app/api/ai/ask/route.ts', import.meta.url), 'utf8')
  assert.match(route, /'RATE_LIMITED'/)
  assert.match(route, /'AI_TEMPORARILY_UNAVAILABLE'/)
  assert.match(route, /'AI_RESPONSE_INCOMPLETE'/)
  assert.match(route, /'AI_RESPONSE_INVALID'/)
  assert.match(route, /'AI_DATA_UNAVAILABLE'/)
  assert.match(route, /ai_ask_provider_failed/)
})

test('specific Home financial questions no longer load every unrelated report', async () => {
  const context = await readFile(new URL('../src/lib/ai/ai-context.ts', import.meta.url), 'utf8')
  assert.match(context, /screen === 'home' && requestedFacts\.length === 0/)
  assert.match(context, /requestedFacts\.forEach\(\(name\) => names\.add\(name\)\)/)
})
