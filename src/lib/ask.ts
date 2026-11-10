import { ROUTES } from '@/lib/constants'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** A new Ask VMS chat; from a vendor's or an order's page it already knows which one. */
export function askLink(pathname: string): string {
  const v = new RegExp(`^${ROUTES.vendors}/(${UUID})`, 'i').exec(pathname)
  if (v) return `${ROUTES.ask}?vendor=${v[1]}`
  const o = new RegExp(`^${ROUTES.orders}/(${UUID})`, 'i').exec(pathname)
  if (o) return `${ROUTES.ask}?order=${o[1]}`
  return ROUTES.ask
}
