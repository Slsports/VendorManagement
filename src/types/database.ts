/**
 * Database types for the tables created in supabase/migrations.
 *
 * Hand-written for migration 0001. Once the Supabase CLI is linked, regenerate with:
 *   npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > src/types/database.ts
 */
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
        }
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
        }
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
        }
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
          id: string; organization_id: string; name: string; lightspeed_name: string | null; lightspeed_vendor_id: string | null; aliases: string[]
          rep_group_id: string | null; assigned_buyer_id: string | null; payment_terms_id: string | null
          website: string | null; account_number: string | null; catalog: string | null; phone: string | null; fax: string | null
          address: string | null; city: string | null; state: string | null; postal_code: string | null; country: string | null
          rep_name: string | null; rep_phone: string | null; pickup_address: string | null; pickup_times: string | null
          shipping_contact: string | null; shipping_contact_phone: string | null; return_notes: string | null; google_drive_folder: string | null
          rating: number | null; tier: string | null; ordering_frequency: Database['public']['Enums']['ordering_frequency'] | null
          is_delivery_vendor: boolean; minimum_order: string | null; freight_program: string | null; free_shipping_policy: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold: number | null; freight_routing: string | null; product_types: string | null; notes: string | null; needs_review: boolean; review_note: string | null; do_not_order: boolean; do_not_order_reason: string | null; merged_into_id: string | null; wwd_zero_upcharge: boolean; report_owner: string | null; is_fishing: boolean
          is_active: boolean; created_by: string | null; created_at: string; updated_at: string
        }
        Insert: {
          id?: string; organization_id: string; name: string; lightspeed_name?: string | null; lightspeed_vendor_id?: string | null; aliases?: string[]
          rep_group_id?: string | null; assigned_buyer_id?: string | null; payment_terms_id?: string | null
          website?: string | null; account_number?: string | null; catalog?: string | null; phone?: string | null; fax?: string | null
          address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null
          rep_name?: string | null; rep_phone?: string | null; pickup_address?: string | null; pickup_times?: string | null
          shipping_contact?: string | null; shipping_contact_phone?: string | null; return_notes?: string | null; google_drive_folder?: string | null
          rating?: number | null; tier?: string | null; ordering_frequency?: Database['public']['Enums']['ordering_frequency'] | null
          is_delivery_vendor?: boolean; minimum_order?: string | null; freight_program?: string | null; free_shipping_policy?: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold?: number | null; freight_routing?: string | null; product_types?: string | null; notes?: string | null; needs_review?: boolean; review_note?: string | null; do_not_order?: boolean; do_not_order_reason?: string | null; merged_into_id?: string | null; wwd_zero_upcharge?: boolean; report_owner?: string | null; is_fishing?: boolean
          is_active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string
        }
        Update: {
          id?: string; organization_id?: string; name?: string; lightspeed_name?: string | null; lightspeed_vendor_id?: string | null; aliases?: string[]
          rep_group_id?: string | null; assigned_buyer_id?: string | null; payment_terms_id?: string | null
          website?: string | null; account_number?: string | null; catalog?: string | null; phone?: string | null; fax?: string | null
          address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null
          rep_name?: string | null; rep_phone?: string | null; pickup_address?: string | null; pickup_times?: string | null
          shipping_contact?: string | null; shipping_contact_phone?: string | null; return_notes?: string | null; google_drive_folder?: string | null
          rating?: number | null; tier?: string | null; ordering_frequency?: Database['public']['Enums']['ordering_frequency'] | null
          is_delivery_vendor?: boolean; minimum_order?: string | null; freight_program?: string | null; free_shipping_policy?: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold?: number | null; freight_routing?: string | null; product_types?: string | null; notes?: string | null; needs_review?: boolean; review_note?: string | null; do_not_order?: boolean; do_not_order_reason?: string | null; merged_into_id?: string | null; wwd_zero_upcharge?: boolean; report_owner?: string | null; is_fishing?: boolean
          is_active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'vendors_organization_id_fkey'; columns: ['organization_id']; isOneToOne: false; referencedRelation: 'organizations'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendors_rep_group_id_fkey'; columns: ['rep_group_id']; isOneToOne: false; referencedRelation: 'rep_groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendors_assigned_buyer_id_fkey'; columns: ['assigned_buyer_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'vendors_payment_terms_id_fkey'; columns: ['payment_terms_id']; isOneToOne: false; referencedRelation: 'payment_terms'; referencedColumns: ['id'] },
        ]
      }
      vendor_billing_routes: {
        Row: { organization_id: string | null; vendor_id: string; route: Database['public']['Enums']['billing_route']; is_default: boolean; account_number: string | null; notes: string | null; created_at: string }
        Insert: { organization_id?: string | null; vendor_id: string; route: Database['public']['Enums']['billing_route']; is_default?: boolean; account_number?: string | null; notes?: string | null; created_at?: string }
        Update: { organization_id?: string | null; vendor_id?: string; route?: Database['public']['Enums']['billing_route']; is_default?: boolean; account_number?: string | null; notes?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'vendor_billing_routes_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
        ]
      }
      vendor_emails: {
        Row: { id: string; organization_id: string | null; vendor_id: string; email: string; contact_name: string | null; title: string | null; phone: string | null; contact_type: Database['public']['Enums']['contact_type']; source: Database['public']['Enums']['contact_source']; confidence: number | null; verified_at: string | null; is_primary: boolean; notes: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id?: string | null; vendor_id: string; email: string; contact_name?: string | null; title?: string | null; phone?: string | null; contact_type?: Database['public']['Enums']['contact_type']; source?: Database['public']['Enums']['contact_source']; confidence?: number | null; verified_at?: string | null; is_primary?: boolean; notes?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string | null; vendor_id?: string; email?: string; contact_name?: string | null; title?: string | null; phone?: string | null; contact_type?: Database['public']['Enums']['contact_type']; source?: Database['public']['Enums']['contact_source']; confidence?: number | null; verified_at?: string | null; is_primary?: boolean; notes?: string | null; created_at?: string; updated_at?: string }
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
      review_assignment_rules: {
        Row: { id: string; organization_id: string; match_kind: 'vendor' | 'fishing' | 'department' | 'review_kind' | 'fallback'; match_value: string | null; vendor_id: string | null; assignee_id: string; priority: number; is_active: boolean; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; match_kind: 'vendor' | 'fishing' | 'department' | 'review_kind' | 'fallback'; match_value?: string | null; vendor_id?: string | null; assignee_id: string; priority?: number; is_active?: boolean; note?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; match_kind?: 'vendor' | 'fishing' | 'department' | 'review_kind' | 'fallback'; match_value?: string | null; vendor_id?: string | null; assignee_id?: string; priority?: number; is_active?: boolean; note?: string | null; created_by?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'review_assignment_rules_vendor_id_fkey'; columns: ['vendor_id']; isOneToOne: false; referencedRelation: 'vendors'; referencedColumns: ['id'] },
          { foreignKeyName: 'review_assignment_rules_assignee_id_fkey'; columns: ['assignee_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
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
      vendor_links: {
        Row: { id: string; organization_id: string; vendor_id: string | null; line_id: string | null; kind: Database['public']['Enums']['link_kind']; order_id: string | null; label: string; url: string | null; storage_path: string | null; file_name: string | null; file_size: number | null; mime_type: string | null; season_label: string | null; received_at: string | null; source: 'manual' | 'rep_list' | 'email' | 'vendor_form'; notes: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; vendor_id?: string | null; line_id?: string | null; kind: Database['public']['Enums']['link_kind']; order_id?: string | null; label: string; url?: string | null; storage_path?: string | null; file_name?: string | null; file_size?: number | null; mime_type?: string | null; season_label?: string | null; received_at?: string | null; source?: 'manual' | 'rep_list' | 'email' | 'vendor_form'; notes?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string | null; line_id?: string | null; kind?: Database['public']['Enums']['link_kind']; order_id?: string | null; label?: string; url?: string | null; storage_path?: string | null; file_name?: string | null; file_size?: number | null; mime_type?: string | null; season_label?: string | null; received_at?: string | null; source?: 'manual' | 'rep_list' | 'email' | 'vendor_form'; notes?: string | null; created_by?: string | null; created_at?: string }
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
        Row: { id: string; organization_id: string; vendor_id: string; status: Database['public']['Enums']['order_status']; order_date: string | null; season: Database['public']['Enums']['order_season'] | null; show_code: string | null; show_inferred: boolean; placed_by: string | null; placed_by_id: string | null; store_codes: string[]; billing_route: Database['public']['Enums']['billing_route'] | null; description: string | null; est_ship_date: string | null; est_cost: number | null; freight_cost: number | null; freight_notes: string | null; free_shipping: boolean | null; free_shipping_basis: 'show_special' | 'minimum_met' | 'negotiated' | 'always' | 'other' | null; free_shipping_note: string | null; date_received: string | null; po_number: string | null; ar_due: string | null; ar_due_date: string | null; date_entered_ls: string | null; entered_by: string | null; backorder: boolean; shipment_notes: string | null; credits_due: boolean; credit_notes: string | null; date_credits_received: string | null; ok_to_pay: boolean; notes: string | null; final_cost: number | null; paid_date: string | null; paid_via: 'billcom' | 'wwd' | 'card' | 'other' | null; paid_ref: string | null; cost_basis: number | null; source: 'manual' | 'order_guide' | 'placed_order_summary' | 'email' | 'show_scan'; source_key: string | null; source_sheet: string | null; extra: Json; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; vendor_id: string; status?: Database['public']['Enums']['order_status']; order_date?: string | null; season?: Database['public']['Enums']['order_season'] | null; show_code?: string | null; show_inferred?: boolean; placed_by?: string | null; placed_by_id?: string | null; store_codes?: string[]; billing_route?: Database['public']['Enums']['billing_route'] | null; description?: string | null; est_ship_date?: string | null; est_cost?: number | null; freight_cost?: number | null; freight_notes?: string | null; free_shipping?: boolean | null; free_shipping_basis?: 'show_special' | 'minimum_met' | 'negotiated' | 'always' | 'other' | null; free_shipping_note?: string | null; date_received?: string | null; po_number?: string | null; ar_due?: string | null; ar_due_date?: string | null; date_entered_ls?: string | null; entered_by?: string | null; backorder?: boolean; shipment_notes?: string | null; credits_due?: boolean; credit_notes?: string | null; date_credits_received?: string | null; ok_to_pay?: boolean; notes?: string | null; final_cost?: number | null; paid_date?: string | null; paid_via?: 'billcom' | 'wwd' | 'card' | 'other' | null; paid_ref?: string | null; cost_basis?: number | null; source?: 'manual' | 'order_guide' | 'placed_order_summary' | 'email' | 'show_scan'; source_key?: string | null; source_sheet?: string | null; extra?: Json; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; organization_id?: string; vendor_id?: string; status?: Database['public']['Enums']['order_status']; order_date?: string | null; season?: Database['public']['Enums']['order_season'] | null; show_code?: string | null; show_inferred?: boolean; placed_by?: string | null; placed_by_id?: string | null; store_codes?: string[]; billing_route?: Database['public']['Enums']['billing_route'] | null; description?: string | null; est_ship_date?: string | null; est_cost?: number | null; freight_cost?: number | null; freight_notes?: string | null; free_shipping?: boolean | null; free_shipping_basis?: 'show_special' | 'minimum_met' | 'negotiated' | 'always' | 'other' | null; free_shipping_note?: string | null; date_received?: string | null; po_number?: string | null; ar_due?: string | null; ar_due_date?: string | null; date_entered_ls?: string | null; entered_by?: string | null; backorder?: boolean; shipment_notes?: string | null; credits_due?: boolean; credit_notes?: string | null; date_credits_received?: string | null; ok_to_pay?: boolean; notes?: string | null; final_cost?: number | null; paid_date?: string | null; paid_via?: 'billcom' | 'wwd' | 'card' | 'other' | null; paid_ref?: string | null; cost_basis?: number | null; source?: 'manual' | 'order_guide' | 'placed_order_summary' | 'email' | 'show_scan'; source_key?: string | null; source_sheet?: string | null; extra?: Json; created_by?: string | null; created_at?: string; updated_at?: string }
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
      apply_review_rules: { Args: { p_org: string; p_overwrite?: boolean }; Returns: number }
      vendor_scorecards: { Args: { p_org: string; p_vendor?: string | null }; Returns: { vendor_id: string; name: string; orders: number; received: number; on_time: number; late: number; avg_days_late: number | null; freight_pct: number | null; freight_orders: number; free_violations: number; issue_notes: number; accuracy_issues: number; credits_due: number; credits_resolved: number; avg_credit_days: number | null; auto_fulfilment: number | null; auto_accuracy: number | null; auto_shipping: number | null; auto_resolution: number | null; rated_ease: number | null; rated_communication: number | null; rated_fulfilment: number | null; rated_accuracy: number | null; rated_shipping: number | null; rated_resolution: number | null; note_ease: string | null; note_communication: string | null; note_fulfilment: string | null; note_accuracy: string | null; note_shipping: string | null; note_resolution: string | null; overall: number | null }[] }
      directory_route_for: { Args: { p_org: string; p_name: string; p_domain?: string | null }; Returns: Database['public']['Enums']['billing_route'] | null }
      promote_line_to_vendor: { Args: { p_line: string; p_route?: Database['public']['Enums']['billing_route'] | null }; Returns: string }
      apply_vendor_rename: { Args: { p_item: string; p_new_name?: string | null; p_rep_group_id?: string | null }; Returns: undefined }
    }
    Enums: {
      user_role: 'admin' | 'manager' | 'buyer' | 'viewer' | 'uploader'
      billing_route: 'worldwide' | 'faire' | 'direct'
      contact_type: 'rep' | 'ap' | 'customer_service' | 'shipping' | 'orders' | 'owner' | 'other'
      contact_source: 'import' | 'manual' | 'email_enrichment' | 'vendor_form'
      ordering_frequency: 'weekly' | 'monthly' | 'seasonal' | 'annual' | 'as_needed'
      order_window_kind: 'feb_show' | 'aug_show' | 'pre_season' | 'reorder' | 'delivery' | 'custom'
      review_status: 'pending' | 'accepted' | 'rejected'
      order_status: 'open' | 'awaiting_confirmation' | 'confirmed' | 'shipped' | 'received' | 'entered' | 'ready_to_pay' | 'paid' | 'cancelled'
      order_season: 'summer' | 'winter'
      link_kind: 'catalog' | 'price_list' | 'order_form' | 'specials' | 'website' | 'other' | 'invoice' | 'confirmation' | 'order' | 'packing_slip' | 'payment'
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
