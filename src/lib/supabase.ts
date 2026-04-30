import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.",
  );
}

// Cache the client on globalThis so Vite HMR re-evaluations reuse the
// existing GoTrueClient. Multiple instances all contend for the same
// Web Lock (navigator.locks) and orphan each other, hanging queries
// behind a never-released auth lock. One client per browser session.
const globalCache = globalThis as unknown as { __supabase?: SupabaseClient };

export const supabase: SupabaseClient =
  globalCache.__supabase ??
  (globalCache.__supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));

export type Role = "specialist" | "manager" | "admin";

export interface Profile {
  id: string;
  role: Role;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
}
