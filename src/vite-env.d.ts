/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_NAME?: string
  readonly VITE_ORG_NAME?: string
  readonly VITE_LOGO_URL?: string
  readonly VITE_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
