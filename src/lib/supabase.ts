import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.",
  );
}

// Override the default navigator.locks-based auth coordination.
// navigator.locks is shared across all same-origin tabs in a Chrome session,
// and orphaned locks (from a closed/crashed tab) cause getSession() to hang
// forever. The AuthGate then sits in `isLoading: true` and the page never
// renders. We swap to an in-process lock: per-tab serialization of auth
// operations, with no cross-tab coordination at all.
async function processLock<R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  return await fn();
}

// Cache the client on globalThis so Vite HMR re-evaluations reuse the
// existing GoTrueClient. Combined with processLock above, this prevents
// both intra-tab (HMR) and cross-tab (navigator.locks) deadlock paths.
const globalCache = globalThis as unknown as { __supabase?: SupabaseClient };

export const supabase: SupabaseClient =
  globalCache.__supabase ??
  (globalCache.__supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: processLock,
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
