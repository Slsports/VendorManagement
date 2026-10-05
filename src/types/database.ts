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
          is_delivery_vendor: boolean; minimum_order: string | null; freight_program: string | null; product_types: string | null; notes: string | null; needs_review: boolean; review_note: string | null; do_not_order: boolean; do_not_order_reason: string | null
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
          is_delivery_vendor?: boolean; minimum_order?: string | null; freight_program?: string | null; product_types?: string | null; notes?: string | null; needs_review?: boolean; review_note?: string | null; do_not_order?: boolean; do_not_order_reason?: string | null
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
          is_delivery_vendor?: boolean; minimum_order?: string | null; freight_program?: string | null; product_types?: string | null; notes?: string | null; needs_review?: boolean; review_note?: string | null; do_not_order?: boolean; do_not_order_reason?: string | null
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
        Row: { id: string; organization_id: string; kind: string; entity_type: string | null; entity_id: string | null; title: string; details: Json; status: Database['public']['Enums']['review_status']; created_by: string | null; created_at: string; resolved_by: string | null; resolved_at: string | null; resolution_note: string | null }
        Insert: { id?: string; organization_id: string; kind: string; entity_type?: string | null; entity_id?: string | null; title: string; details?: Json; status?: Database['public']['Enums']['review_status']; created_by?: string | null; created_at?: string; resolved_by?: string | null; resolved_at?: string | null; resolution_note?: string | null }
        Update: { id?: string; organization_id?: string; kind?: string; entity_type?: string | null; entity_id?: string | null; title?: string; details?: Json; status?: Database['public']['Enums']['review_status']; created_by?: string | null; created_at?: string; resolved_by?: string | null; resolved_at?: string | null; resolution_note?: string | null }
        Relationships: [
          { foreignKeyName: 'review_items_resolved_by_fkey'; columns: ['resolved_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
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
    }
    Enums: {
      user_role: 'admin' | 'manager' | 'buyer' | 'viewer' | 'uploader'
      billing_route: 'worldwide' | 'faire' | 'direct'
      contact_type: 'rep' | 'ap' | 'customer_service' | 'shipping' | 'orders' | 'owner' | 'other'
      contact_source: 'import' | 'manual' | 'email_enrichment' | 'vendor_form'
      ordering_frequency: 'weekly' | 'monthly' | 'seasonal' | 'annual' | 'as_needed'
      order_window_kind: 'feb_show' | 'aug_show' | 'pre_season' | 'reorder' | 'delivery' | 'custom'
      review_status: 'pending' | 'accepted' | 'rejected'
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
