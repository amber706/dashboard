// useSavedViews — per-user named FilterContract presets, scoped by page_key.
//
// Bookmarks like "BD focus" or "AHCCCS deep dive" live in
// reporting.saved_filter_views (RLS: own rows only). One hook per page.
//
// list / save / delete are individual mutations; the page composes them.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

export interface SavedView {
  id: string;
  name: string;
  filters: FilterContract;
  created_at: string;
}

export function useSavedViews(pageKey: string) {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ["op-saved-views", pageKey],
    queryFn: async (): Promise<SavedView[]> => {
      const { data, error } = await supabase.rpc("reporting_op_saved_views_list", {
        p_page_key: pageKey,
      });
      if (error) throw new Error(`reporting_op_saved_views_list: ${error.message}`);
      return (data ?? []) as SavedView[];
    },
    staleTime: 60 * 1000,
  });

  const upsert = useMutation({
    mutationFn: async ({ name, filters }: { name: string; filters: FilterContract }) => {
      const { data, error } = await supabase.rpc("reporting_op_saved_views_upsert", {
        p_page_key: pageKey,
        p_name: name,
        p_filters: filters,
      });
      if (error) throw new Error(`reporting_op_saved_views_upsert: ${error.message}`);
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["op-saved-views", pageKey] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reporting_op_saved_views_delete", { p_id: id });
      if (error) throw new Error(`reporting_op_saved_views_delete: ${error.message}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["op-saved-views", pageKey] }),
  });

  return { list, upsert, remove };
}
