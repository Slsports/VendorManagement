/** When the first Claude key (Dana's Individual Org) should hand the request to the main key: out of credit or refused, or busy. */
export function firstKeyFallsBack(status: number, body: string): 'out' | 'busy' | null {
  if (status === 429 || status === 529) return 'busy'
  if (status === 401 || status === 402 || status === 403) return 'out'
  if (status === 400 && /credit balance|billing|spend limit|usage limit/i.test(body)) return 'out'
  return null
}
