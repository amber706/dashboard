// Replacement for the Replit `@workspace/api-client-react` package.
// React hooks here issue real Supabase queries and return the same
// `{ data, isLoading, isError, error, refetch }` shape the original
// hooks did, so call sites stay unchanged.
//
// Ports added incrementally as each page is wired up. Hooks with no
// real backing query yet keep returning a stable empty shape.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

type QueryResult<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

type MutationOptions = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

type MutationResult<TVars = unknown> = {
  mutate: (vars: TVars, opts?: MutationOptions) => void;
  mutateAsync: (vars: TVars, opts?: MutationOptions) => Promise<void>;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
};

const emptyQuery = <T>(): QueryResult<T> => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: async () => {},
});

const emptyListQuery = <T>(): QueryResult<T[]> => ({
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  refetch: async () => {},
});

const emptyMutation = <TVars = unknown>(): MutationResult<TVars> => ({
  mutate: () => {},
  mutateAsync: async () => {},
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  reset: () => {},
});

// Generic mutation runner that mirrors the react-query MutationResult
// surface used by the existing pages: mutate(vars, {onSuccess, onError}),
// isPending, isSuccess, isError, error.
function useSupabaseMutation<TVars>(
  fn: (vars: TVars) => Promise<void>,
): MutationResult<TVars> {
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(
    async (vars: TVars, opts?: MutationOptions) => {
      setIsPending(true);
      setIsSuccess(false);
      setError(null);
      try {
        await fn(vars);
        setIsSuccess(true);
        opts?.onSuccess?.();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        opts?.onError?.(err);
      } finally {
        setIsPending(false);
      }
    },
    [fn],
  );

  const mutate = useCallback(
    (vars: TVars, opts?: MutationOptions) => {
      void mutateAsync(vars, opts);
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  return {
    mutate,
    mutateAsync,
    isPending,
    isSuccess,
    isError: error !== null,
    error,
    reset,
  };
}

// Generic loader that runs a Supabase fetcher and exposes it as a
// QueryResult. The fetcher is keyed by `depsKey` so changing args
// triggers a re-fetch.
function useSupabaseQuery<T>(
  fetcher: () => Promise<{ data: T | undefined; error: Error | null }>,
  depsKey: string,
): QueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetcher();
      setData(result.data);
      setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
    // fetcher captures depsKey already; eslint rule satisfied via depsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  useEffect(() => {
    run();
  }, [run]);

  return {
    data,
    isLoading,
    isError: error !== null,
    error,
    refetch: run,
  };
}

// --- configuration (no-ops; auth runs through Supabase elsewhere) ---
export function setBaseUrl(_url: string): void {}
export function setAuthTokenGetter(_getter: () => string | null): void {}

// --- queries ---

export const useGetLiveCall = (_id?: string) => emptyQuery<any>();

export function useListReps() {
  return useSupabaseQuery<{ reps: any[] }>(
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, is_active")
        .eq("role", "specialist")
        .eq("is_active", true)
        .order("full_name");
      if (error) return { data: undefined, error: new Error(error.message) };
      const reps = (data ?? []).map((p) => ({
        rep_id: p.id,
        rep_name: p.full_name ?? p.email ?? "Unknown",
        availability_status: "available",
        active_open_leads: 0,
        recent_answer_rate: null,
        recent_book_rate: null,
        specialty_tags: [],
      }));
      return { data: { reps }, error: null };
    },
    "reps:active-specialists",
  );
}

export function useListCallSessions(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 50;
  return useSupabaseQuery<{ sessions: any[] }>(
    async () => {
      const { data, error } = await supabase
        .from("call_sessions")
        .select(
          `id, ctm_call_id, status, caller_phone, started_at, rep_id,
           rep:profiles!call_sessions_rep_id_fkey(full_name, email)`,
        )
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) return { data: undefined, error: new Error(error.message) };
      const sessions = (data ?? []).map((row) => {
        const rep = row.rep as { full_name: string | null; email: string | null } | null;
        return {
          id: row.id,
          ctm_call_id: row.ctm_call_id,
          status: row.status,
          caller_phone: row.caller_phone,
          started_at: row.started_at,
          rep_id: row.rep_id,
          rep_name: rep?.full_name ?? rep?.email ?? null,
          lead_quality_tier: undefined,
          lead_score: undefined,
        };
      });
      return { data: { sessions }, error: null };
    },
    `sessions:limit=${limit}`,
  );
}

