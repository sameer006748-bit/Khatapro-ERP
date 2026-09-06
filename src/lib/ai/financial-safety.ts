export type AllowedFinancialValue = {
  label: string
  amountRupees: string
  classification: 'period_activity' | 'as_of_snapshot' | 'current_snapshot'
}
// Currency-labelled numbers are always money. A comma-grouped or decimal
// number without a label is also treated as money, which catches provider
// replies such as "2,131,345" instead of letting a raw-paisa answer through.
const MONEY = /(?:(?:Rs\.?|PKR)\s*(-?[0-9][0-9,]*(?:\.\d{1,2})?)|(?<![\w.-])(-?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+\.[0-9]{1,2}))(?![\w.-]))/gi

function normalizedRupees(value: string): string | null {
  const plain = value.replace(/,/g, '')
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(plain)) return null
  const negative = plain.startsWith('-')
  const unsigned = negative ? plain.slice(1) : plain
  const [wholeText, fractionText = ''] = unsigned.split('.')
  const whole = BigInt(wholeText).toString()
  const fraction = fractionText.padEnd(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function financialAnswerIsSupported(answer: string, values: AllowedFinancialValue[]): boolean {
  const allowed = new Set(values.map(({ amountRupees }) => normalizedRupees(amountRupees)).filter(Boolean))
  for (const match of answer.matchAll(MONEY)) {
    const stated = normalizedRupees(match[1] ?? match[2])
    if (!stated || !allowed.has(stated)) return false
  }
  return true
}
