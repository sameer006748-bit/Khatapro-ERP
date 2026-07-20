'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Loader2, RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { MeUser } from '@/components/erp/erp-app'
import { AI_SCREENS, parseStructuredAnswer, type AiFieldMetadata, type AiLanguage, type AiMode, type AiScreen, type AiStructuredAnswer } from '@/lib/ai/safety-core'

type OpenAiDetail = {
  mode?: AiMode
  screen?: AiScreen
  prompt?: string
  field?: AiFieldMetadata
  submit?: boolean
}

type Message = { id: string; kind: 'question' | 'answer' | 'error'; text: string }

const SCREEN_SET = new Set<string>(AI_SCREENS)

const SUGGESTIONS: Record<string, string[]> = {
  'Owner/Admin': ["Explain today's business position.", 'Why can profit be positive while cash is low?', 'Summarize recoveries and payables.'],
  Accountant: ['Explain the Trial Balance.', 'Explain debit and credit in simple terms.', 'What should I check in the financial reports?'],
  Salesman: ['Summarize my sales and collections.', 'Explain the outstanding amount.', 'Explain the invoice fields.'],
  Rider: ['Explain my assigned deliveries.', 'Explain cash-on-delivery collection.', 'When should each delivery status be used?'],
}

function normalizeScreen(screen: string): AiScreen {
  return SCREEN_SET.has(screen) ? screen as AiScreen : 'home'
}



async function askAi(payload: {
  prompt: string
  language: AiLanguage
  mode: AiMode
  screen: AiScreen
  field?: AiFieldMetadata
}) {
  const response = await fetch('/api/ai/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(json?.message ?? 'KhataPro AI could not respond right now. Please try again.') as Error & { code?: string }
    error.code = json?.error
    throw error
  }
  return String(json.answer ?? '')
}

