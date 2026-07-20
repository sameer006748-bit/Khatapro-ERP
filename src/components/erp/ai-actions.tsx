'use client'

import { HelpCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiFieldMetadata, AiMode, AiScreen } from '@/lib/ai/safety-core'

type OpenAiDetail = {
  mode?: AiMode
  screen?: AiScreen
  prompt?: string
  field?: AiFieldMetadata
}

export function AiExplainButton({ screen }: { screen: AiScreen }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      onClick={() => window.dispatchEvent(new CustomEvent<OpenAiDetail>('khatapro-ai-open', { detail: {
        mode: 'explain',
        screen,
        prompt: 'Explain this screen or report, its most important point, any possible concern, and the recommended next check.',
      } }))}
    >
      <Sparkles className="size-3.5" /> Explain with KhataPro AI
    </Button>
  )
}

export function AiFieldHelp(props: {
  fieldName: string
  fieldLabel: string
  currentScreen: AiScreen
  role: string
  valueCategory?: string
  accountingContext?: string
}) {
  const field: AiFieldMetadata = {
    fieldName: props.fieldName,
    fieldLabel: props.fieldLabel,
    currentScreen: props.currentScreen,
    valueCategory: props.valueCategory,
    accountingContext: props.accountingContext,
  }
  return (
    <button
      type="button"
      className="inline-grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`KhataPro AI help for ${props.fieldLabel}`}
      title={`${props.fieldLabel} help for ${props.role}`}
      onClick={() => window.dispatchEvent(new CustomEvent<OpenAiDetail>('khatapro-ai-open', { detail: {
        mode: 'field-help',
        screen: props.currentScreen,
        field,
        prompt: `Explain the ${props.fieldLabel} field, what should be entered, and its accounting impact.`,
      } }))}
    >
      <HelpCircle className="size-3.5" />
    </button>
  )
}
