export type GeminiFailureCode = 'invalid_key' | 'timeout' | 'connection_error' | 'empty_response'

export class GeminiClientError extends Error {
  code: GeminiFailureCode

  constructor(code: GeminiFailureCode) {
    super(code)
    this.code = code
  }
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

export async function callGeminiCore(args: {
  apiKey: string
  url: string
  body: Record<string, unknown>
  outputTokens: number
  timeoutMs: number
  fetchImpl?: typeof fetch
}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs)

  try {
    const response = await (args.fetchImpl ?? fetch)(args.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': args.apiKey,
      },
      body: JSON.stringify({
        ...args.body,
        generationConfig: { temperature: 0.2, maxOutputTokens: args.outputTokens },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) throw new GeminiClientError('invalid_key')
      throw new GeminiClientError('connection_error')
    }

    const payload = await response.json() as GeminiResponse
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()
    if (!text) throw new GeminiClientError('empty_response')
    return text
  } catch (error) {
    if (error instanceof GeminiClientError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw new GeminiClientError('timeout')
    throw new GeminiClientError('connection_error')
  } finally {
    clearTimeout(timeout)
  }
}
