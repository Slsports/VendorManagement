// Artwork approvals (Dana, Oct 10): how long a proof has waited on us.
export function artWaitDays(since: string | null): number {
  if (!since) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000))
}
