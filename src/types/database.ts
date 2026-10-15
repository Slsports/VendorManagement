/**
 * Database types for the tables created in supabase/migrations.
 *
 * Hand-written for migration 0001. Once the Supabase CLI is linked, regenerate with:
 *   npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > src/types/database.ts
 */
/** A charge a vendor always adds (Dana, Oct 15: Planet Cotton's tags). */
export interface UsualCharge { what: string; price: number | null; per: string | null }
export type PictureKind = 'product' | 'proof' | 'advertising' | 'logo' | 'other'
export type OrderCheckStatus = 'reading' | 'needs_order' | 'comparing' | 'to_review' | 'done' | 'not_paperwork' | 'dismissed' | 'failed'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          legal_name: string | null
          app_name: string | null
          signature_template: string | null
          edenred_url: string | null
          billcom_url: string | null
          confirm_email_subject: string
          confirm_email_body: string
          logo_url: string | null
          logo_dark_url: string | null
          accent_color: string
          settings: Json
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          legal_name?: string | null
          app_name?: string | null
          signature_template?: string | null
          edenred_url?: string | null
          billcom_url?: string | null
          confirm_email_subject?: string
          confirm_email_body?: string
          logo_url?: string | null
          logo_dark_url?: string | null
          accent_color?: string
          settings?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          legal_name?: string | null
          app_name?: string | null
          signature_template?: string | null
          edenred_url?: string | null
          billcom_url?: string | null
          confirm_email_subject?: string
          confirm_email_body?: string
          logo_url?: string | null
          logo_dark_url?: string | null
          accent_color?: string
          settings?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          id: string
          organization_id: string
          code: string
          name: string
          aliases: string[]
          address: string | null
          city: string | null
          state: string | null
          postal_code: string | null
          phone: string | null
          email: string | null
          sort_order: number
          is_active: boolean
          ls_shop_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          code: string
          name: string
          aliases?: string[]
          address?: string | null
          city?: string | null
          state?: string | null
          postal_code?: string | null
          phone?: string | null
          email?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          code?: string
          name?: string
          aliases?: string[]
          address?: string | null
          city?: string | null
          state?: string | null
          postal_code?: string | null
          phone?: string | null
          email?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stores_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          organization_id: string
          email: string
          full_name: string
          role: Database['public']['Enums']['user_role']
          avatar_url: string | null
          phone: string | null
          is_active: boolean
          created_at: string
          updated_at: string
       ; email_signature: string | null; signature_name: string | null; job_title: string | null; direct_phone: string | null; places_orders: boolean; sees_freight: boolean; dashboard_layout: Json | null; remind_dashboard: boolean; remind_email: boolean; remind_text: boolean; mobile_phone: string | null; reviews_ls_pos: boolean }
        Insert: {
          id: string
          organization_id: string
          email: string
          full_name?: string
          role?: Database['public']['Enums']['user_role']
          avatar_url?: string | null
          phone?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
       ; email_signature?: string | null; signature_name?: string | null; job_title?: string | null; direct_phone?: string | null; places_orders?: boolean; sees_freight?: boolean; dashboard_layout?: Json | null; remind_dashboard?: boolean; remind_email?: boolean; remind_text?: boolean; mobile_phone?: string | null; reviews_ls_pos?: boolean }
        Update: {
          id?: string
          organization_id?: string
          email?: string
          full_name?: string
          role?: Database['public']['Enums']['user_role']
          avatar_url?: string | null
          phone?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
       ; email_signature?: string | null; signature_name?: string | null; job_title?: string | null; direct_phone?: string | null; places_orders?: boolean; sees_freight?: boolean; dashboard_layout?: Json | null; remind_dashboard?: boolean; remind_email?: boolean; remind_text?: boolean; mobile_phone?: string | null; reviews_ls_pos?: boolean }
        Relationships: [
          {
            foreignKeyName: 'profiles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      user_store_access: {
        Row: {
          user_id: string
          store_id: string
          granted_by: string | null
          created_at: string
        }
        Insert: {
          user_id: string
          store_id: string
          granted_by?: string | null
          created_at?: string
        }
        Update: {
          user_id?: string
          store_id?: string
          granted_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_store_access_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_store_access_store_id_fkey'
            columns: ['store_id']
            isOneToOne: false
            referencedRelation: 'stores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_store_access_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      categories: {
        Row: { id: string; organization_id: string; name: string; parent_id: string | null; full_path: string | null; lightspeed_category_id: string | null; sort_order: number; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; name: string; parent_id?: string | null; full_path?: string | null; lightspeed_category_id?: string | null; sort_order?: number; is_active?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; name?: string; parent_id?: string | null; full_path?: string | null; lightspeed_category_id?: string | null; sort_order?: number; is_active?: boolean; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'categories_organization_id_fkey'; columns: ['organization_id']; isOneToOne: false; referencedRelation: 'organizations'; referencedColumns: ['id'] },
          { foreignKeyName: 'categories_parent_id_fkey'; columns: ['parent_id']; isOneToOne: false; referencedRelation: 'categories'; referencedColumns: ['id'] },
        ]
      }
      rep_groups: {
        Row: { id: string; organization_id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; address: string | null; notes: string | null; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; name: string; contact_name?: string | null; email?: string | null; phone?: string | null; website?: string | null; address?: string | null; notes?: string | null; is_active?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; name?: string; contact_name?: string | null; email?: string | null; phone?: string | null; website?: string | null; address?: string | null; notes?: string | null; is_active?: boolean; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'rep_groups_organization_id_fkey'; columns: ['organization_id']; isOneToOne: false; referencedRelation: 'organizations'; referencedColumns: ['id'] },
        ]
      }
      payment_terms: {
        Row: { id: string; organization_id: string; name: string; days_until_due: number; discount_percent: number | null; discount_days: number | null; due_day_of_month: number | null; is_default: boolean; is_active: boolean; sort_order: number; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; name: string; days_until_due?: number; discount_percent?: number | null; discount_days?: number | null; due_day_of_month?: number | null; is_default?: boolean; is_active?: boolean; sort_order?: number; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; name?: string; days_until_due?: number; discount_percent?: number | null; discount_days?: number | null; due_day_of_month?: number | null; is_default?: boolean; is_active?: boolean; sort_order?: number; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'payment_terms_organization_id_fkey'; columns: ['organization_id']; isOneToOne: false; referencedRelation: 'organizations'; referencedColumns: ['id'] },
        ]
      }
      vendors: {
        Row: {
          id: string; organization_id: string; name: string; lightspeed_name: string | null; lightspeed_vendor_id: string | null; po_code: string | null; aliases: string[]
          rep_group_id: string | null; assigned_buyer_id: string | null; payment_terms_id: string | null
          website: string | null; account_number: string | null; catalog: string | null; phone: string | null; fax: string | null
          address: string | null; city: string | null; state: string | null; postal_code: string | null; country: string | null
          rep_name: string | null; rep_phone: string | null; pickup_address: string | null; pickup_times: string | null
          shipping_contact: string | null; shipping_contact_phone: string | null; email: string | null; rep_email: string | null; shipping_contact_email: string | null; return_notes: string | null; google_drive_folder: string | null
          rating: number | null; tier: string | null; ordering_frequency: Database['public']['Enums']['ordering_frequency'] | null
          is_delivery_vendor: boolean; minimum_order: string | null; freight_program: string | null; free_shipping_policy: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold: number | null; freight_routing: string | null; freight_allowance_on_time: boolean; vid_in_description: boolean; product_types: string | null; notes: string | null; needs_review: boolean; review_note: string | null; do_not_order: boolean; do_not_order_reason: string | null; standing: 'ok' | 'hold' | 'last_resort' | 'do_not_order'; standing_tags: string[]; standing_review_date: string | null; merged_into_id: string | null; wwd_zero_upcharge: boolean; report_owner: string | null; is_fishing: boolean; web_orders: boolean; order_methods: string[]; freight_programs_vendor: string | null; info_confirmed_at: string | null; assigned_rep_contact_id: string | null; assigned_rep_group_contact_id: string | null
          is_active: boolean; created_by: string | null; created_at: string; updated_at: string
          ask_before_pictures: boolean; usual_charges: UsualCharge[]; order_set_at_show: boolean
        }
        Insert: {
          id?: string; organization_id: string; name: string; lightspeed_name?: string | null; lightspeed_vendor_id?: string | null; po_code?: string | null; aliases?: string[]
          rep_group_id?: string | null; assigned_buyer_id?: string | null; payment_terms_id?: string | null
          website?: string | null; account_number?: string | null; catalog?: string | null; phone?: string | null; fax?: string | null
          address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null
          rep_name?: string | null; rep_phone?: string | null; pickup_address?: string | null; pickup_times?: string | null
          shipping_contact?: string | null; shipping_contact_phone?: string | null; email?: string | null; rep_email?: string | null; shipping_contact_email?: string | null; return_notes?: string | null; google_drive_folder?: string | null
          rating?: number | null; tier?: string | null; ordering_frequency?: Database['public']['Enums']['ordering_frequency'] | null
          is_delivery_vendor?: boolean; minimum_order?: string | null; freight_program?: string | null; free_shipping_policy?: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold?: number | null; freight_routing?: string | null; freight_allowance_on_time?: boolean; vid_in_description?: boolean; product_types?: string | null; notes?: string | null; needs_review?: boolean; review_note?: string | null; do_not_order?: boolean; do_not_order_reason?: string | null; standing?: 'ok' | 'hold' | 'last_resort' | 'do_not_order'; standing_tags?: string[]; standing_review_date?: string | null; merged_into_id?: string | null; wwd_zero_upcharge?: boolean; report_owner?: string | null; is_fishing?: boolean; web_orders?: boolean; order_methods?: string[]; freight_programs_vendor?: string | null; info_confirmed_at?: string | null; assigned_rep_contact_id?: string | null; assigned_rep_group_contact_id?: string | null
          is_active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string
          ask_before_pictures?: boolean; usual_charges?: UsualCharge[]; order_set_at_show?: boolean
        }
        Update: {
          id?: string; organization_id?: string; name?: string; lightspeed_name?: string | null; lightspeed_vendor_id?: string | null; po_code?: string | null; aliases?: string[]
          rep_group_id?: string | null; assigned_buyer_id?: string | null; payment_terms_id?: string | null
          website?: string | null; account_number?: string | null; catalog?: string | null; phone?: string | null; fax?: string | null
          address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null
          rep_name?: string | null; rep_phone?: string | null; pickup_address?: string | null; pickup_times?: string | null
          shipping_contact?: string | null; shipping_contact_phone?: string | null; email?: string | null; rep_email?: string | null; shipping_contact_email?: string | null; return_notes?: string | null; google_drive_folder?: string | null
          rating?: number | null; tier?: string | null; ordering_frequency?: Database['public']['Enums']['ordering_frequency'] | null
          is_delivery_vendor?: boolean; minimum_order?: string | null; freight_program?: string | null; free_shipping_policy?: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold?: number | null; freight_routing?: string | null; freight_allowance_on_time?: boolean; vid_in_description?: boolean; product_types?: string | null; notes?: string | null; needs_review?: boolean; review_note?: string | null; do_not_order?: boolean; do_not_order_reason?: string | null; standing?: 'ok' | 'hold' | 'last_resort' | 'do_not_order'; standing_tags?: string[]; standing_review_date?: string | null; merged_into_id?: string | null; wwd_zero_upcharge?: boolean; report_owner?: string | null; is_fishing?: boolean; web_orders?: boolean; order_methods?: string[]; freight_programs_vendor?: string | null; info_confirmed_at?: string | null; assigned_rep_contact_id?: string | null; assigned_rep_group_contact_id?: string | null
          is_active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string
          ask_before_pictures?: boolean; usual_charges?: UsualCharge[]; order_set_at_show?: boolean
        }
        Relationships: [
          { foreignKeyName: 'vendors_organization_id_fkey'; columns: ['organization_id']; isOneToOne: false; referencedRelation: 'organizations'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendors_rep_group_id_fkey'; columns: ['rep_group_id']; isOneToOne: false; referencedRelation: 'rep_groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendors_assigned_buyer_id_fkey'; columns: ['assigned_buyer_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendors_payment_terms_id_fkey'; columns: ['payment_terms_id']; isOneToOne: false; referencedRelation: 'payment_terms'; referencedColumns: ['id'] },
        ]
      }
      vendor_billing_routes: {
        Row: { organization_id: string | null; vendor_id: string; route: Database['public']['Enums']['billing_route']; is_default: boolean; pay_method: 'card' | 'ach' | null; account_number: string | null; notes: string | null; created_at: string }
        Insert: { organization_id?: string | null; vendor_id: string; route: Database['public']['Enums']['billing_route']; is_default?: boolean; pay_method?: 'card' | 'ach' | null; account_number?: string | null; notes?: string | null; created_at?: string }
        Update: { organization_id?: string | null; vendor_id?: string; route?: Database['public']['Enums']['billing_route']; is_default?: boolean; pay_method?: 'card' | 'ach' | null; account_number?: string | null; notes?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_billing_routes_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      vendor_emails: {
        Row: { id: string; organization_id: string | null; vendor_id: string; email: string | null; contact_name: string | null; title: string | null; phone: string | null; phones: { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }[]; contact_type: Database['public']['Enums']['contact_type']; source: Database['public']['Enums']['contact_source']; confidence: number | null; verified_at: string | null; is_primary: boolean; notes: string | null; created_at: string; updated_at: string; roles: Database['public']['Enums']['contact_type'][]; confirmed_at: string | null; bad_email_at: string | null }
        Insert: { id?: string; organization_id?: string | null; vendor_id: string; email?: string | null; contact_name?: string | null; title?: string | null; phone?: string | null; phones?: { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }[]; contact_type?: Database['public']['Enums']['contact_type']; source?: Database['public']['Enums']['contact_source']; confidence?: number | null; verified_at?: string | null; is_primary?: boolean; notes?: string | null; created_at?: string; updated_at?: string; roles?: Database['public']['Enums']['contact_type'][]; confirmed_at?: string | null; bad_email_at?: string | null }
        Update: { id?: string; organization_id?: string | null; vendor_id?: string; email?: string | null; contact_name?: string | null; title?: string | null; phone?: string | null; phones?: { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }[]; contact_type?: Database['public']['Enums']['contact_type']; source?: Database['public']['Enums']['contact_source']; confidence?: number | null; verified_at?: string | null; is_primary?: boolean; notes?: string | null; created_at?: string; updated_at?: string; roles?: Database['public']['Enums']['contact_type'][]; confirmed_at?: string | null; bad_email_at?: string | null }
        Relationships: [
          { foreignKeyName: 'vendor_emails_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      vendor_stores: {
        Row: { organization_id: string | null; vendor_id: string; store_id: string; created_at: string }
        Insert: { organization_id?: string | null; vendor_id: string; store_id: string; created_at?: string }
        Update: { organization_id?: string | null; vendor_id?: string; store_id?: string; created_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_stores_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_stores_store_id_fkey'; columns: ['store_id']; isOneToOne: false; referencedRelation: 'stores'; referencedColumns: ['id'] },
        ]
      }
      vendor_categories: {
        Row: { organization_id: string | null; vendor_id: string; category_id: string; created_at: string }
        Insert: { organization_id?: string | null; vendor_id: string; category_id: string; created_at?: string }
        Update: { organization_id?: string | null; vendor_id?: string; category_id?: string; created_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_categories_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_categories_category_id_fkey'; columns: ['category_id']; isOneToOne: false; referencedRelation: 'categories'; referencedColumns: ['id'] },
        ]
      }
      vendor_order_windows: {
        Row: { id: string; organization_id: string | null; vendor_id: string; kind: Database['public']['Enums']['order_window_kind']; label: string | null; months: number[]; buyer_id: string | null; notes: string | null; sort_order: number; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id?: string | null; vendor_id: string; kind?: Database['public']['Enums']['order_window_kind']; label?: string | null; months?: number[]; buyer_id?: string | null; notes?: string | null; sort_order?: number; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string | null; vendor_id?: string; kind?: Database['public']['Enums']['order_window_kind']; label?: string | null; months?: number[]; buyer_id?: string | null; notes?: string | null; sort_order?: number; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_order_windows_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      notes: {
        Row: { id: string; organization_id: string; entity_type: string; entity_id: string; body: string; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; entity_type: string; entity_id: string; body: string; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; entity_type?: string; entity_id?: string; body?: string; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'notes_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      activity_log: {
        Row: { id: string; organization_id: string; entity_type: string; entity_id: string | null; action: string; details: Json; actor_id: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; entity_type: string; entity_id?: string | null; action: string; details?: Json; actor_id?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; entity_type?: string; entity_id?: string | null; action?: string; details?: Json; actor_id?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'activity_log_actor_id_fkey'; columns: ['actor_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      review_items: {
        Row: { id: string; organization_id: string; kind: string; entity_type: string | null; entity_id: string | null; title: string; details: Json; status: Database['public']['Enums']['review_status']; created_by: string | null; created_at: string; resolved_by: string | null; resolved_at: string | null; resolution_note: string | null; assigned_to: string | null; assigned_at: string | null }
        Insert: { id?: string; organization_id: string; kind: string; entity_type?: string | null; entity_id?: string | null; title: string; details?: Json; status?: Database['public']['Enums']['review_status']; created_by?: string | null; created_at?: string; resolved_by?: string | null; resolved_at?: string | null; resolution_note?: string | null; assigned_to?: string | null; assigned_at?: string | null }
        Update: { id?: string; organization_id?: string; kind?: string; entity_type?: string | null; entity_id?: string | null; title?: string; details?: Json; status?: Database['public']['Enums']['review_status']; created_by?: string | null; created_at?: string; resolved_by?: string | null; resolved_at?: string | null; resolution_note?: string | null; assigned_to?: string | null; assigned_at?: string | null }
        Relationships: [
          { foreignKeyName: 'review_items_resolved_by_fkey'; columns: ['resolved_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'review_items_assigned_to_fkey'; columns: ['assigned_to']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      vendor_ratings: {
        Row: { id: string; organization_id: string; vendor_id: string; dimension: 'ease' | 'communication' | 'fulfilment' | 'accuracy' | 'shipping' | 'resolution'; score: number; note: string | null; rated_by: string | null; rated_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; dimension: 'ease' | 'communication' | 'fulfilment' | 'accuracy' | 'shipping' | 'resolution'; score: number; note?: string | null; rated_by?: string | null; rated_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; dimension?: 'ease' | 'communication' | 'fulfilment' | 'accuracy' | 'shipping' | 'resolution'; score?: number; note?: string | null; rated_by?: string | null; rated_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_ratings_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_ratings_rated_by_fkey'; columns: ['rated_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      vendor_item_rules: {
        Row: { id: string; organization_id: string; vendor_id: string; scope: 'type' | 'item'; vendor_item_id: string | null; name: string; rule: 'stop' | 'keep' | 'reorder_first' | 'watch'; reason: string | null; source: string | null; as_of: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; scope: 'type' | 'item'; vendor_item_id?: string | null; name: string; rule: 'stop' | 'keep' | 'reorder_first' | 'watch'; reason?: string | null; source?: string | null; as_of?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; scope?: 'type' | 'item'; vendor_item_id?: string | null; name?: string; rule?: 'stop' | 'keep' | 'reorder_first' | 'watch'; reason?: string | null; source?: string | null; as_of?: string | null; created_by?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_item_rules_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      review_assignment_rules: {
        Row: { id: string; organization_id: string; match_kind: 'vendor' | 'fishing' | 'department' | 'review_kind' | 'fallback'; match_value: string | null; vendor_id: string | null; assignee_id: string; priority: number; is_active: boolean; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; match_kind: 'vendor' | 'fishing' | 'department' | 'review_kind' | 'fallback'; match_value?: string | null; vendor_id?: string | null; assignee_id: string; priority?: number; is_active?: boolean; note?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; match_kind?: 'vendor' | 'fishing' | 'department' | 'review_kind' | 'fallback'; match_value?: string | null; vendor_id?: string | null; assignee_id?: string; priority?: number; is_active?: boolean; note?: string | null; created_by?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'review_assignment_rules_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'review_assignment_rules_assignee_id_fkey'; columns: ['assignee_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      mail_accounts: {
        Row: { organization_id: string; mailbox: string; internal_domains: string[]; history_id: string | null; backfill_after: string | null; backfill_page_token: string | null; backfill_done: boolean; follow_up_days: number; last_sync_at: string | null; sync_started_at: string | null; last_error: string | null; last_error_at: string | null; messages_synced: number; created_at: string; updated_at: string }
        Insert: { organization_id: string; mailbox: string; internal_domains?: string[]; history_id?: string | null; backfill_after?: string | null; backfill_page_token?: string | null; backfill_done?: boolean; follow_up_days?: number; last_sync_at?: string | null; sync_started_at?: string | null; last_error?: string | null; last_error_at?: string | null; messages_synced?: number; created_at?: string; updated_at?: string }
        Update: { organization_id?: string; mailbox?: string; internal_domains?: string[]; history_id?: string | null; backfill_after?: string | null; backfill_page_token?: string | null; backfill_done?: boolean; follow_up_days?: number; last_sync_at?: string | null; sync_started_at?: string | null; last_error?: string | null; last_error_at?: string | null; messages_synced?: number; created_at?: string; updated_at?: string }
        Relationships: [
        ]
      }
      email_senders: {
        Row: { id: string; organization_id: string; sender_key: string; is_domain: boolean; kind: 'unknown' | 'vendor' | 'rep_group' | 'platform' | 'carrier' | 'marketing' | 'not_vendor' | 'internal'; vendor_id: string | null; rep_group_id: string | null; carrier_id: string | null; display_name: string | null; domain_vendor_ids: string[]; message_count: number; last_seen_at: string | null; proposed_vendor_id: string | null; proposal_note: string | null; review_item_id: string | null; decided_by: string | null; decided_at: string | null; created_at: string; view_rule: 'attention' | 'offers' | null; ai_kind: 'vendor' | 'rep_group' | 'platform' | 'not_vendor' | 'unsure' | null; ai_vendor_id: string | null; ai_note: string | null; ai_read_at: string | null; no_reply_answers: number; auto_no_reply: boolean; company_name: string | null; company_website: string | null; company_phone: string | null; sorted_at: string | null; sort_note: string | null; nb_checked_at: string | null; nb_checked_by: string | null; rep_lines_read_at: string | null; rep_lines_read_count: number | null }
        Insert: { id?: string; organization_id: string; sender_key: string; is_domain?: boolean; kind?: 'unknown' | 'vendor' | 'rep_group' | 'platform' | 'carrier' | 'marketing' | 'not_vendor' | 'internal'; vendor_id?: string | null; rep_group_id?: string | null; carrier_id?: string | null; display_name?: string | null; domain_vendor_ids?: string[]; message_count?: number; last_seen_at?: string | null; proposed_vendor_id?: string | null; proposal_note?: string | null; review_item_id?: string | null; decided_by?: string | null; decided_at?: string | null; created_at?: string; view_rule?: 'attention' | 'offers' | null; ai_kind?: 'vendor' | 'rep_group' | 'platform' | 'not_vendor' | 'unsure' | null; ai_vendor_id?: string | null; ai_note?: string | null; ai_read_at?: string | null; no_reply_answers?: number; auto_no_reply?: boolean; company_name?: string | null; company_website?: string | null; company_phone?: string | null; sorted_at?: string | null; sort_note?: string | null; nb_checked_at?: string | null; nb_checked_by?: string | null; rep_lines_read_at?: string | null; rep_lines_read_count?: number | null }
        Update: { id?: string; organization_id?: string; sender_key?: string; is_domain?: boolean; kind?: 'unknown' | 'vendor' | 'rep_group' | 'platform' | 'carrier' | 'marketing' | 'not_vendor' | 'internal'; vendor_id?: string | null; rep_group_id?: string | null; carrier_id?: string | null; display_name?: string | null; domain_vendor_ids?: string[]; message_count?: number; last_seen_at?: string | null; proposed_vendor_id?: string | null; proposal_note?: string | null; review_item_id?: string | null; decided_by?: string | null; decided_at?: string | null; created_at?: string; view_rule?: 'attention' | 'offers' | null; ai_kind?: 'vendor' | 'rep_group' | 'platform' | 'not_vendor' | 'unsure' | null; ai_vendor_id?: string | null; ai_note?: string | null; ai_read_at?: string | null; no_reply_answers?: number; auto_no_reply?: boolean; company_name?: string | null; company_website?: string | null; company_phone?: string | null; sorted_at?: string | null; sort_note?: string | null; nb_checked_at?: string | null; nb_checked_by?: string | null; rep_lines_read_at?: string | null; rep_lines_read_count?: number | null }
        Relationships: [
          { foreignKeyName: 'email_senders_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'email_senders_rep_group_id_fkey'; columns: ['rep_group_id']; isOneToOne: false; referencedRelation: 'rep_groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'email_senders_proposed_vendor_id_fkey'; columns: ['proposed_vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      sender_filings: {
        Row: { id: string; organization_id: string; sender_id: string; vendor_id: string; how: 'claude' | 'this_is'; note: string | null; thread_ids: string[]; created_by: string | null; created_at: string; undone_at: string | null; undone_by: string | null }
        Insert: { id?: string; organization_id: string; sender_id: string; vendor_id: string; how: 'claude' | 'this_is'; note?: string | null; thread_ids?: string[]; created_by?: string | null; created_at?: string; undone_at?: string | null; undone_by?: string | null }
        Update: { id?: string; organization_id?: string; sender_id?: string; vendor_id?: string; how?: 'claude' | 'this_is'; note?: string | null; thread_ids?: string[]; created_by?: string | null; created_at?: string; undone_at?: string | null; undone_by?: string | null }
        Relationships: [
          { foreignKeyName: 'sender_filings_sender_id_fkey'; columns: ['sender_id']; isOneToOne: false; referencedRelation: 'email_senders'; referencedColumns: ['id'] },
          { foreignKeyName: 'sender_filings_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      supply_requests: {
        Row: { id: string; organization_id: string; summary: string; items: Json; store_code: string | null; requested_by_name: string | null; requested_by_email: string | null; requested_at: string; email_id: string | null; thread_id: string | null; task_id: string | null; status: 'requested' | 'ordered' | 'arrived' | 'closed'; is_old: boolean; ordered_from: string | null; order_number: string | null; ordered_at: string | null; order_total: number | null; expected_at: string | null; tracking: string | null; arrived_at: string | null; confirm_email_id: string | null; confirm_private: boolean; notify_pending: boolean; notified_at: string | null; notify_text: string | null; notify_error: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; summary: string; items?: Json; store_code?: string | null; requested_by_name?: string | null; requested_by_email?: string | null; requested_at?: string; email_id?: string | null; thread_id?: string | null; task_id?: string | null; status?: 'requested' | 'ordered' | 'arrived' | 'closed'; is_old?: boolean; ordered_from?: string | null; order_number?: string | null; ordered_at?: string | null; order_total?: number | null; expected_at?: string | null; tracking?: string | null; arrived_at?: string | null; confirm_email_id?: string | null; confirm_private?: boolean; notify_pending?: boolean; notified_at?: string | null; notify_text?: string | null; notify_error?: string | null; notes?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; summary?: string; items?: Json; store_code?: string | null; requested_by_name?: string | null; requested_by_email?: string | null; requested_at?: string; email_id?: string | null; thread_id?: string | null; task_id?: string | null; status?: 'requested' | 'ordered' | 'arrived' | 'closed'; is_old?: boolean; ordered_from?: string | null; order_number?: string | null; ordered_at?: string | null; order_total?: number | null; expected_at?: string | null; tracking?: string | null; arrived_at?: string | null; confirm_email_id?: string | null; confirm_private?: boolean; notify_pending?: boolean; notified_at?: string | null; notify_text?: string | null; notify_error?: string | null; notes?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      contact_learning: {
        Row: { id: string; organization_id: string; email: string; vendor_id: string | null; rep_group_id: string | null; result: 'added' | 'updated' | 'same' | 'skipped' | 'failed'; note: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; email: string; vendor_id?: string | null; rep_group_id?: string | null; result: 'added' | 'updated' | 'same' | 'skipped' | 'failed'; note?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; email?: string; vendor_id?: string | null; rep_group_id?: string | null; result?: 'added' | 'updated' | 'same' | 'skipped' | 'failed'; note?: string | null; created_at?: string }
        Relationships: []
      }
      freight_quotes: {
        Row: { id: string; organization_id: string; vendor_id: string | null; order_id: string | null; email_id: string; thread_id: string | null; status: 'needs_order' | 'waiting' | 'approved' | 'declined'; match_how: 'po' | 'vendor_number' | 'conversation' | 'claude' | 'ship_from' | 'picked' | null; vendor_carrier: string | null; vendor_service: string | null; vendor_cost: number | null; transit: string | null; details: Json; priority_one_cost: number | null; wwex_cost: number | null; our_note: string | null; approved_choice: 'vendor' | 'priority_one' | 'wwex' | 'other' | null; approved_cost: number | null; approved_by: string | null; approved_at: string | null; task_id: string | null; ships_by: 'pallet' | 'parcel' | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; vendor_id?: string | null; order_id?: string | null; email_id: string; thread_id?: string | null; status?: 'needs_order' | 'waiting' | 'approved' | 'declined'; match_how?: 'po' | 'vendor_number' | 'conversation' | 'claude' | 'ship_from' | 'picked' | null; vendor_carrier?: string | null; vendor_service?: string | null; vendor_cost?: number | null; transit?: string | null; details?: Json; priority_one_cost?: number | null; wwex_cost?: number | null; our_note?: string | null; approved_choice?: 'vendor' | 'priority_one' | 'wwex' | 'other' | null; approved_cost?: number | null; approved_by?: string | null; approved_at?: string | null; task_id?: string | null; ships_by?: 'pallet' | 'parcel' | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string | null; order_id?: string | null; email_id?: string; thread_id?: string | null; status?: 'needs_order' | 'waiting' | 'approved' | 'declined'; match_how?: 'po' | 'vendor_number' | 'conversation' | 'claude' | 'ship_from' | 'picked' | null; vendor_carrier?: string | null; vendor_service?: string | null; vendor_cost?: number | null; transit?: string | null; details?: Json; priority_one_cost?: number | null; wwex_cost?: number | null; our_note?: string | null; approved_choice?: 'vendor' | 'priority_one' | 'wwex' | 'other' | null; approved_cost?: number | null; approved_by?: string | null; approved_at?: string | null; task_id?: string | null; ships_by?: 'pallet' | 'parcel' | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      routing_letters: {
        Row: { id: string; organization_id: string; version: number; storage_path: string; file_name: string; effective_on: string | null; note: string | null; email_subject: string; email_body: string; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; version: number; storage_path: string; file_name: string; effective_on?: string | null; note?: string | null; email_subject?: string; email_body: string; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; version?: number; storage_path?: string; file_name?: string; effective_on?: string | null; note?: string | null; email_subject?: string; email_body?: string; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      routing_letter_sends: {
        Row: { id: string; organization_id: string; letter_id: string; vendor_id: string; contact_name: string | null; email: string; token: string; draft_id: string | null; sent_at: string | null; sent_email_id: string | null; sent_by: string | null; received_at: string | null; reminded_at: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; letter_id: string; vendor_id: string; contact_name?: string | null; email: string; token?: string; draft_id?: string | null; sent_at?: string | null; sent_email_id?: string | null; sent_by?: string | null; received_at?: string | null; reminded_at?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; letter_id?: string; vendor_id?: string; contact_name?: string | null; email?: string; token?: string; draft_id?: string | null; sent_at?: string | null; sent_email_id?: string | null; sent_by?: string | null; received_at?: string | null; reminded_at?: string | null; created_at?: string }
        Relationships: []
      }
      vendor_confirmations: {
        Row: { id: string; organization_id: string; vendor_id: string; vendor_email_id: string | null; email: string; contact_name: string | null; token: string; draft_id: string | null; sent_at: string | null; sent_email_id: string | null; sent_by: string | null; opened_at: string | null; confirmed_at: string | null; changed: boolean | null; reminded_at: string | null; bounced_at: string | null; routing_answer: 'yes' | 'no' | null; routing_answered_at: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; vendor_email_id?: string | null; email: string; contact_name?: string | null; token?: string; draft_id?: string | null; sent_at?: string | null; sent_email_id?: string | null; sent_by?: string | null; opened_at?: string | null; confirmed_at?: string | null; changed?: boolean | null; reminded_at?: string | null; bounced_at?: string | null; routing_answer?: 'yes' | 'no' | null; routing_answered_at?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; vendor_email_id?: string | null; email?: string; contact_name?: string | null; token?: string; draft_id?: string | null; sent_at?: string | null; sent_email_id?: string | null; sent_by?: string | null; opened_at?: string | null; confirmed_at?: string | null; changed?: boolean | null; reminded_at?: string | null; bounced_at?: string | null; routing_answer?: 'yes' | 'no' | null; routing_answered_at?: string | null; created_at?: string }
        Relationships: []
      }
      vendor_sells: {
        Row: { id: string; organization_id: string; vendor_id: string; category: string; source: 'wwd' | 'vendor_form' | 'manual'; confirmed_at: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; category: string; source?: 'wwd' | 'vendor_form' | 'manual'; confirmed_at?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; category?: string; source?: 'wwd' | 'vendor_form' | 'manual'; confirmed_at?: string | null; created_at?: string }
        Relationships: []
      }
      amazon_orders: {
        Row: { id: string; organization_id: string; order_number: string; ordered_at: string | null; po: string | null; initials: string | null; store_code: 'SLS' | 'SLH' | 'SLM' | 'GS' | null; person_name: string | null; total: number | null; items: string | null; status: 'ordered' | 'shipped' | 'delivered' | 'cancelled'; expected_at: string | null; delivered_at: string | null; email_id: string | null; is_private: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; order_number: string; ordered_at?: string | null; po?: string | null; initials?: string | null; store_code?: 'SLS' | 'SLH' | 'SLM' | 'GS' | null; person_name?: string | null; total?: number | null; items?: string | null; status?: 'ordered' | 'shipped' | 'delivered' | 'cancelled'; expected_at?: string | null; delivered_at?: string | null; email_id?: string | null; is_private?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; order_number?: string; ordered_at?: string | null; po?: string | null; initials?: string | null; store_code?: 'SLS' | 'SLH' | 'SLM' | 'GS' | null; person_name?: string | null; total?: number | null; items?: string | null; status?: 'ordered' | 'shipped' | 'delivered' | 'cancelled'; expected_at?: string | null; delivered_at?: string | null; email_id?: string | null; is_private?: boolean; created_at?: string; updated_at?: string }
        Relationships: []
      }
      po_initials: {
        Row: { organization_id: string; initials: string; person_name: string; profile_id: string | null; goes_to_supplies: boolean }
        Insert: { organization_id: string; initials: string; person_name: string; profile_id?: string | null; goes_to_supplies?: boolean }
        Update: { organization_id?: string; initials?: string; person_name?: string; profile_id?: string | null; goes_to_supplies?: boolean }
        Relationships: []
      }
      email_drafts: {
        Row: { id: string; organization_id: string; owner_id: string; created_by: string | null; to_emails: string[]; cc_emails: string[]; subject: string; body: string; thread_id: string | null; reply_to_email_id: string | null; forward_email_id: string | null; vendor_id: string | null; mailbox_id: string | null; note: string | null; gmail_copy: boolean; gmail_draft_id: string | null; signature: string | null; routing_send_id: string | null; confirmation_id: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; owner_id: string; created_by?: string | null; to_emails?: string[]; cc_emails?: string[]; subject?: string; body?: string; thread_id?: string | null; reply_to_email_id?: string | null; forward_email_id?: string | null; vendor_id?: string | null; mailbox_id?: string | null; note?: string | null; gmail_copy?: boolean; gmail_draft_id?: string | null; signature?: string | null; routing_send_id?: string | null; confirmation_id?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; owner_id?: string; created_by?: string | null; to_emails?: string[]; cc_emails?: string[]; subject?: string; body?: string; thread_id?: string | null; reply_to_email_id?: string | null; forward_email_id?: string | null; vendor_id?: string | null; mailbox_id?: string | null; note?: string | null; gmail_copy?: boolean; gmail_draft_id?: string | null; signature?: string | null; routing_send_id?: string | null; confirmation_id?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'email_drafts_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'email_drafts_owner_id_fkey'; columns: ['owner_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      mail_address_rules: {
        Row: { id: string; organization_id: string; mailbox_id: string | null; address: string; mail_kind: 'bulk' | 'offer' | 'regular'; view: 'attention' | 'offers'; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; mailbox_id?: string | null; address: string; mail_kind: 'bulk' | 'offer' | 'regular'; view: 'attention' | 'offers'; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; mailbox_id?: string | null; address?: string; mail_kind?: 'bulk' | 'offer' | 'regular'; view?: 'attention' | 'offers'; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      mailboxes: {
        Row: { id: string; organization_id: string; kind: 'personal' | 'legacy'; address: string; label: string; owner_id: string; gmail_box: string; is_active: boolean; history_id: string | null; backfill_after: string | null; backfill_page_token: string | null; backfill_done: boolean; last_sync_at: string | null; sync_started_at: string | null; last_error: string | null; last_error_at: string | null; messages_synced: number; auto_share_vendor_mail: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; kind: 'personal' | 'legacy'; address: string; label: string; owner_id: string; gmail_box: string; is_active?: boolean; history_id?: string | null; backfill_after?: string | null; backfill_page_token?: string | null; backfill_done?: boolean; last_sync_at?: string | null; sync_started_at?: string | null; last_error?: string | null; last_error_at?: string | null; messages_synced?: number; auto_share_vendor_mail?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; kind?: 'personal' | 'legacy'; address?: string; label?: string; owner_id?: string; gmail_box?: string; is_active?: boolean; history_id?: string | null; backfill_after?: string | null; backfill_page_token?: string | null; backfill_done?: boolean; last_sync_at?: string | null; sync_started_at?: string | null; last_error?: string | null; last_error_at?: string | null; messages_synced?: number; auto_share_vendor_mail?: boolean; created_at?: string; updated_at?: string }
        Relationships: []
      }
      email_threads: {
        Row: { id: string; organization_id: string; gmail_thread_id: string; vendor_id: string | null; carrier_id: string | null; tagged_vendor_ids: string[]; owner_id: string | null; owner_set_at: string | null; art_status: 'waiting' | 'needs_changes' | 'changes_sent' | 'approved' | null; art_since: string | null; art_email_id: string | null; art_note: string | null; status: 'waiting_on_us' | 'waiting_on_vendor' | 'handled'; subject: string | null; message_count: number; last_in_at: string | null; last_out_at: string | null; last_message_at: string | null; follow_up_at: string | null; status_msg_at: string | null; created_at: string; updated_at: string; view: 'attention' | 'offers'; ship_status: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | null; ship_status_at: string | null; working_by: string | null; working_since: string | null; working_mark_at: string | null; working_done_at: string | null; deleted_at: string | null; deleted_by: string | null; mailbox_id: string | null; shared_at: string | null; shared_by: string | null; auto_share_off: boolean }
        Insert: { id?: string; organization_id: string; gmail_thread_id: string; vendor_id?: string | null; carrier_id?: string | null; tagged_vendor_ids?: string[]; owner_id?: string | null; owner_set_at?: string | null; art_status?: 'waiting' | 'needs_changes' | 'changes_sent' | 'approved' | null; art_since?: string | null; art_email_id?: string | null; art_note?: string | null; status?: 'waiting_on_us' | 'waiting_on_vendor' | 'handled'; subject?: string | null; message_count?: number; last_in_at?: string | null; last_out_at?: string | null; last_message_at?: string | null; follow_up_at?: string | null; status_msg_at?: string | null; created_at?: string; updated_at?: string; view?: 'attention' | 'offers'; ship_status?: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | null; ship_status_at?: string | null; working_by?: string | null; working_since?: string | null; working_mark_at?: string | null; working_done_at?: string | null; deleted_at?: string | null; deleted_by?: string | null; mailbox_id?: string | null; shared_at?: string | null; shared_by?: string | null; auto_share_off?: boolean }
        Update: { id?: string; organization_id?: string; gmail_thread_id?: string; vendor_id?: string | null; carrier_id?: string | null; tagged_vendor_ids?: string[]; owner_id?: string | null; owner_set_at?: string | null; art_status?: 'waiting' | 'needs_changes' | 'changes_sent' | 'approved' | null; art_since?: string | null; art_email_id?: string | null; art_note?: string | null; status?: 'waiting_on_us' | 'waiting_on_vendor' | 'handled'; subject?: string | null; message_count?: number; last_in_at?: string | null; last_out_at?: string | null; last_message_at?: string | null; follow_up_at?: string | null; status_msg_at?: string | null; created_at?: string; updated_at?: string; view?: 'attention' | 'offers'; ship_status?: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | null; ship_status_at?: string | null; working_by?: string | null; working_since?: string | null; working_mark_at?: string | null; working_done_at?: string | null; deleted_at?: string | null; deleted_by?: string | null; mailbox_id?: string | null; shared_at?: string | null; shared_by?: string | null; auto_share_off?: boolean }
        Relationships: [
          { foreignKeyName: 'email_threads_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'email_threads_owner_id_fkey'; columns: ['owner_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      emails: {
        Row: { id: string; organization_id: string; gmail_id: string; thread_id: string; message_id_header: string | null; in_reply_to: string | null; direction: 'in' | 'out' | 'internal'; from_email: string | null; from_name: string | null; to_emails: string[]; cc_emails: string[]; subject: string | null; snippet: string | null; body_text: string | null; received_at: string; labels: string[]; has_attachments: boolean; sender_id: string | null; vendor_id: string | null; freight_pct: number | null; vendors_read_at: string | null; disposition: 'marketing' | 'other' | null; order_id: string | null; mentioned_vendor_ids: string[]; match_how: 'thread' | 'sender' | 'domain' | 'directory' | 'rep_group' | 'platform' | 'manual' | 'receipt' | 'shipper' | null; sent_by: string | null; created_at: string; view: 'attention' | 'offers'; view_how: 'gmail' | 'signals' | 'rule' | 'read' | 'manual' | null; is_bulk: boolean | null; files_scanned_at: string | null; ai_view: 'attention' | 'offers' | null; ai_read_at: string | null; reply_needed: 'yes' | 'no' | 'unsure' | null; reply_note: string | null; reply_read_at: string | null; ship_status: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | null; paid_read_at: string | null; mailbox_id: string | null; gmail_box: string | null; copy_of: string | null; promise_read_at: string | null; promise: Json | null; supply_read_at: string | null; supply_conf_read_at: string | null; amazon_read_at: string | null; amazon_order_id: string | null }
        Insert: { id?: string; organization_id: string; gmail_id: string; thread_id: string; message_id_header?: string | null; in_reply_to?: string | null; direction: 'in' | 'out' | 'internal'; from_email?: string | null; from_name?: string | null; to_emails?: string[]; cc_emails?: string[]; subject?: string | null; snippet?: string | null; body_text?: string | null; received_at: string; labels?: string[]; has_attachments?: boolean; sender_id?: string | null; vendor_id?: string | null; freight_pct?: number | null; vendors_read_at?: string | null; disposition?: 'marketing' | 'other' | null; order_id?: string | null; mentioned_vendor_ids?: string[]; match_how?: 'thread' | 'sender' | 'domain' | 'directory' | 'rep_group' | 'platform' | 'manual' | 'receipt' | 'shipper' | null; sent_by?: string | null; created_at?: string; view?: 'attention' | 'offers'; view_how?: 'gmail' | 'signals' | 'rule' | 'read' | 'manual' | null; is_bulk?: boolean | null; files_scanned_at?: string | null; ai_view?: 'attention' | 'offers' | null; ai_read_at?: string | null; reply_needed?: 'yes' | 'no' | 'unsure' | null; reply_note?: string | null; reply_read_at?: string | null; ship_status?: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | null; paid_read_at?: string | null; mailbox_id?: string | null; gmail_box?: string | null; copy_of?: string | null; promise_read_at?: string | null; promise?: Json | null; supply_read_at?: string | null; supply_conf_read_at?: string | null; amazon_read_at?: string | null; amazon_order_id?: string | null }
        Update: { id?: string; organization_id?: string; gmail_id?: string; thread_id?: string; message_id_header?: string | null; in_reply_to?: string | null; direction?: 'in' | 'out' | 'internal'; from_email?: string | null; from_name?: string | null; to_emails?: string[]; cc_emails?: string[]; subject?: string | null; snippet?: string | null; body_text?: string | null; received_at?: string; labels?: string[]; has_attachments?: boolean; sender_id?: string | null; vendor_id?: string | null; freight_pct?: number | null; vendors_read_at?: string | null; disposition?: 'marketing' | 'other' | null; order_id?: string | null; mentioned_vendor_ids?: string[]; match_how?: 'thread' | 'sender' | 'domain' | 'directory' | 'rep_group' | 'platform' | 'manual' | 'receipt' | 'shipper' | null; sent_by?: string | null; created_at?: string; view?: 'attention' | 'offers'; view_how?: 'gmail' | 'signals' | 'rule' | 'read' | 'manual' | null; is_bulk?: boolean | null; files_scanned_at?: string | null; ai_view?: 'attention' | 'offers' | null; ai_read_at?: string | null; reply_needed?: 'yes' | 'no' | 'unsure' | null; reply_note?: string | null; reply_read_at?: string | null; ship_status?: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | null; paid_read_at?: string | null; mailbox_id?: string | null; gmail_box?: string | null; copy_of?: string | null; promise_read_at?: string | null; promise?: Json | null; supply_read_at?: string | null; supply_conf_read_at?: string | null; amazon_read_at?: string | null; amazon_order_id?: string | null }
        Relationships: [
          { foreignKeyName: 'emails_thread_id_fkey'; columns: ['thread_id']; isOneToOne: false; referencedRelation: 'email_threads'; referencedColumns: ['id'] },
          { foreignKeyName: 'emails_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'emails_sender_id_fkey'; columns: ['sender_id']; isOneToOne: false; referencedRelation: 'email_senders'; referencedColumns: ['id'] },
          { foreignKeyName: 'emails_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
          { foreignKeyName: 'emails_sent_by_fkey'; columns: ['sent_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      email_attachments: {
        Row: { id: string; organization_id: string; email_id: string; gmail_attachment_id: string | null; part_id: string | null; file_name: string; mime_type: string | null; size: number | null; storage_path: string | null; vendor_link_id: string | null; created_at: string; picture_kind: PictureKind | null; picture_company: string | null }
        Insert: { id?: string; organization_id: string; email_id: string; gmail_attachment_id?: string | null; part_id?: string | null; file_name: string; mime_type?: string | null; size?: number | null; storage_path?: string | null; vendor_link_id?: string | null; created_at?: string; picture_kind?: PictureKind | null; picture_company?: string | null }
        Update: { id?: string; organization_id?: string; email_id?: string; gmail_attachment_id?: string | null; part_id?: string | null; file_name?: string; mime_type?: string | null; size?: number | null; storage_path?: string | null; vendor_link_id?: string | null; created_at?: string; picture_kind?: PictureKind | null; picture_company?: string | null }
        Relationships: [
          { foreignKeyName: 'email_attachments_email_id_fkey'; columns: ['email_id']; isOneToOne: false; referencedRelation: 'emails'; referencedColumns: ['id'] },
          { foreignKeyName: 'email_attachments_vendor_link_id_fkey'; columns: ['vendor_link_id']; isOneToOne: false; referencedRelation: 'vendor_links'; referencedColumns: ['id'] },
        ]
      }
      needs: {
        Row: { id: string; organization_id: string; title: string; requester: string | null; store_code: string | null; status: 'needed' | 'ordered' | 'received'; email_id: string | null; order_id: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; title: string; requester?: string | null; store_code?: string | null; status?: 'needed' | 'ordered' | 'received'; email_id?: string | null; order_id?: string | null; notes?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; title?: string; requester?: string | null; store_code?: string | null; status?: 'needed' | 'ordered' | 'received'; email_id?: string | null; order_id?: string | null; notes?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'needs_email_id_fkey'; columns: ['email_id']; isOneToOne: false; referencedRelation: 'emails'; referencedColumns: ['id'] },
          { foreignKeyName: 'needs_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ]
      }
      ai_usage: {
        Row: { id: string; organization_id: string; purpose: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; items: number; created_at: string }
        Insert: { id?: string; organization_id: string; purpose: string; model: string; input_tokens?: number; output_tokens?: number; cost_usd?: number; items?: number; created_at?: string }
        Update: { id?: string; organization_id?: string; purpose?: string; model?: string; input_tokens?: number; output_tokens?: number; cost_usd?: number; items?: number; created_at?: string }
        Relationships: []
      }
      rep_group_contacts: {
        Row: { id: string; organization_id: string; rep_group_id: string; name: string | null; title: string | null; email: string | null; phone: string | null; phones: { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }[]; notes: string | null; created_at: string }
        Insert: { id?: string; organization_id?: string; rep_group_id: string; name?: string | null; title?: string | null; email?: string | null; phone?: string | null; phones?: { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }[]; notes?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; rep_group_id?: string; name?: string | null; title?: string | null; email?: string | null; phone?: string | null; phones?: { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }[]; notes?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'rep_group_contacts_rep_group_id_fkey'; columns: ['rep_group_id']; isOneToOne: false; referencedRelation: 'rep_groups'; referencedColumns: ['id'] },
        ]
      }
      carriers: {
        Row: { id: string; organization_id: string; name: string; mode: 'parcel' | 'ltl'; email_domains: string[]; website: string | null; account_number: string | null; owner_id: string | null; notes: string | null; is_active: boolean; created_at: string; ups_account: string | null; is_default_parcel: boolean; role: 'billing' | 'trucking' | 'other'; hired_by: string | null; partner_id: string | null; partner_department: string | null; aliases: string[] }
        Insert: { id?: string; organization_id: string; name: string; mode?: 'parcel' | 'ltl'; email_domains?: string[]; website?: string | null; account_number?: string | null; owner_id?: string | null; notes?: string | null; is_active?: boolean; created_at?: string; ups_account?: string | null; is_default_parcel?: boolean; role?: 'billing' | 'trucking' | 'other'; hired_by?: string | null; partner_id?: string | null; partner_department?: string | null; aliases?: string[] }
        Update: { id?: string; organization_id?: string; name?: string; mode?: 'parcel' | 'ltl'; email_domains?: string[]; website?: string | null; account_number?: string | null; owner_id?: string | null; notes?: string | null; is_active?: boolean; created_at?: string; ups_account?: string | null; is_default_parcel?: boolean; role?: 'billing' | 'trucking' | 'other'; hired_by?: string | null; partner_id?: string | null; partner_department?: string | null; aliases?: string[] }
        Relationships: []
      }
      freight_bills: {
        Row: { id: string; organization_id: string; carrier_id: string | null; email_id: string | null; invoice_number: string | null; invoice_date: string | null; due_date: string | null; total: number | null; fee_amount: number; storage_path: string | null; file_name: string | null; status: 'needs_pdf' | 'reading' | 'to_match' | 'done' | 'failed'; read_note: string | null; read_at: string | null; paid_date: string | null; paid_via: 'card' | 'check' | 'ach' | 'billcom' | 'other' | null; paid_ref: string | null; paid_by: string | null; created_at: string; updated_at: string; paid_source: 'manual' | 'receipt' | 'email' | null; paid_email_id: string | null; receipt_path: string | null; receipt_file_name: string | null; source_attachment_id: string | null }
        Insert: { id?: string; organization_id: string; carrier_id?: string | null; email_id?: string | null; invoice_number?: string | null; invoice_date?: string | null; due_date?: string | null; total?: number | null; fee_amount?: number; storage_path?: string | null; file_name?: string | null; status?: 'needs_pdf' | 'reading' | 'to_match' | 'done' | 'failed'; read_note?: string | null; read_at?: string | null; paid_date?: string | null; paid_via?: 'card' | 'check' | 'ach' | 'billcom' | 'other' | null; paid_ref?: string | null; paid_by?: string | null; created_at?: string; updated_at?: string; paid_source?: 'manual' | 'receipt' | 'email' | null; paid_email_id?: string | null; receipt_path?: string | null; receipt_file_name?: string | null; source_attachment_id?: string | null }
        Update: { id?: string; organization_id?: string; carrier_id?: string | null; email_id?: string | null; invoice_number?: string | null; invoice_date?: string | null; due_date?: string | null; total?: number | null; fee_amount?: number; storage_path?: string | null; file_name?: string | null; status?: 'needs_pdf' | 'reading' | 'to_match' | 'done' | 'failed'; read_note?: string | null; read_at?: string | null; paid_date?: string | null; paid_via?: 'card' | 'check' | 'ach' | 'billcom' | 'other' | null; paid_ref?: string | null; paid_by?: string | null; created_at?: string; updated_at?: string; paid_source?: 'manual' | 'receipt' | 'email' | null; paid_email_id?: string | null; receipt_path?: string | null; receipt_file_name?: string | null; source_attachment_id?: string | null }
        Relationships: [
          { foreignKeyName: 'freight_bills_carrier_id_fkey'; columns: ['carrier_id']; isOneToOne: false; referencedRelation: 'carriers'; referencedColumns: ['id'] },
          { foreignKeyName: 'freight_bills_email_id_fkey'; columns: ['email_id']; isOneToOne: false; referencedRelation: 'emails'; referencedColumns: ['id'] },
        ]
      }
      order_checks: {
        Row: { id: string; organization_id: string; vendor_id: string | null; order_id: string | null; kind: 'confirmation' | 'invoice'; document_id: string; email_id: string | null; status: OrderCheckStatus; working_at: string | null; reading: Json | null; po_number: string | null; doc_number: string | null; doc_date: string | null; doc_total: number | null; against: string | null; against_ids: string[]; result: 'match' | 'issues' | null; summary: string | null; rows: Json; issues: Json; draft_to: string[]; draft_subject: string | null; draft_body: string | null; read_note: string | null; assigned_to: string | null; assigned_at: string | null; reviewed_by: string | null; reviewed_at: string | null; outcome: 'sent' | 'no_email' | 'web_order' | 'used_as_order' | null; sent_thread_id: string | null; created_at: string; updated_at: string; match_how: 'po' | 'vendor_number' | 'conversation' | 'total' | 'claude' | 'picked' | null; report_id: string | null; report_ticked: boolean | null; po_task_id: string | null; po_draft_id: string | null; suggested_order_id: string | null; new_items: Json }
        Insert: { id?: string; organization_id: string; vendor_id?: string | null; order_id?: string | null; kind: 'confirmation' | 'invoice'; document_id: string; email_id?: string | null; status?: OrderCheckStatus; working_at?: string | null; reading?: Json | null; po_number?: string | null; doc_number?: string | null; doc_date?: string | null; doc_total?: number | null; against?: string | null; against_ids?: string[]; result?: 'match' | 'issues' | null; summary?: string | null; rows?: Json; issues?: Json; draft_to?: string[]; draft_subject?: string | null; draft_body?: string | null; read_note?: string | null; assigned_to?: string | null; assigned_at?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; outcome?: 'sent' | 'no_email' | 'web_order' | 'used_as_order' | null; sent_thread_id?: string | null; created_at?: string; updated_at?: string; match_how?: 'po' | 'vendor_number' | 'conversation' | 'total' | 'claude' | 'picked' | null; report_id?: string | null; report_ticked?: boolean | null; po_task_id?: string | null; po_draft_id?: string | null; suggested_order_id?: string | null; new_items?: Json }
        Update: { id?: string; organization_id?: string; vendor_id?: string | null; order_id?: string | null; kind?: 'confirmation' | 'invoice'; document_id?: string; email_id?: string | null; status?: OrderCheckStatus; working_at?: string | null; reading?: Json | null; po_number?: string | null; doc_number?: string | null; doc_date?: string | null; doc_total?: number | null; against?: string | null; against_ids?: string[]; result?: 'match' | 'issues' | null; summary?: string | null; rows?: Json; issues?: Json; draft_to?: string[]; draft_subject?: string | null; draft_body?: string | null; read_note?: string | null; assigned_to?: string | null; assigned_at?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; outcome?: 'sent' | 'no_email' | 'web_order' | 'used_as_order' | null; sent_thread_id?: string | null; created_at?: string; updated_at?: string; match_how?: 'po' | 'vendor_number' | 'conversation' | 'total' | 'claude' | 'picked' | null; report_id?: string | null; report_ticked?: boolean | null; po_task_id?: string | null; po_draft_id?: string | null; suggested_order_id?: string | null; new_items?: Json }
        Relationships: [
          { foreignKeyName: 'order_checks_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
          { foreignKeyName: 'order_checks_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'order_checks_document_id_fkey'; columns: ['document_id']; isOneToOne: false; referencedRelation: 'vendor_links'; referencedColumns: ['id'] },
          { foreignKeyName: 'order_checks_email_id_fkey'; columns: ['email_id']; isOneToOne: false; referencedRelation: 'emails'; referencedColumns: ['id'] },
          { foreignKeyName: 'order_checks_assigned_to_fkey'; columns: ['assigned_to']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'order_checks_reviewed_by_fkey'; columns: ['reviewed_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      ordering_items: {
        Row: { id: string; organization_id: string; vendor_id: string; stage: 'check' | 'to_order' | 'done'; note: string | null; assigned_to: string | null; flagged_by: string | null; thread_id: string | null; report_id: string | null; outcome: 'ordered' | 'not_needed' | 'removed' | null; order_id: string | null; done_at: string | null; done_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; stage: 'check' | 'to_order' | 'done'; note?: string | null; assigned_to?: string | null; flagged_by?: string | null; thread_id?: string | null; report_id?: string | null; outcome?: 'ordered' | 'not_needed' | 'removed' | null; order_id?: string | null; done_at?: string | null; done_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; stage?: 'check' | 'to_order' | 'done'; note?: string | null; assigned_to?: string | null; flagged_by?: string | null; thread_id?: string | null; report_id?: string | null; outcome?: 'ordered' | 'not_needed' | 'removed' | null; order_id?: string | null; done_at?: string | null; done_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'ordering_items_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'ordering_items_assigned_to_fkey'; columns: ['assigned_to']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'ordering_items_flagged_by_fkey'; columns: ['flagged_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'ordering_items_done_by_fkey'; columns: ['done_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'ordering_items_thread_id_fkey'; columns: ['thread_id']; isOneToOne: false; referencedRelation: 'email_threads'; referencedColumns: ['id'] },
          { foreignKeyName: 'ordering_items_report_id_fkey'; columns: ['report_id']; isOneToOne: false; referencedRelation: 'sales_reports'; referencedColumns: ['id'] },
          { foreignKeyName: 'ordering_items_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ]
      }
      sales_reports: {
        Row: { id: string; organization_id: string; vendor_id: string; document_id: string | null; ls_vendor: string | null; run_date: string; days: number; items: Json; summary: Json; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; document_id?: string | null; ls_vendor?: string | null; run_date?: string; days?: number; items?: Json; summary?: Json; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; document_id?: string | null; ls_vendor?: string | null; run_date?: string; days?: number; items?: Json; summary?: Json; created_by?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'sales_reports_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'sales_reports_document_id_fkey'; columns: ['document_id']; isOneToOne: false; referencedRelation: 'vendor_links'; referencedColumns: ['id'] },
          { foreignKeyName: 'sales_reports_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      ls_pos: {
        Row: { id: string; organization_id: string; order_id: string; vendor_id: string | null; status: 'drafting' | 'to_approve' | 'to_review' | 'ready' | 'sent'; approver_id: string | null; reviewer_id: string | null; store_code: string | null; lines: Json; draft_note: string | null; draft_error: string | null; working_at: string | null; approved_by: string | null; approved_at: string | null; reviewed_by: string | null; reviewed_at: string | null; ls_po_number: string | null; sent_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; order_id: string; vendor_id?: string | null; status?: 'drafting' | 'to_approve' | 'to_review' | 'ready' | 'sent'; approver_id?: string | null; reviewer_id?: string | null; store_code?: string | null; lines?: Json; draft_note?: string | null; draft_error?: string | null; working_at?: string | null; approved_by?: string | null; approved_at?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; ls_po_number?: string | null; sent_at?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; order_id?: string; vendor_id?: string | null; status?: 'drafting' | 'to_approve' | 'to_review' | 'ready' | 'sent'; approver_id?: string | null; reviewer_id?: string | null; store_code?: string | null; lines?: Json; draft_note?: string | null; draft_error?: string | null; working_at?: string | null; approved_by?: string | null; approved_at?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; ls_po_number?: string | null; sent_at?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'ls_pos_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
          { foreignKeyName: 'ls_pos_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'ls_pos_approver_id_fkey'; columns: ['approver_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'ls_pos_reviewer_id_fkey'; columns: ['reviewer_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'ls_pos_approved_by_fkey'; columns: ['approved_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'ls_pos_reviewed_by_fkey'; columns: ['reviewed_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      tasks: {
        Row: { id: string; organization_id: string; title: string; notes: string | null; due_date: string | null; remind_at: string | null; assigned_to: string; created_by: string | null; vendor_id: string | null; carrier_id: string | null; order_id: string | null; thread_id: string | null; rep_group_id: string | null; tag_other: string | null; repeat_every: number | null; repeat_unit: 'day' | 'week' | 'month' | 'year' | null; repeat_days: number[]; repeat_until: string | null; repeat_of: string | null; reminded_at: string | null; reminder_seen_at: string | null; remind_error: string | null; done_at: string | null; done_by: string | null; done_note: string | null; done_notified_at: string | null; done_seen_at: string | null; auto_key: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; title: string; notes?: string | null; due_date?: string | null; remind_at?: string | null; assigned_to: string; created_by?: string | null; vendor_id?: string | null; carrier_id?: string | null; order_id?: string | null; thread_id?: string | null; rep_group_id?: string | null; tag_other?: string | null; repeat_every?: number | null; repeat_unit?: 'day' | 'week' | 'month' | 'year' | null; repeat_days?: number[]; repeat_until?: string | null; repeat_of?: string | null; reminded_at?: string | null; reminder_seen_at?: string | null; remind_error?: string | null; done_at?: string | null; done_by?: string | null; done_note?: string | null; done_notified_at?: string | null; done_seen_at?: string | null; auto_key?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; title?: string; notes?: string | null; due_date?: string | null; remind_at?: string | null; assigned_to?: string; created_by?: string | null; vendor_id?: string | null; carrier_id?: string | null; order_id?: string | null; thread_id?: string | null; rep_group_id?: string | null; tag_other?: string | null; repeat_every?: number | null; repeat_unit?: 'day' | 'week' | 'month' | 'year' | null; repeat_days?: number[]; repeat_until?: string | null; repeat_of?: string | null; reminded_at?: string | null; reminder_seen_at?: string | null; remind_error?: string | null; done_at?: string | null; done_by?: string | null; done_note?: string | null; done_notified_at?: string | null; done_seen_at?: string | null; auto_key?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'tasks_assigned_to_fkey'; columns: ['assigned_to']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_done_by_fkey'; columns: ['done_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_carrier_id_fkey'; columns: ['carrier_id']; isOneToOne: false; referencedRelation: 'carriers'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_thread_id_fkey'; columns: ['thread_id']; isOneToOne: false; referencedRelation: 'email_threads'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_rep_group_id_fkey'; columns: ['rep_group_id']; isOneToOne: false; referencedRelation: 'rep_groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_repeat_of_fkey'; columns: ['repeat_of']; isOneToOne: false; referencedRelation: 'tasks'; referencedColumns: ['id'] },
        ]
      }
      snoozes: {
        Row: { id: string; organization_id: string; profile_id: string; thread_id: string | null; review_item_id: string | null; until: string; woke_by_reply: boolean; created_at: string }
        Insert: { id?: string; organization_id: string; profile_id: string; thread_id?: string | null; review_item_id?: string | null; until: string; woke_by_reply?: boolean; created_at?: string }
        Update: { id?: string; organization_id?: string; profile_id?: string; thread_id?: string | null; review_item_id?: string | null; until?: string; woke_by_reply?: boolean; created_at?: string }
        Relationships: [
          { foreignKeyName: 'snoozes_profile_id_fkey'; columns: ['profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'snoozes_thread_id_fkey'; columns: ['thread_id']; isOneToOne: false; referencedRelation: 'email_threads'; referencedColumns: ['id'] },
          { foreignKeyName: 'snoozes_review_item_id_fkey'; columns: ['review_item_id']; isOneToOne: false; referencedRelation: 'review_items'; referencedColumns: ['id'] },
        ]
      }
      wwd_payments: {
        Row: { id: string; organization_id: string; ref: string; pay_date: string; total: number | null; created_at: string }
        Insert: { id?: string; organization_id: string; ref: string; pay_date: string; total?: number | null; created_at?: string }
        Update: { id?: string; organization_id?: string; ref?: string; pay_date?: string; total?: number | null; created_at?: string }
        Relationships: []
      }
      wwd_invoices: {
        Row: { id: string; organization_id: string; seq: string; kind: 'invoice' | 'credit' | 'debit' | 'fee'; wwd_date: string | null; wwd_vendor_name: string | null; vendor_id: string | null; carrier_id: string | null; vendor_set_by: 'auto' | 'person' | null; po_number: string | null; vendor_invoice_number: string | null; vendor_invoice_date: string | null; amount: number | null; discount: number | null; due_date: string | null; terms: string | null; freight_amount: number | null; sheet_paid_date: string | null; paid_amount: number | null; paid_date: string | null; order_id: string | null; order_set_by: 'auto' | 'person' | null; sources: string[]; note: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; seq: string; kind: 'invoice' | 'credit' | 'debit' | 'fee'; wwd_date?: string | null; wwd_vendor_name?: string | null; vendor_id?: string | null; carrier_id?: string | null; vendor_set_by?: 'auto' | 'person' | null; po_number?: string | null; vendor_invoice_number?: string | null; vendor_invoice_date?: string | null; amount?: number | null; discount?: number | null; due_date?: string | null; terms?: string | null; freight_amount?: number | null; sheet_paid_date?: string | null; paid_amount?: number | null; paid_date?: string | null; order_id?: string | null; order_set_by?: 'auto' | 'person' | null; sources?: string[]; note?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; seq?: string; kind?: 'invoice' | 'credit' | 'debit' | 'fee'; wwd_date?: string | null; wwd_vendor_name?: string | null; vendor_id?: string | null; carrier_id?: string | null; vendor_set_by?: 'auto' | 'person' | null; po_number?: string | null; vendor_invoice_number?: string | null; vendor_invoice_date?: string | null; amount?: number | null; discount?: number | null; due_date?: string | null; terms?: string | null; freight_amount?: number | null; sheet_paid_date?: string | null; paid_amount?: number | null; paid_date?: string | null; order_id?: string | null; order_set_by?: 'auto' | 'person' | null; sources?: string[]; note?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'wwd_invoices_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'wwd_invoices_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
          { foreignKeyName: 'wwd_invoices_carrier_id_fkey'; columns: ['carrier_id']; isOneToOne: false; referencedRelation: 'carriers'; referencedColumns: ['id'] },
        ]
      }
      wwd_payment_lines: {
        Row: { id: string; payment_id: string; invoice_id: string; amount: number }
        Insert: { id?: string; payment_id: string; invoice_id: string; amount: number }
        Update: { id?: string; payment_id?: string; invoice_id?: string; amount?: number }
        Relationships: [
          { foreignKeyName: 'wwd_payment_lines_payment_id_fkey'; columns: ['payment_id']; isOneToOne: false; referencedRelation: 'wwd_payments'; referencedColumns: ['id'] },
          { foreignKeyName: 'wwd_payment_lines_invoice_id_fkey'; columns: ['invoice_id']; isOneToOne: false; referencedRelation: 'wwd_invoices'; referencedColumns: ['id'] },
        ]
      }
      vendor_payments: {
        Row: { id: string; organization_id: string; source: 'billcom' | 'manual'; confirmation: string | null; payee: string; vendor_id: string | null; carrier_id: string | null; process_date: string | null; arrival_date: string | null; status: string | null; method: string | null; amount: number | null; invoice_number: string | null; paid_from: string | null; freight_bill_id: string | null; order_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; source?: 'billcom' | 'manual'; confirmation?: string | null; payee: string; vendor_id?: string | null; carrier_id?: string | null; process_date?: string | null; arrival_date?: string | null; status?: string | null; method?: string | null; amount?: number | null; invoice_number?: string | null; paid_from?: string | null; freight_bill_id?: string | null; order_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; source?: 'billcom' | 'manual'; confirmation?: string | null; payee?: string; vendor_id?: string | null; carrier_id?: string | null; process_date?: string | null; arrival_date?: string | null; status?: string | null; method?: string | null; amount?: number | null; invoice_number?: string | null; paid_from?: string | null; freight_bill_id?: string | null; order_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      delivery_receipts: {
        Row: { id: string; organization_id: string; carrier_id: string | null; email_id: string; pro_number: string | null; shipper_name: string | null; po_numbers: string[]; delivered_on: string | null; signed_by: string | null; pieces: number | null; weight_lb: number | null; vendor_candidates: string[]; vendor_id: string | null; order_id: string | null; vendor_link_id: string | null; storage_path: string | null; file_name: string | null; status: 'reading' | 'filed' | 'needs_vendor' | 'failed'; read_note: string | null; review_item_id: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; carrier_id?: string | null; email_id: string; pro_number?: string | null; shipper_name?: string | null; po_numbers?: string[]; delivered_on?: string | null; signed_by?: string | null; pieces?: number | null; weight_lb?: number | null; vendor_candidates?: string[]; vendor_id?: string | null; order_id?: string | null; vendor_link_id?: string | null; storage_path?: string | null; file_name?: string | null; status?: 'reading' | 'filed' | 'needs_vendor' | 'failed'; read_note?: string | null; review_item_id?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; carrier_id?: string | null; email_id?: string; pro_number?: string | null; shipper_name?: string | null; po_numbers?: string[]; delivered_on?: string | null; signed_by?: string | null; pieces?: number | null; weight_lb?: number | null; vendor_candidates?: string[]; vendor_id?: string | null; order_id?: string | null; vendor_link_id?: string | null; storage_path?: string | null; file_name?: string | null; status?: 'reading' | 'filed' | 'needs_vendor' | 'failed'; read_note?: string | null; review_item_id?: string | null; created_at?: string }
        Relationships: []
      }
      freight_bill_lines: {
        Row: { id: string; organization_id: string; bill_id: string; shipper_name: string | null; ship_date: string | null; tracking: string[]; pieces: number | null; weight_lb: number | null; description: string | null; amount: number; fee_amount: number; vendor_id: string | null; order_id: string | null; suggested_vendor_id: string | null; confirmed: boolean; confirmed_by: string | null; confirmed_at: string | null; sort_order: number; created_at: string }
        Insert: { id?: string; organization_id: string; bill_id: string; shipper_name?: string | null; ship_date?: string | null; tracking?: string[]; pieces?: number | null; weight_lb?: number | null; description?: string | null; amount?: number; fee_amount?: number; vendor_id?: string | null; order_id?: string | null; suggested_vendor_id?: string | null; confirmed?: boolean; confirmed_by?: string | null; confirmed_at?: string | null; sort_order?: number; created_at?: string }
        Update: { id?: string; organization_id?: string; bill_id?: string; shipper_name?: string | null; ship_date?: string | null; tracking?: string[]; pieces?: number | null; weight_lb?: number | null; description?: string | null; amount?: number; fee_amount?: number; vendor_id?: string | null; order_id?: string | null; suggested_vendor_id?: string | null; confirmed?: boolean; confirmed_by?: string | null; confirmed_at?: string | null; sort_order?: number; created_at?: string }
        Relationships: [
          { foreignKeyName: 'freight_bill_lines_bill_id_fkey'; columns: ['bill_id']; isOneToOne: false; referencedRelation: 'freight_bills'; referencedColumns: ['id'] },
          { foreignKeyName: 'freight_bill_lines_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'freight_bill_lines_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ]
      }
      order_lines: {
        Row: { id: string; organization_id: string; order_id: string; sort_order: number; vendor_item_id: string | null; description: string | null; quantity: number; unit_cost: number; extended: number; retail_price: number | null; retail_edited: boolean; vid_in_description: boolean | null; notes: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id?: string; order_id: string; sort_order?: number; vendor_item_id?: string | null; description?: string | null; quantity?: number; unit_cost?: number; retail_price?: number | null; retail_edited?: boolean; vid_in_description?: boolean | null; notes?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; order_id?: string; sort_order?: number; vendor_item_id?: string | null; description?: string | null; quantity?: number; unit_cost?: number; retail_price?: number | null; retail_edited?: boolean; vid_in_description?: boolean | null; notes?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'order_lines_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ]
      }
      email_vendor_tags: {
        Row: { email_id: string; vendor_id: string; organization_id: string; how: 'auto' | 'ai' | 'manual'; created_by: string | null; created_at: string }
        Insert: { email_id: string; vendor_id: string; organization_id: string; how?: 'auto' | 'ai' | 'manual'; created_by?: string | null; created_at?: string }
        Update: { email_id?: string; vendor_id?: string; organization_id?: string; how?: 'auto' | 'ai' | 'manual'; created_by?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'email_vendor_tags_email_id_fkey'; columns: ['email_id']; isOneToOne: false; referencedRelation: 'emails'; referencedColumns: ['id'] },
          { foreignKeyName: 'email_vendor_tags_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      vendor_exclusions: {
        Row: { id: string; organization_id: string; name: string; name_key: string; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; name: string; note?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; name?: string; note?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      vendor_merges: {
        Row: { id: string; organization_id: string; kept_vendor_id: string; kept_name: string; kept_lightspeed_name: string | null; merged_name: string; merged_lightspeed_name: string | null; merged_vendor_id: string | null; source: 'import' | 'manual'; status: 'pending' | 'confirmed' | 'split'; route: Database['public']['Enums']['billing_route'] | null; merged_at: string; merged_by: string | null; ls_done_at: string | null; ls_done_by: string | null }
        Insert: { id?: string; organization_id: string; kept_vendor_id: string; kept_name: string; kept_lightspeed_name?: string | null; merged_name: string; merged_lightspeed_name?: string | null; merged_vendor_id?: string | null; source?: 'import' | 'manual'; status?: 'pending' | 'confirmed' | 'split'; route?: Database['public']['Enums']['billing_route'] | null; merged_at?: string; merged_by?: string | null; ls_done_at?: string | null; ls_done_by?: string | null }
        Update: { id?: string; organization_id?: string; kept_vendor_id?: string; kept_name?: string; kept_lightspeed_name?: string | null; merged_name?: string; merged_lightspeed_name?: string | null; merged_vendor_id?: string | null; source?: 'import' | 'manual'; status?: 'pending' | 'confirmed' | 'split'; route?: Database['public']['Enums']['billing_route'] | null; merged_at?: string; merged_by?: string | null; ls_done_at?: string | null; ls_done_by?: string | null }
        Relationships: [
          { foreignKeyName: 'vendor_merges_kept_vendor_id_fkey'; columns: ['kept_vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_merges_merged_vendor_id_fkey'; columns: ['merged_vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_merges_merged_by_fkey'; columns: ['merged_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_merges_ls_done_by_fkey'; columns: ['ls_done_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      vendor_directory: {
        Row: { id: string; organization_id: string; source: string; source_label: string | null; name: string; name_key: string; route: Database['public']['Enums']['billing_route']; email_domain: string | null; email: string | null; website: string | null; phone: string | null; rep_name: string | null; booth: string | null; data: Json; matched_vendor_id: string | null; created_at: string; rep_group_id: string | null; catalog_url: string | null; specials: string | null; specials_label: string | null; zero_upcharge: boolean; notes: string | null; updated_at: string }
        Insert: { id?: string; organization_id: string; source: string; source_label?: string | null; name: string; route?: Database['public']['Enums']['billing_route']; email_domain?: string | null; email?: string | null; website?: string | null; phone?: string | null; rep_name?: string | null; booth?: string | null; data?: Json; matched_vendor_id?: string | null; created_at?: string; rep_group_id?: string | null; catalog_url?: string | null; specials?: string | null; specials_label?: string | null; zero_upcharge?: boolean; notes?: string | null; updated_at?: string }
        Update: { id?: string; organization_id?: string; source?: string; source_label?: string | null; name?: string; route?: Database['public']['Enums']['billing_route']; email_domain?: string | null; email?: string | null; website?: string | null; phone?: string | null; rep_name?: string | null; booth?: string | null; data?: Json; matched_vendor_id?: string | null; created_at?: string; rep_group_id?: string | null; catalog_url?: string | null; specials?: string | null; specials_label?: string | null; zero_upcharge?: boolean; notes?: string | null; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_directory_matched_vendor_id_fkey'; columns: ['matched_vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_directory_rep_group_id_fkey'; columns: ['rep_group_id']; isOneToOne: false; referencedRelation: 'rep_groups'; referencedColumns: ['id'] },
        ]
      }
      show_appearances: {
        Row: { id: string; organization_id: string; show_code: string; show_label: string; show_date: string | null; line_id: string; vendor_id: string | null; booth: string | null; exhibitor: string | null; is_new: boolean; created_at: string }
        Insert: { id?: string; organization_id: string; show_code: string; show_label: string; show_date?: string | null; line_id: string; vendor_id?: string | null; booth?: string | null; exhibitor?: string | null; is_new?: boolean; created_at?: string }
        Update: { id?: string; organization_id?: string; show_code?: string; show_label?: string; show_date?: string | null; line_id?: string; vendor_id?: string | null; booth?: string | null; exhibitor?: string | null; is_new?: boolean; created_at?: string }
        Relationships: [
          { foreignKeyName: 'show_appearances_line_id_fkey'; columns: ['line_id']; isOneToOne: false; referencedRelation: 'vendor_directory'; referencedColumns: ['id'] },
          { foreignKeyName: 'show_appearances_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      ls_vendors: {
        Row: { organization_id: string; ls_vendor_id: string; name: string; archived: boolean; synced_at: string }
        Insert: { organization_id: string; ls_vendor_id: string; name: string; archived?: boolean; synced_at?: string }
        Update: { organization_id?: string; ls_vendor_id?: string; name?: string; archived?: boolean; synced_at?: string }
        Relationships: []
      }
      vendor_links: {
        Row: { id: string; organization_id: string; vendor_id: string | null; line_id: string | null; kind: Database['public']['Enums']['link_kind']; order_id: string | null; label: string; url: string | null; storage_path: string | null; file_name: string | null; file_size: number | null; mime_type: string | null; season_label: string | null; received_at: string | null; source: 'manual' | 'rep_list' | 'email' | 'vendor_form' | 'import'; notes: string | null; created_by: string | null; created_at: string; email_id: string | null; is_current: boolean; doc_year: number | null; doc_number: string | null; doc_date: string | null; doc_total: number | null; report_used_at: string | null; report_used_by: string | null; approved_at: string | null; approved_by: string | null }
        Insert: { id?: string; organization_id: string; vendor_id?: string | null; line_id?: string | null; kind: Database['public']['Enums']['link_kind']; order_id?: string | null; label: string; url?: string | null; storage_path?: string | null; file_name?: string | null; file_size?: number | null; mime_type?: string | null; season_label?: string | null; received_at?: string | null; source?: 'manual' | 'rep_list' | 'email' | 'vendor_form' | 'import'; notes?: string | null; created_by?: string | null; created_at?: string; email_id?: string | null; is_current?: boolean; doc_year?: number | null; doc_number?: string | null; doc_date?: string | null; doc_total?: number | null; report_used_at?: string | null; report_used_by?: string | null; approved_at?: string | null; approved_by?: string | null }
        Update: { id?: string; organization_id?: string; vendor_id?: string | null; line_id?: string | null; kind?: Database['public']['Enums']['link_kind']; order_id?: string | null; label?: string; url?: string | null; storage_path?: string | null; file_name?: string | null; file_size?: number | null; mime_type?: string | null; season_label?: string | null; received_at?: string | null; source?: 'manual' | 'rep_list' | 'email' | 'vendor_form' | 'import'; notes?: string | null; created_by?: string | null; created_at?: string; email_id?: string | null; is_current?: boolean; doc_year?: number | null; doc_number?: string | null; doc_date?: string | null; doc_total?: number | null; report_used_at?: string | null; report_used_by?: string | null; approved_at?: string | null; approved_by?: string | null }
        Relationships: [
          { foreignKeyName: 'vendor_links_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_links_line_id_fkey'; columns: ['line_id']; isOneToOne: false; referencedRelation: 'vendor_directory'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendor_links_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ]
      }
      partners: {
        Row: { id: string; organization_id: string; route: Database['public']['Enums']['billing_route']; name: string; member_number: string | null; main_phone: string | null; website: string | null; address: string | null; notes: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; route: Database['public']['Enums']['billing_route']; name: string; member_number?: string | null; main_phone?: string | null; website?: string | null; address?: string | null; notes?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; route?: Database['public']['Enums']['billing_route']; name?: string; member_number?: string | null; main_phone?: string | null; website?: string | null; address?: string | null; notes?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'partners_organization_id_fkey'; columns: ['organization_id']; isOneToOne: false; referencedRelation: 'organizations'; referencedColumns: ['id'] },
        ]
      }
      partner_contacts: {
        Row: { id: string; organization_id: string; partner_id: string; name: string; department: string | null; title: string | null; extension: string | null; phone: string | null; email: string | null; member_range: string | null; initial_range: string | null; show_on_vendor: boolean; sort_order: number; notes: string | null; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; partner_id: string; name: string; department?: string | null; title?: string | null; extension?: string | null; phone?: string | null; email?: string | null; member_range?: string | null; initial_range?: string | null; show_on_vendor?: boolean; sort_order?: number; notes?: string | null; is_active?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; partner_id?: string; name?: string; department?: string | null; title?: string | null; extension?: string | null; phone?: string | null; email?: string | null; member_range?: string | null; initial_range?: string | null; show_on_vendor?: boolean; sort_order?: number; notes?: string | null; is_active?: boolean; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'partner_contacts_partner_id_fkey'; columns: ['partner_id']; isOneToOne: false; referencedRelation: 'partners'; referencedColumns: ['id'] },
        ]
      }
      orders: {
        Row: { id: string; organization_id: string; vendor_id: string; status: Database['public']['Enums']['order_status']; order_date: string | null; season: Database['public']['Enums']['order_season'] | null; show_code: string | null; show_inferred: boolean; placed_by: string | null; placed_by_id: string | null; taken_by: string | null; freight_pct: number | null; freight_pct_note: string | null; vid_in_description: boolean | null; freight_allowance_offered: boolean; freight_allowance: number | null; freight_allowance_pay_by: string | null; freight_allowance_received: string | null; store_codes: string[]; billing_route: Database['public']['Enums']['billing_route'] | null; description: string | null; est_ship_date: string | null; est_cost: number | null; freight_cost: number | null; freight_notes: string | null; free_shipping: boolean | null; free_shipping_basis: 'show_special' | 'minimum_met' | 'negotiated' | 'always' | 'other' | null; free_shipping_note: string | null; date_received: string | null; po_number: string | null; ls_po_number: string | null; ar_due: string | null; ar_due_date: string | null; date_entered_ls: string | null; entered_by: string | null; backorder: boolean; shipment_notes: string | null; credits_due: boolean; credit_notes: string | null; date_credits_received: string | null; ok_to_pay: boolean; notes: string | null; final_cost: number | null; paid_date: string | null; paid_via: 'billcom' | 'wwd' | 'card' | 'check' | 'ach' | 'other' | null; paid_ref: string | null; cost_basis: number | null; source: 'manual' | 'order_guide' | 'placed_order_summary' | 'email' | 'show_scan' | 'confirmation'; source_key: string | null; source_sheet: string | null; extra: Json; created_by: string | null; created_at: string; updated_at: string; sales_report_id: string | null; ls_order_id: string | null; ls_shop_id: string | null }
        Insert: { id?: string; organization_id: string; vendor_id: string; status?: Database['public']['Enums']['order_status']; order_date?: string | null; season?: Database['public']['Enums']['order_season'] | null; show_code?: string | null; show_inferred?: boolean; placed_by?: string | null; placed_by_id?: string | null; taken_by?: string | null; freight_pct?: number | null; freight_pct_note?: string | null; vid_in_description?: boolean | null; freight_allowance_offered?: boolean; freight_allowance?: number | null; freight_allowance_pay_by?: string | null; freight_allowance_received?: string | null; store_codes?: string[]; billing_route?: Database['public']['Enums']['billing_route'] | null; description?: string | null; est_ship_date?: string | null; est_cost?: number | null; freight_cost?: number | null; freight_notes?: string | null; free_shipping?: boolean | null; free_shipping_basis?: 'show_special' | 'minimum_met' | 'negotiated' | 'always' | 'other' | null; free_shipping_note?: string | null; date_received?: string | null; po_number?: string | null; ls_po_number?: string | null; ar_due?: string | null; ar_due_date?: string | null; date_entered_ls?: string | null; entered_by?: string | null; backorder?: boolean; shipment_notes?: string | null; credits_due?: boolean; credit_notes?: string | null; date_credits_received?: string | null; ok_to_pay?: boolean; notes?: string | null; final_cost?: number | null; paid_date?: string | null; paid_via?: 'billcom' | 'wwd' | 'card' | 'check' | 'ach' | 'other' | null; paid_ref?: string | null; cost_basis?: number | null; source?: 'manual' | 'order_guide' | 'placed_order_summary' | 'email' | 'show_scan' | 'confirmation'; source_key?: string | null; source_sheet?: string | null; extra?: Json; created_by?: string | null; created_at?: string; updated_at?: string; sales_report_id?: string | null; ls_order_id?: string | null; ls_shop_id?: string | null }
        Update: { id?: string; organization_id?: string; vendor_id?: string; status?: Database['public']['Enums']['order_status']; order_date?: string | null; season?: Database['public']['Enums']['order_season'] | null; show_code?: string | null; show_inferred?: boolean; placed_by?: string | null; placed_by_id?: string | null; taken_by?: string | null; freight_pct?: number | null; freight_pct_note?: string | null; vid_in_description?: boolean | null; freight_allowance_offered?: boolean; freight_allowance?: number | null; freight_allowance_pay_by?: string | null; freight_allowance_received?: string | null; store_codes?: string[]; billing_route?: Database['public']['Enums']['billing_route'] | null; description?: string | null; est_ship_date?: string | null; est_cost?: number | null; freight_cost?: number | null; freight_notes?: string | null; free_shipping?: boolean | null; free_shipping_basis?: 'show_special' | 'minimum_met' | 'negotiated' | 'always' | 'other' | null; free_shipping_note?: string | null; date_received?: string | null; po_number?: string | null; ls_po_number?: string | null; ar_due?: string | null; ar_due_date?: string | null; date_entered_ls?: string | null; entered_by?: string | null; backorder?: boolean; shipment_notes?: string | null; credits_due?: boolean; credit_notes?: string | null; date_credits_received?: string | null; ok_to_pay?: boolean; notes?: string | null; final_cost?: number | null; paid_date?: string | null; paid_via?: 'billcom' | 'wwd' | 'card' | 'check' | 'ach' | 'other' | null; paid_ref?: string | null; cost_basis?: number | null; source?: 'manual' | 'order_guide' | 'placed_order_summary' | 'email' | 'show_scan' | 'confirmation'; source_key?: string | null; source_sheet?: string | null; extra?: Json; created_by?: string | null; created_at?: string; updated_at?: string; sales_report_id?: string | null; ls_order_id?: string | null; ls_shop_id?: string | null }
        Relationships: [
          { foreignKeyName: 'orders_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'orders_placed_by_id_fkey'; columns: ['placed_by_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      order_status_history: {
        Row: { id: string; order_id: string; from_status: Database['public']['Enums']['order_status'] | null; to_status: Database['public']['Enums']['order_status']; changed_by: string | null; changed_at: string; note: string | null }
        Insert: { id?: string; order_id: string; from_status?: Database['public']['Enums']['order_status'] | null; to_status: Database['public']['Enums']['order_status']; changed_by?: string | null; changed_at?: string; note?: string | null }
        Update: { id?: string; order_id?: string; from_status?: Database['public']['Enums']['order_status'] | null; to_status?: Database['public']['Enums']['order_status']; changed_by?: string | null; changed_at?: string; note?: string | null }
        Relationships: [
          { foreignKeyName: 'order_status_history_order_id_fkey'; columns: ['order_id']; isOneToOne: false; referencedRelation: 'orders'; referencedColumns: ['id'] },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      resolve_booth_rep: { Args: { p_item: string; p_yes: boolean }; Returns: undefined }
      resolve_show_line: { Args: { p_item: string; p_yes: boolean }; Returns: undefined }
      list_sent_emails: { Args: { p_org: string; p_mailbox?: string | null; p_vendor?: string | null; p_q?: string | null; p_limit?: number }; Returns: { id: string; thread_id: string; to_emails: string[]; cc_emails: string[]; subject: string | null; snippet: string | null; sent_at: string; vendor_id: string | null; vendor_name: string | null; sent_by_name: string | null; has_attachments: boolean }[] }
      amazon_monthly: { Args: { p_org: string; p_months?: number }; Returns: { month: string; store_code: string; person_name: string; orders: number; total: number }[] }
      contact_learn_queue: { Args: { p_org: string; p_limit?: number }; Returns: { email: string; vendor_id: string | null; rep_group_id: string | null; owner_name: string; emails: Json }[] }
      freight_quote_queue: { Args: { p_org: string; p_limit?: number }; Returns: { email_id: string; thread_id: string | null; vendor_id: string | null; sender_kind: string | null; from_name: string | null; from_email: string | null; subject: string | null; body_text: string; received_at: string; attachments: string[] }[] }
      freight_quote_apply: { Args: { p_email: string; p_is_quote: boolean; p_reading: Json; p_vendor: string | null; p_order: string | null; p_how: string | null }; Returns: string | null }
      email_tag_by_po: { Args: { p_email: string }; Returns: number }
      share_vendor_threads: { Args: { p_org: string; p_email?: string | null; p_sender?: string | null }; Returns: number }
      next_business_day: { Args: { p_at: string }; Returns: string }
      freight_quote_action: { Args: { p_quote: string; p_action: 'set_order' | 'ours' | 'approve' | 'decline' | 'reopen' | 'pallet' | 'parcel'; p_order?: string | null; p_priority_one?: number | null; p_wwex?: number | null; p_note?: string | null; p_choice?: string | null; p_cost?: number | null }; Returns: undefined }
      po_number_next: { Args: { p_order: string }; Returns: string | null }
      vendor_set_ls: { Args: { p_vendor: string; p_ls_vendor_id: string; p_po_code: string }; Returns: undefined }
      task_mark_paid: { Args: { p_task: string }; Returns: undefined }
      org_set_pay_links: { Args: { p_org: string; p_edenred: string | null; p_billcom: string | null }; Returns: undefined }
      order_check_use_as_order: { Args: { p_check: string }; Returns: string }
      vendor_usual_charge_add: { Args: { p_vendor: string; p_what: string; p_price: number; p_per?: string | null }; Returns: Json }
      sales_report_tick: { Args: { p_link: string; p_on: boolean; p_order?: string | null }; Returns: undefined }
      vendor_link_proof_approve: { Args: { p_link: string; p_on: boolean }; Returns: undefined }
      is_proof_name: { Args: { p_name: string | null }; Returns: boolean }
      is_real_po: { Args: { p_po: string | null }; Returns: boolean }
      freight_ships_by: { Args: { p_reading: Json }; Returns: 'pallet' | 'parcel' | null }
      freight_task_title: { Args: { p_vendor: string | null; p_po: string | null; p_needs_order: boolean; p_ships_by: string | null }; Returns: string }
      freight_unapproved_shipments: { Args: { p_org: string }; Returns: { order_id: string; vendor_id: string; vendor_name: string; po_number: string | null; order_date: string | null; status: string; has_quote: boolean }[] }
      routing_letter_add: { Args: { p_org: string; p_path: string; p_file_name: string; p_effective: string | null; p_note: string | null; p_subject: string | null; p_body: string }; Returns: string }
      routing_letter_prepare: { Args: { p_letter: string; p_who: string }; Returns: number }
      routing_letter_missing: { Args: { p_org: string; p_who: string }; Returns: { vendor_id: string; vendor_name: string; open_orders: number }[] }
      vendor_confirm_prepare: { Args: { p_org: string; p_vendor?: string | null }; Returns: number }
      vendor_confirm_states: { Args: { p_org: string }; Returns: { vendor_id: string; state: string; last_sent: string | null; confirmed_at: string | null }[] }
      vendor_by_name: { Args: { p_org: string; p_name: string }; Returns: string | null }
      service_order_queue: { Args: { p_org: string; p_limit?: number }; Returns: { email_id: string }[] }
      resolve_rep_line: { Args: { p_item: string; p_action: string }; Returns: string | null }
      supply_add: { Args: { p_org: string; p_summary: string; p_requester?: string | null; p_store?: string | null }; Returns: string }
      supply_set: { Args: { p_request: string; p_status: string; p_from?: string | null; p_order?: string | null; p_expected?: string | null }; Returns: undefined }
      list_never_bought: { Args: { p_org: string }; Returns: { company: string; sender_ids: string[]; addresses: string[] | null; website: string | null; phone: string | null; email_count: number; latest_at: string | null; checked_at: string | null; checked_by: string | null; note: string | null }[] }
      never_bought_is_vendor: { Args: { p_senders: string[]; p_vendor: string }; Returns: number }
      never_bought_make_vendor: { Args: { p_senders: string[]; p_name: string; p_website?: string | null; p_phone?: string | null }; Returns: string }
      never_bought_leave: { Args: { p_senders: string[]; p_checked?: boolean }; Returns: undefined }
      undo_sender_filing: { Args: { p_filing: string }; Returns: undefined }
      current_user_org: { Args: Record<string, never>; Returns: string | null }
      current_user_role: { Args: Record<string, never>; Returns: Database['public']['Enums']['user_role'] | null }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      user_in_org: { Args: { org_id: string }; Returns: boolean }
      user_has_store_access: { Args: { p_store_id: string }; Returns: boolean }
      store_organization_id: { Args: { p_store_id: string }; Returns: string | null }
      user_can_edit: { Args: Record<string, never>; Returns: boolean }
      merge_vendors: { Args: { p_keep: string; p_remove: string; p_route?: Database['public']['Enums']['billing_route'] | null }; Returns: string }
      unmerge_vendor: { Args: { p_vendor: string; p_lightspeed_name: string; p_route?: Database['public']['Enums']['billing_route'] | null }; Returns: string }
      confirm_vendor_merge: { Args: { p_vendor: string; p_route?: Database['public']['Enums']['billing_route'] | null }; Returns: undefined }
      resolve_review_item: { Args: { p_item: string; p_status: Database['public']['Enums']['review_status']; p_note?: string | null }; Returns: undefined }
      assign_review_item: { Args: { p_item: string; p_profile?: string | null }; Returns: undefined }
      delete_vendor: { Args: { p_vendor: string; p_note?: string | null }; Returns: undefined }
      set_sender_carrier: { Args: { p_sender: string; p_carrier: string }; Returns: number }
      freight_set_line: { Args: { p_line: string; p_vendor: string | null; p_order: string | null; p_confirm: boolean }; Returns: undefined }
      move_vendor_document: { Args: { p_link: string; p_kind: string; p_year: number | null }; Returns: undefined }
      carrier_claim_mail: { Args: { p_carrier: string }; Returns: number }
      billcom_preview: { Args: { p_rows: never }; Returns: unknown }
      billcom_import: { Args: { p_rows: never }; Returns: number }
      wwd_preview: { Args: { p: never }; Returns: unknown }
      wwd_import: { Args: { p: never }; Returns: unknown }
      wwd_assign_name: { Args: { p_name: string; p_vendor: string }; Returns: number }
      wwd_assign_name_carrier: { Args: { p_name: string; p_carrier: string }; Returns: number }
      wwd_payment_list: { Args: Record<string, never>; Returns: { payment_id: string | null; ref: string | null; pay_date: string; total: number | null; lines: number; vendors: number; discounts: number; unknown: number; pending: boolean }[] }
      wwd_update_invoice: { Args: { p_id: string; p_vendor?: string | null; p_order?: string | null; p_unlink_order?: boolean }; Returns: undefined }
      create_uploaded_freight_bill: { Args: { p_path: string; p_file: string; p_carrier: string | null }; Returns: string }
      make_freight_bill_from_attachment: { Args: { p_attachment: string; p_carrier: string }; Returns: string }
      answer_freight_payment: { Args: { p_item: string; p_bill: string }; Returns: undefined }
      set_working_order: { Args: { p_thread: string; p_action: 'flag' | 'working' | 'complete' | 'reopen' | 'unflag' }; Returns: undefined }
      team_overview: { Args: { p_org: string }; Returns: { profile_id: string; full_name: string; role: string; needs: number; needs_oldest: string | null; no_answer: number; no_answer_oldest: string | null; reviews: number; reviews_oldest: string | null; working: number; working_needs: number; vendors: number; last_sent: string | null }[] }
      propose_category_assignments: { Args: { p_rule: string }; Returns: number }
      answer_mail_reply: { Args: { p_item: string; p_needs_answer: boolean }; Returns: undefined }
      order_reviewer: { Args: { p_order: string }; Returns: string | null }
      order_check_action: { Args: { p_check: string; p_action: 'set_order' | 'assign' | 'done' | 'sent' | 'recheck' | 'dismiss' | 'reopen' | 'tick_report'; p_order?: string | null; p_profile?: string | null; p_thread?: string | null }; Returns: undefined }
      ls_po_start: { Args: { p_order: string }; Returns: string | null }
      ls_po_action: { Args: { p_id: string; p_action: string; p_lines?: Json | null; p_number?: string | null }; Returns: undefined }
      complete_task: { Args: { p_task: string; p_note?: string | null }; Returns: string | null }
      task_next_due: { Args: { p_due: string; p_every: number; p_unit: string; p_days?: number[] }; Returns: string | null }
      share_thread_to_orders: { Args: { p_thread: string; p_share?: boolean }; Returns: undefined }
      can_see_mailbox: { Args: { p_mailbox: string }; Returns: boolean }
      mail_with: { Args: { p_org: string; p_email: string; p_company?: boolean; p_limit?: number }; Returns: { id: string; thread_id: string; direction: 'in' | 'out' | 'internal'; from_email: string | null; from_name: string | null; to_emails: string[]; cc_emails: string[]; subject: string | null; snippet: string | null; received_at: string; has_attachments: boolean; vendor_id: string | null; vendor_name: string | null }[] }
      mail_free_domain: { Args: { p_domain: string }; Returns: boolean }
      set_art_status: { Args: { p_thread: string; p_status: 'waiting' | 'needs_changes' | 'changes_sent' | 'approved' | 'none' }; Returns: undefined }
      file_delivery_receipt: { Args: { p_receipt: string; p_vendor: string }; Returns: undefined }
      tag_email_vendor: { Args: { p_email: string; p_vendor: string; p_on: boolean }; Returns: undefined }
      move_order_vendor: { Args: { p_order: string; p_vendor: string }; Returns: undefined }
      delete_rep_group: { Args: { p_group: string }; Returns: undefined }
      review_sender_emails: { Args: { p_sender: string; p_email_ids: string[]; p_action: 'vendor' | 'marketing' | 'other'; p_vendor?: string | null }; Returns: number }
      set_vendor_assignee: { Args: { p_vendor: string; p_profile: string | null }; Returns: undefined }
      resolve_email_sender: { Args: { p_sender: string; p_kind: 'vendor' | 'rep_group' | 'platform' | 'marketing' | 'not_vendor' | 'internal'; p_vendor?: string | null; p_rep_group?: string | null }; Returns: number }
      link_email_thread_order: { Args: { p_thread: string; p_order: string | null }; Returns: undefined }
      set_email_thread_view: { Args: { p_thread: string; p_view: 'attention' | 'offers'; p_teach?: boolean }; Returns: number }
      mail_reclassify_all: { Args: { p_org: string }; Returns: number }
      set_email_vendor: { Args: { p_email: string; p_vendor: string | null }; Returns: undefined }
      assign_email_thread: { Args: { p_thread: string; p_profile?: string | null }; Returns: undefined }
      set_email_thread_status: { Args: { p_thread: string; p_status: 'waiting_on_us' | 'waiting_on_vendor' | 'handled' }; Returns: undefined }
      apply_review_rules: { Args: { p_org: string; p_overwrite?: boolean }; Returns: number }
      vendor_scorecards: { Args: { p_org: string; p_vendor?: string | null }; Returns: { vendor_id: string; name: string; standing: 'ok' | 'hold' | 'last_resort' | 'do_not_order'; standing_tags: string[]; standing_reason: string | null; orders: number; received: number; on_time: number; late: number; avg_days_late: number | null; freight_pct: number | null; freight_orders: number; free_violations: number; issue_notes: number; accuracy_issues: number; credits_due: number; credits_resolved: number; avg_credit_days: number | null; auto_fulfilment: number | null; auto_accuracy: number | null; auto_shipping: number | null; auto_resolution: number | null; rated_ease: number | null; rated_communication: number | null; rated_fulfilment: number | null; rated_accuracy: number | null; rated_shipping: number | null; rated_resolution: number | null; note_ease: string | null; note_communication: string | null; note_fulfilment: string | null; note_accuracy: string | null; note_shipping: string | null; note_resolution: string | null; overall: number | null }[] }
      directory_route_for: { Args: { p_org: string; p_name: string; p_domain?: string | null }; Returns: Database['public']['Enums']['billing_route'] | null }
      promote_line_to_vendor: { Args: { p_line: string; p_route?: Database['public']['Enums']['billing_route'] | null }; Returns: string }
      apply_vendor_rename: { Args: { p_item: string; p_new_name?: string | null; p_rep_group_id?: string | null }; Returns: undefined }
    }
    Enums: {
      user_role: 'admin' | 'manager' | 'buyer' | 'viewer' | 'uploader'
      billing_route: 'worldwide' | 'faire' | 'direct' | 'prepaid_direct'
      contact_type: 'rep' | 'ap' | 'customer_service' | 'shipping' | 'orders' | 'owner' | 'other'
      contact_source: 'import' | 'manual' | 'email_enrichment' | 'vendor_form'
      ordering_frequency: 'weekly' | 'monthly' | 'seasonal' | 'annual' | 'as_needed'
      order_window_kind: 'feb_show' | 'aug_show' | 'pre_season' | 'reorder' | 'delivery' | 'custom'
      review_status: 'pending' | 'accepted' | 'rejected'
      order_status: 'open' | 'awaiting_confirmation' | 'confirmed' | 'shipped' | 'received' | 'entered' | 'ready_to_pay' | 'paid' | 'cancelled'
      order_season: 'summer' | 'winter'
      link_kind: 'catalog' | 'price_list' | 'order_form' | 'specials' | 'website' | 'other' | 'invoice' | 'credit' | 'confirmation' | 'order' | 'ls_po' | 'packing_slip' | 'payment' | 'freight_bill' | 'delivery_receipt' | 'image' | 'approved_proof' | 'damage_photo' | 'sales_report' | 'proof'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]
