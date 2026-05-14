// Supabase client wrapper that targets the warehouse schemas (fact, dim,
// app) created by the cornerstone-dashboard port migrations.
//
// Schemas other than `public` are reachable from supabase-js v2 via
// `supabase.schema('fact').from('fact_pipeline')`. The schemas must be
// allowlisted in the Supabase Dashboard → API → Exposed schemas.
// Grants are wired in analytics_dashboard_0005_rls.

import { supabase } from "@/lib/supabase";

export const fact = () => supabase.schema("fact");
export const dim  = () => supabase.schema("dim");
export const app  = () => supabase.schema("app");
