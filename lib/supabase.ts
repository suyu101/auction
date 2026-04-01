import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isBrowser = typeof window !== 'undefined';

const globalForSupabase = globalThis as unknown as {
  supabase: SupabaseClient | undefined;
};

// ── Initialisation ────────────────────────────────
// If environment variables are missing (e.g. during a CI build scan),
// we provide a dummy client or skip creation to prevent evaluation crashes.
export const supabase =
  globalForSupabase.supabase ??
  (url && key
    ? createClient(url, key, {
        auth: {
          persistSession: isBrowser,
          autoRefreshToken: isBrowser,
          detectSessionInUrl: isBrowser,
        },
      })
    : (null as unknown as SupabaseClient)); // fallback for build-time evaluation

if (process.env.NODE_ENV !== 'production' && supabase) {
  globalForSupabase.supabase = supabase;
}