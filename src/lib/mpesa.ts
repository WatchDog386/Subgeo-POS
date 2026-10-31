// M-Pesa helpers. Payments are confirmed by the cashier typing the code from
// the customer's SMS; there is no phone prompt (STK push).

/** Normalise 07xx / 01xx / +254 numbers to 2547xxxxxxxx (WhatsApp / SMS links). */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (/^254[17]\d{8}$/.test(digits)) return digits
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1)
  if (/^[17]\d{8}$/.test(digits)) return '254' + digits
  return null
}

/** M-Pesa confirmation codes are 10 upper-case alphanumerics, e.g. SJK7XXXXXX. */
export function isValidMpesaCode(code: string): boolean {
  return /^[A-Z0-9]{10}$/.test(code.trim().toUpperCase())
}
