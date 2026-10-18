import type { ItemChangeDecision, ItemChangeLsStatus } from '@/types/database'

/** Unavailable items (Dana, Oct 18): what Claude read and the Review buttons. */
export const ITEM_CHANGE_LABELS: Record<ItemChangeDecision | 'replaced' | 'unclear', string> = {
  replaced: 'Replaced', replacement: 'Use replacement', discontinued: 'Discontinued, no replacement', out_of_stock: 'Out of stock',
  dnr: 'DNR (do not reorder)', leave: 'Leave as is', unclear: 'Not clear', find_replacement: 'Find replacement', dont_need: 'Don’t need',
}

export const LS_STATUS_TEXT: Record<ItemChangeLsStatus, string> = {
  pending: 'Not written to Lightspeed yet.',
  written: 'Written to Lightspeed.',
  not_needed: 'Nothing to write to Lightspeed.',
  no_item: 'Not in Lightspeed.',
  no_access: 'Not written:',
  failed: 'Not written to Lightspeed:',
}
