import type { Tables, Enums } from './database'

export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database'

export type Organization = Tables<'organizations'>
export type Store = Tables<'stores'>
export type Profile = Tables<'profiles'>
export type UserStoreAccess = Tables<'user_store_access'>
export type UserRole = Enums<'user_role'>
