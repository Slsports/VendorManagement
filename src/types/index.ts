import type { Tables, Enums } from './database'

export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database'

export type Organization = Tables<'organizations'>
export type Store = Tables<'stores'>
export type Profile = Tables<'profiles'>
export type UserStoreAccess = Tables<'user_store_access'>
export type UserRole = Enums<'user_role'>

export type Vendor = Tables<'vendors'>
export type VendorBillingRoute = Tables<'vendor_billing_routes'>
export type VendorEmail = Tables<'vendor_emails'>
export type VendorOrderWindow = Tables<'vendor_order_windows'>
export type RepGroup = Tables<'rep_groups'>
export type Category = Tables<'categories'>
export type PaymentTerms = Tables<'payment_terms'>
export type Note = Tables<'notes'>
export type ActivityLogEntry = Tables<'activity_log'>
export type ReviewItem = Tables<'review_items'>
export type VendorMerge = Tables<'vendor_merges'>
export type VendorDirectoryEntry = Tables<'vendor_directory'>
export type Line = Tables<'vendor_directory'>
export type ShowAppearance = Tables<'show_appearances'>
export type VendorLink = Tables<'vendor_links'>
export type VendorLinkKind = VendorLink['kind']
export type BillingRoute = Enums<'billing_route'>
export type ContactType = Enums<'contact_type'>
export type OrderingFrequency = Enums<'ordering_frequency'>
export type OrderWindowKind = Enums<'order_window_kind'>