export function useListMissedCalls(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 50;
  return useSupabaseQuery<{ missed_calls: any[] }>(
    async () => {
      const { data, error } = await supabase
        .from("call_sessions")
        .select("ctm_call_id, caller_phone, rep_id, started_at, status")
        .in("status", ["missed", "voicemail", "abandoned"])
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) return { data: undefined, error: new Error(error.message) };
      return { data: { missed_calls: data ?? [] }, error: null };
    },
    `missed:limit=${limit}`,
  );
}

export function useListKbDocuments() {
  return useSupabaseQuery<{ documents: any[] }>(
    async () => {
      const { data, error } = await supabase
        .from("kb_documents")
        .select(
          "id, title, content, category, source, status, last_reviewed_at, freshness_score, usage_count, created_at, updated_at",
        )
        .order("updated_at", { ascending: false });
      if (error) return { data: undefined, error: new Error(error.message) };
      // The admin page reads doc.approved (boolean), so derive it from
      // the kb_doc_status enum here.
      const documents = (data ?? []).map((d) => ({
        ...d,
        approved: d.status === "approved",
      }));
      return { data: { documents }, error: null };
    },
    "kb-documents",
  );
}

export const useListRoutingEvents = (..._args: any[]) => emptyListQuery<any>();
export const useGetWriteLog = (..._args: any[]) => emptyListQuery<any>();
export const useListFailedWrites = () => emptyListQuery<any>();
export const useListFieldAuditLog = (..._args: any[]) => emptyListQuery<any>();
export const useGetRepRankings = (..._args: any[]) => emptyListQuery<any>();
export const useGetThresholds = () => emptyQuery<any>();

// No `escalation_rules` table exists in the v3 schema yet; this is a
// Phase 1+ feature. Keep the hook returning an empty list so the admin
// page renders its "no rules configured" state cleanly.
export const useListEscalationRules = (): QueryResult<{ rules: any[] }> => ({
  data: { rules: [] },
  isLoading: false,
  isError: false,
  error: null,
  refetch: async () => {},
});

export const useListDuplicates = () => emptyListQuery<any>();
export const useGetFullTranscript = (_id?: string) => emptyQuery<any>();
export const useQueryKb = (..._args: any[]) => emptyQuery<any>();

// --- mutations ---

// KB document status flips. Schema: kb_documents.status enum
// ('approved', 'archived', 'pending'). Approve/Unapprove are wired on
// the admin KB tab; Revoke is exported for parity but not invoked by
// the current UI.
export const useApproveKbDocument = () =>
  useSupabaseMutation<{ docId: string }>(async ({ docId }) => {
    const { error } = await supabase
      .from("kb_documents")
      .update({ status: "approved" })
      .eq("id", docId);
    if (error) throw new Error(error.message);
  });

export const useUnapproveKbDocument = () =>
  useSupabaseMutation<{ docId: string }>(async ({ docId }) => {
    const { error } = await supabase
      .from("kb_documents")
      .update({ status: "pending" })
      .eq("id", docId);
    if (error) throw new Error(error.message);
  });

export const useRevokeKbDocument = () =>
  useSupabaseMutation<{ docId: string }>(async ({ docId }) => {
    const { error } = await supabase
      .from("kb_documents")
      .update({ status: "archived" })
      .eq("id", docId);
    if (error) throw new Error(error.message);
  });

// No-op mutations: these have no backing storage in the v3 schema
// and / or no upstream pipeline producing rows for them to act on yet.
//
// - useApproveField: writes confirmed values into field_extractions.
//   Table exists, but no extractions are produced until the Phase 2
//   grader / live-transcript pipeline runs.
// - useUpdateThresholds: needs a thresholds / system-config table that
//   does not exist in v3. Phase 1+ once the field-extraction pipeline
//   needs configurable confidence cutoffs.
// - useMergeLeads: depends on duplicate-detection that hasn't been
//   built; the admin Duplicates tab is non-functional until then.
// - useReindexKb / useReplayCall / useRetryFailedWrite: ops actions
//   that hit pipelines we haven't ported (vector index, replay, write
//   retry).
export const useApproveField = () => emptyMutation();
export const useUpdateThresholds = () => emptyMutation();
export const useMergeLeads = () => emptyMutation();
export const useReindexKb = () => emptyMutation();
export const useReplayCall = () => emptyMutation();
export const useRetryFailedWrite = () => emptyMutation();
