import type { Database, Tables, Enums } from './database'

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
export type ReviewAssignmentRule = Tables<'review_assignment_rules'>
export type ReviewRuleKind = ReviewAssignmentRule['match_kind']
export type VendorMerge = Tables<'vendor_merges'>
export type VendorDirectoryEntry = Tables<'vendor_directory'>
export type Line = Tables<'vendor_directory'>
export type ShowAppearance = Tables<'show_appearances'>
export type VendorLink = Tables<'vendor_links'>
export type VendorLinkKind = VendorLink['kind']
export type Order = Tables<'orders'>
export type OrderStatusHistory = Tables<'order_status_history'>
export type OrderStatus = Enums<'order_status'>
export type OrderSeason = Enums<'order_season'>
export type Partner = Tables<'partners'>
export type PartnerContact = Tables<'partner_contacts'>
export type BillingRoute = Enums<'billing_route'>
export type ContactType = Enums<'contact_type'>
export type OrderingFrequency = Enums<'ordering_frequency'>
export type OrderWindowKind = Enums<'order_window_kind'>
export type FreeShippingPolicy = NonNullable<Tables<'vendors'>['free_shipping_policy']>
export type FreeShippingBasis = NonNullable<Tables<'orders'>['free_shipping_basis']>
export type VendorRating = Tables<'vendor_ratings'>
export type ScoreDimension = VendorRating['dimension']
export type VendorScorecard = Database['public']['Functions']['vendor_scorecards']['Returns'][number]
export type VendorStanding = Tables<'vendors'>['standing']
export type StandingTag = 'shipping_fees' | 'damaged_goods' | 'order_mistakes' | 'unreliable_delivery' | 'bad_attitude' | 'slow_credits' | 'out_of_business' | 'discontinued_line' | 'overstocked' | 'other'
export type VendorItemRule = Tables<'vendor_item_rules'>
export type ItemRule = VendorItemRule['rule']
export type MailAccount = Tables<'mail_accounts'>
export type EmailSender = Tables<'email_senders'>
export type EmailSenderKind = EmailSender['kind']
export type EmailThread = Tables<'email_threads'>
export type EmailThreadStatus = EmailThread['status']
export type Email = Tables<'emails'>
export type EmailAttachment = Tables<'email_attachments'>
export type Need = Tables<'needs'>
