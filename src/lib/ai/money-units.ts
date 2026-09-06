/** Convert the ERP's canonical integer paisas to an exact PKR-rupee string. */
export function paisasToRupees(value: bigint | string | number): string {
  const paisas = BigInt(value)
  const negative = paisas < 0n
  const absolute = negative ? -paisas : paisas
  const whole = absolute / 100n
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}