export function AiAssistant({ user, activeScreen }: { user: MeUser; activeScreen: string }) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState<AiLanguage>('roman-urdu')
  const [screen, setScreen] = useState<AiScreen>(() => normalizeScreen(activeScreen))
  const [mode, setMode] = useState<AiMode>('ask')
  const [field, setField] = useState<AiFieldMetadata | undefined>()
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [showRetryingState, setShowRetryingState] = useState(false)
  const [lastRequest, setLastRequest] = useState<{ prompt: string; language: AiLanguage; mode: AiMode; screen: AiScreen; field?: AiFieldMetadata } | null>(null)

  useEffect(() => {
    setScreen(normalizeScreen(activeScreen))
  }, [activeScreen])

  useEffect(() => {
    if (!loading) {
      setShowRetryingState(false)
      return
    }
    const timer = window.setTimeout(() => setShowRetryingState(true), 4000)
    return () => window.clearTimeout(timer)
  }, [loading])

  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent<OpenAiDetail>).detail ?? {}
      const nextScreen = detail.screen ?? normalizeScreen(activeScreen)
      setScreen(nextScreen)
      setMode(detail.mode ?? 'ask')
      setField(detail.field)
      setOpen(true)
      if (detail.prompt) setPrompt(detail.prompt)
      if (detail.prompt && detail.submit) void submit({
        prompt: detail.prompt,
        language,
        mode: detail.mode ?? 'ask',
        screen: nextScreen,
        field: detail.field,
      })
    }
    window.addEventListener('khatapro-ai-open', handle)
    return () => window.removeEventListener('khatapro-ai-open', handle)
  }, [activeScreen, language])

  const suggestions = useMemo(() => SUGGESTIONS[user.roleName] ?? ['Explain this screen in simple terms.'], [user.roleName])

  async function submit(request?: { prompt: string; language: AiLanguage; mode: AiMode; screen: AiScreen; field?: AiFieldMetadata }) {
    const next = request ?? { prompt: prompt.trim(), language, mode, screen, field }
    if (!next.prompt || loading) return
    setLoading(true)
    setLastRequest(next)
    setMessages((items) => [...items, { id: crypto.randomUUID(), kind: 'question', text: next.prompt }])
    setPrompt('')
    try {
      const answer = await askAi(next)
      setMessages((items) => [...items, { id: crypto.randomUUID(), kind: 'answer', text: answer }])
    } catch (error) {
      setMessages((items) => [...items, { id: crypto.randomUUID(), kind: 'error', text: error instanceof Error ? error.message : 'KhataPro AI could not respond right now. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => { setScreen(normalizeScreen(activeScreen)); setMode('ask'); setField(undefined); setOpen(true) }}
        className="fixed z-40 right-4 md:right-6 bottom-24 md:bottom-6 h-12 rounded-full shadow-lg px-4 gap-2"
        aria-label="Ask KhataPro AI"
      >
        <Sparkles className="size-4" />
        <span className="hidden sm:inline">Ask KhataPro AI</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 gap-0">
          <SheetHeader className="border-b border-border pr-12">
            <SheetTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" /> Ask KhataPro AI</SheetTitle>
            <SheetDescription>Read-only business and accounting assistance.</SheetDescription>
          </SheetHeader>

          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/20">
            <div className="flex rounded-lg border border-border p-0.5" aria-label="AI response language">
              <button type="button" onClick={() => setLanguage('roman-urdu')} aria-pressed={language === 'roman-urdu'} className={`px-2 py-1 text-xs rounded-md ${language === 'roman-urdu' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Roman Urdu</button>
              <button type="button" onClick={() => setLanguage('simple-english')} aria-pressed={language === 'simple-english'} className={`px-2 py-1 text-xs rounded-md ${language === 'simple-english' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Simple English</button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setMessages([]); setLastRequest(null) }} disabled={!messages.length || loading} aria-label="Clear conversation"><Trash2 className="size-4" /></Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!messages.length && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Ask for a short business or accounting explanation based on the information you are allowed to view.
                </div>
                <div className="space-y-2">
                  {suggestions.map((question) => (
                    <button key={question} type="button" onClick={() => setPrompt(question)} className="w-full text-left text-sm rounded-lg border border-border px-3 py-2 hover:bg-muted/40">{question}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => {
              if (message.kind === 'question') return <div key={message.id} className="ml-8 rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm">{message.text}</div>
              if (message.kind === 'error') return (
                <div key={message.id} className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {message.text}
                  {lastRequest && <Button type="button" size="sm" variant="outline" className="mt-2 w-full" onClick={() => void submit(lastRequest)} disabled={loading}><RotateCcw className="size-3.5" /> Retry</Button>}
                </div>
              )
              const sections = parseStructuredAnswer(message.text)
              return (
                <div key={message.id} className="rounded-xl border border-border bg-card p-3 text-sm space-y-3">
                  {sections.simpleAnswer && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">Summary</div>
                      <p className="whitespace-pre-wrap">{sections.simpleAnswer}</p>
                    </div>
                  )}
                  {sections.accountingEffect && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">Accounting Impact</div>
                      <p className="whitespace-pre-wrap text-muted-foreground">{sections.accountingEffect}</p>
                    </div>
                  )}
                  {sections.nextCheck && <div><div className="text-xs font-semibold text-muted-foreground mb-1">Recommended Check</div><p className="whitespace-pre-wrap">{sections.nextCheck}</p></div>}
                </div>
              )
            })}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {showRetryingState
                  ? 'The response could not be completed. Retrying...'
                  : 'KhataPro AI is reviewing your business data...'}
              </div>
            )}
          </div>

          <form className="border-t border-border p-4 space-y-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1200} rows={3} placeholder={mode === 'field-help' ? 'What would you like to understand about this field?' : 'Enter your question...'} disabled={loading} aria-label="Question for KhataPro AI" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">{prompt.length}/1200 · Read-only</span>
              <Button type="submit" size="sm" disabled={loading || prompt.trim().length < 2}><Send className="size-3.5" /> Ask</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
