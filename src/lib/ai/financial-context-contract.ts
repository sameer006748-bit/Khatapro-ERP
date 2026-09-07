export const FINANCIAL_FACT_KEYS = [
  'sales',
  'expenses',
  'profitLoss',
  'payables',
  'receivables',
] as const

export type FinancialFactKey = (typeof FINANCIAL_FACT_KEYS)[number]

const INTENT_PATTERNS: Record<FinancialFactKey, RegExp> = {
  sales: /\b(?:sale|sales|revenue|farokht)\b/i,
  expenses: /\b(?:expense|expenses|kharcha|kharchay|gaya)\b/i,
  profitLoss: /\b(?:profit|loss|p\s*&\s*l|p\/l|munafa|nuksan)\b/i,
  payables: /\b(?:payable|payables|supplier|vendor|dena|purchase)\b/i,
  receivables: /\b(?:receivable|receivables|recovery|customer|lena)\b/i,
}

export function requestedFinancialFacts(prompt: string): FinancialFactKey[] {
  return FINANCIAL_FACT_KEYS.filter((key) => INTENT_PATTERNS[key].test(prompt))
}

function hasObjectKey(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === 'object' && key in value)
}

export function availableFinancialFacts(
  context: Record<string, unknown>,
  requested: readonly FinancialFactKey[],
): FinancialFactKey[] {
  return requested.filter((key) => {
    if (key === 'sales' || key === 'expenses' || key === 'profitLoss') {
      return hasObjectKey(context.periodActivity, key)
    }
    return hasObjectKey(context.currentSnapshot, key)
  })
}

export function financialContextContract(
  prompt: string,
  context: Record<string, unknown>,
): {
  requested: FinancialFactKey[]
  available: FinancialFactKey[]
  missing: FinancialFactKey[]
  hasRelevantFacts: boolean
} {
  const requested = requestedFinancialFacts(prompt)
  const available = availableFinancialFacts(context, requested)
  const availableSet = new Set(available)
  const missing = requested.filter((key) => !availableSet.has(key))
  return {
    requested,
    available,
    missing,
    hasRelevantFacts: requested.length > 0 && missing.length === 0,
  }
}

export function isMissingContextAnswer(answer: string): boolean {
  return /\b(?:not enough relevant data is available|is sawal ke liye zaroori business data available nahi hai)\b/i.test(answer)
}
