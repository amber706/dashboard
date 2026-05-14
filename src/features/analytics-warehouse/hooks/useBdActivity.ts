import { useQuery } from "@tanstack/react-query";
import { fact, dim } from "../api/client";
import type { DateRange } from "../api/types";

export interface BdRepActivity {
  rep_key: string;
  display_name: string;
  role: string | null;
  calls_total: number;
  calls_outbound: number;
  calls_inbound: number;
  meetings_total: number;
  meetings_upcoming: number;
  tasks_completed: number;
  tasks_open: number;
  tasks_overdue: number;
  total_touches: number;
}

export interface AccountActivity {
  account_key: string;
  account_name: string;
  calls: number;
  meetings: number;
  tasks: number;
  last_activity: string | null;
}

export interface RecentActivityRow {
  kind: "call" | "meeting";
  when: string | null;
  rep: string;
  subject: string | null;
  account_name: string | null;
  status_or_type: string | null;
}

export interface OverdueTaskRow {
  task_id: number;
  rep: string;
  subject: string | null;
  due_date: string;
  priority: string | null;
  account_name: string | null;
}

export interface BdActivityPayload {
  reps: BdRepActivity[];
  accounts: AccountActivity[];
  recent: RecentActivityRow[];
  overdue: OverdueTaskRow[];
  totals: { calls: number; meetings: number; tasksCompleted: number; tasksOpen: number; tasksOverdue: number };
}

async function fetchBdActivity(range: DateRange): Promise<BdActivityPayload> {
  const [repsRes, callRes, meetRes, taskRes, acctRes] = await Promise.all([
    dim().from("dim_rep").select("rep_key, rep_display_name, rep_role").eq("is_active", true),
    fact().from("fact_call").select("rep_key, account_key, call_type, call_start_time, subject")
      .gte("call_start_time", range.from).lte("call_start_time", `${range.to}T23:59:59`),
    fact().from("fact_zoho_meeting").select("rep_key, account_key, start_datetime, is_upcoming, event_title")
      .gte("start_datetime", range.from).lte("start_datetime", `${range.to}T23:59:59`),
    fact().from("fact_task").select("task_id, rep_key, account_key, status_group, is_overdue, due_date, priority, subject, related_name, closed_time"),
    dim().from("dim_account").select("account_key, account_name"),
  ]);

  const board: Record<string, BdRepActivity> = {};
  for (const r of repsRes.data ?? []) {
    board[r.rep_key] = {
      rep_key: r.rep_key, display_name: r.rep_display_name, role: r.rep_role,
      calls_total: 0, calls_outbound: 0, calls_inbound: 0,
      meetings_total: 0, meetings_upcoming: 0,
      tasks_completed: 0, tasks_open: 0, tasks_overdue: 0,
      total_touches: 0,
    };
  }

  for (const c of callRes.data ?? []) {
    const k = c.rep_key as string | null; if (!k || !board[k]) continue;
    board[k].calls_total += 1;
    if (c.call_type === "Outbound") board[k].calls_outbound += 1;
    if (c.call_type === "Inbound")  board[k].calls_inbound  += 1;
  }
  for (const m of meetRes.data ?? []) {
    const k = m.rep_key as string | null; if (!k || !board[k]) continue;
    board[k].meetings_total += 1;
    if (m.is_upcoming) board[k].meetings_upcoming += 1;
  }
  for (const t of taskRes.data ?? []) {
    const k = t.rep_key as string | null; if (!k || !board[k]) continue;
    if (t.status_group === "completed") board[k].tasks_completed += 1;
    else if (t.status_group === "open") board[k].tasks_open += 1;
    if (t.is_overdue) board[k].tasks_overdue += 1;
  }
  for (const k of Object.keys(board)) {
    board[k].total_touches = board[k].calls_total + board[k].meetings_total + board[k].tasks_completed;
  }
  const reps = Object.values(board)
    .filter((b) => b.total_touches > 0 || b.tasks_open > 0)
    .sort((a, b) => b.total_touches - a.total_touches);

  const accountName = new Map<string, string>();
  for (const a of acctRes.data ?? []) accountName.set(a.account_key, a.account_name);

  const accountMap: Record<string, AccountActivity> = {};
  const bumpAccount = (key: string | null, kind: "calls" | "meetings" | "tasks", when: string | null) => {
    if (!key) return;
    const name = accountName.get(key) ?? "(unknown)";
    const a = accountMap[key] ?? { account_key: key, account_name: name, calls: 0, meetings: 0, tasks: 0, last_activity: null };
    a[kind] += 1;
    if (when && (!a.last_activity || when > a.last_activity)) a.last_activity = when;
    accountMap[key] = a;
  };
  for (const c of callRes.data ?? []) bumpAccount(c.account_key as string | null, "calls",    c.call_start_time as string | null);
  for (const m of meetRes.data ?? []) bumpAccount(m.account_key as string | null, "meetings", m.start_datetime  as string | null);
  for (const t of taskRes.data ?? []) bumpAccount(t.account_key as string | null, "tasks",    t.closed_time     as string | null);

  const accounts = Object.values(accountMap)
    .sort((a, b) => (b.calls + b.meetings + b.tasks) - (a.calls + a.meetings + a.tasks))
    .slice(0, 25);

  const feed: RecentActivityRow[] = [];
  for (const c of callRes.data ?? []) feed.push({
    kind: "call",
    when: c.call_start_time as string | null,
    rep: board[c.rep_key as string]?.display_name ?? "—",
    subject: c.subject as string | null,
    account_name: c.account_key ? accountName.get(c.account_key as string) ?? null : null,
    status_or_type: c.call_type as string | null,
  });
  for (const m of meetRes.data ?? []) feed.push({
    kind: "meeting",
    when: m.start_datetime as string | null,
    rep: board[m.rep_key as string]?.display_name ?? "—",
    subject: m.event_title as string | null,
    account_name: m.account_key ? accountName.get(m.account_key as string) ?? null : null,
    status_or_type: m.is_upcoming ? "Upcoming" : "Past",
  });
  feed.sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""));

  const taskData = (taskRes.data ?? []) as Array<Record<string, unknown>>;
  const overdue: OverdueTaskRow[] = taskData
    .filter((t) => t.is_overdue as boolean)
    .map((t) => ({
      task_id: t.task_id as number,
      rep: board[t.rep_key as string]?.display_name ?? "—",
      subject: t.subject as string | null,
      due_date: t.due_date as string,
      priority: t.priority as string | null,
      account_name: t.account_key ? accountName.get(t.account_key as string) ?? null : (t.related_name as string | null),
    }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const totals = {
    calls: callRes.data?.length ?? 0,
    meetings: meetRes.data?.length ?? 0,
    tasksCompleted: taskData.filter((t) => t.status_group === "completed").length,
    tasksOpen: taskData.filter((t) => t.status_group === "open").length,
    tasksOverdue: overdue.length,
  };

  return { reps, accounts, recent: feed.slice(0, 50), overdue, totals };
}

export function useBdActivity(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "bd-activity", range.from, range.to],
    queryFn: () => fetchBdActivity(range),
    staleTime: 5 * 60_000,
  });
}
