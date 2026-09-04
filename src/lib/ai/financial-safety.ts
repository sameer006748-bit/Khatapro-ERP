export type AllowedFinancialValue = { label: string; value: string; classification: 'period_activity' | 'current_snapshot' }
const MONEY = /(?:Rs\.?|PKR)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi
const normalized = (value: string) => value.replace(/,/g, '').replace(/^0+(?=\d)/, '') || '0'

export function financialAnswerIsSupported(answer: string, values: AllowedFinancialValue[]): boolean {
  const allowed = new Set(values.flatMap(({ value }) => {
    const paisas = BigInt(value)
    return [normalized(value), normalized((paisas / 100n).toString())]
  }))
  for (const match of answer.matchAll(MONEY)) if (!allowed.has(normalized(match[1]))) return false
  return true
}
