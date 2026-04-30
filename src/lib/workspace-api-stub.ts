// Stub for the Replit `@workspace/api-client-react` package.
// Returns empty / no-op states so the dashboard shell can render before
// each page is ported to Supabase in Step 7.

type QueryResult<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

type MutationResult<TVars = unknown> = {
  mutate: (vars: TVars) => void;
  mutateAsync: (vars: TVars) => Promise<void>;
  isPending: boolean;
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
  isError: false,
  error: null,
  reset: () => {},
});

// --- configuration (no-ops; real auth will be wired through Supabase) ---
export function setBaseUrl(_url: string): void {}
export function setAuthTokenGetter(_getter: () => string | null): void {}

// --- queries ---
export const useGetLiveCall = (_id?: string) => emptyQuery<any>();
export const useListKbDocuments = () => emptyListQuery<any>();
export const useListCallSessions = (..._args: any[]) => emptyListQuery<any>();
export const useListMissedCalls = (..._args: any[]) => emptyListQuery<any>();
export const useListReps = () => emptyListQuery<any>();
export const useListRoutingEvents = (..._args: any[]) => emptyListQuery<any>();
export const useGetWriteLog = (..._args: any[]) => emptyListQuery<any>();
export const useListFailedWrites = () => emptyListQuery<any>();
export const useListFieldAuditLog = (..._args: any[]) => emptyListQuery<any>();
export const useGetRepRankings = (..._args: any[]) => emptyListQuery<any>();
export const useGetThresholds = () => emptyQuery<any>();
export const useListEscalationRules = () => emptyListQuery<any>();
export const useListDuplicates = () => emptyListQuery<any>();
export const useGetFullTranscript = (_id?: string) => emptyQuery<any>();
export const useQueryKb = (..._args: any[]) => emptyQuery<any>();

// --- mutations ---
export const useReindexKb = () => emptyMutation();
export const useApproveField = () => emptyMutation();
export const useReplayCall = () => emptyMutation();
export const useRetryFailedWrite = () => emptyMutation();
export const useUpdateThresholds = () => emptyMutation();
export const useApproveKbDocument = () => emptyMutation();
export const useRevokeKbDocument = () => emptyMutation();
export const useUnapproveKbDocument = () => emptyMutation();
export const useMergeLeads = () => emptyMutation();
