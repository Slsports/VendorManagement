import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { Tables } from '@/types/database'

// Dana's Dropbox (Oct 26): the admin connects once, names one folder, VMS lists it, Claude proposes where each file goes,
// Dana approves, VMS files. Later the same connection watches a scan inbox folder.
export interface DropboxCounts { total: number; new: number; proposed: number; sure_proposed: number; leftover: number; approved: number; filed: number; linked: number; skipped: number; errors: number }
export interface DropboxStatus {
  set_up: boolean; app_key: string | null; connected: boolean; connected_at: string | null; account_name: string | null; account_email: string | null
  folder_path: string | null; mode: 'history' | 'inbox'; move_filed: boolean; scan_done: boolean; reading: boolean
  last_scan_at: string | null; last_read_at: string | null; last_error: string | null; redirect_uri: string; files: DropboxCounts
  scan?: { listed: number; has_more: boolean }; read?: { read: number; proposed: number; leftover: number; linked: number; skipped: number; errors: number }; apply?: { filed: number; errors: number }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('dropbox', { body })
  if (error) throw await functionError(error)
  return data as T
}
export const dropboxStatus = () => call<DropboxStatus>({ action: 'status' })
export const saveDropboxAppKey = (appKey: string) => call<DropboxStatus>({ action: 'save_app_key', app_key: appKey })
export const dropboxSignInUrl = () => call<{ url: string }>({ action: 'authorize' }).then((r) => r.url)
export const finishDropboxSignIn = (code: string, state: string) => call<DropboxStatus>({ action: 'exchange', code, state })
export const disconnectDropbox = () => call<DropboxStatus>({ action: 'disconnect' })
export const listDropboxFolders = (path: string) => call<{ path: string; folders: { name: string; path: string }[] }>({ action: 'folders', path })
export const setDropboxFolder = (folderPath: string, mode: 'history' | 'inbox', moveFiled: boolean) => call<DropboxStatus>({ action: 'set_folder', folder_path: folderPath, mode, move_filed: moveFiled })
export const scanDropbox = () => call<DropboxStatus>({ action: 'scan' })
export const rescanDropbox = () => call<DropboxStatus>({ action: 'rescan' })
export const setDropboxReading = (on: boolean) => call<DropboxStatus>({ action: 'reading', on })
export const readDropboxNow = () => call<DropboxStatus>({ action: 'read' })
export const applyDropboxNow = () => call<DropboxStatus>({ action: 'apply' })

export type DropboxFile = Tables<'dropbox_files'> & { vendor: { name: string } | null }
export type DropboxFileStatus = Tables<'dropbox_files'>['status']
export type DropboxFolderSummary = { folder: string; total: number; new_count: number; proposed: number; leftover: number; approved: number; filed: number; linked: number; skipped: number; errors: number; sure_proposed: number; folder_skipped: number }

/** Each top folder under the one VMS reads, with its counts. */
export async function dropboxFolderSummary(organizationId: string): Promise<DropboxFolderSummary[]> {
  const { data, error } = await supabase.rpc('dropbox_top_summary', { p_org: organizationId })
  if (error) throw error
  return (data ?? []) as DropboxFolderSummary[]
}

export async function listDropboxFiles(organizationId: string, topFolder: string, statuses: DropboxFileStatus[], limit = 300): Promise<DropboxFile[]> {
  const { data, error } = await supabase.from('dropbox_files').select('*, vendor:vendors(name)').eq('organization_id', organizationId).eq('top_folder', topFolder).in('status', statuses).order('folder').order('name').limit(limit)
  if (error) throw error
  return (data ?? []) as DropboxFile[]
}

/** Approve a top folder's proposals (the sure ones, or all) or named files. Returns how many. */
export async function approveDropbox(organizationId: string, opts: { folder?: string | null; ids?: string[]; sureOnly: boolean }): Promise<number> {
  const { data, error } = await supabase.rpc('dropbox_approve', { p_org: organizationId, p_top: opts.folder ?? null, p_ids: opts.ids ?? null, p_sure_only: opts.sureOnly })
  if (error) throw error
  return Number(data ?? 0)
}

/** Skip a whole top folder (nothing in it is read or filed), or put it back. Returns how many files. */
export async function skipDropboxFolder(organizationId: string, topFolder: string, skip: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('dropbox_skip_folder', { p_org: organizationId, p_top: topFolder, p_skip: skip })
  if (error) throw error
  return Number(data ?? 0)
}

/** Dana's own answer for one file: which vendor and kind (vendor paper), or skip it, or put it back to proposed. */
export async function decideDropboxFile(id: string, userId: string, change: { status: 'approved' | 'skipped' | 'proposed'; vendor_id?: string | null; kind?: string | null; target?: 'vendor' | 'accounting' | 'skip'; skip_reason?: string | null }) {
  const { error } = await supabase.from('dropbox_files').update({ ...change, decided_by: userId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
