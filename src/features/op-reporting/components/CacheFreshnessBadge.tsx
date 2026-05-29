// CacheFreshnessBadge — tiny "as of …" pill that pairs with PageHeader on
// every Op Reporting page. Green when within last 24h, amber when older
// (which usually means the cron didn't run); red on a hard error.

import { Clock, AlertTriangle } from "lucide-react";
import { useOpCacheFreshness } from "@/features/op-reporting/hooks/useOpCacheFreshness";

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fmtAbsolute(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function CacheFreshnessBadge() {
  const { data, isLoading, error } = useOpCacheFreshness();

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" /> Loading freshness…
      </span>
    );
  }

  if (error || !data || !data.last_built_at) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded border border-amber-500/30 text-amber-500 bg-amber-500/5">
        <AlertTriangle className="h-3 w-3" /> Cache has not run yet
      </span>
    );
  }

  const stale = Date.now() - new Date(data.last_built_at).getTime() > 26 * 60 * 60 * 1000; // > 26h since last build
  const tone = stale
    ? "border-amber-500/30 text-amber-500 bg-amber-500/5"
    : "border-[#10B981]/30 text-[#10B981] bg-[#10B981]/5";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded border ${tone}`}
      title={`Last successful build: ${fmtAbsolute(data.last_built_at)} (${data.rows_written ?? 0} rows)`}
    >
      <Clock className="h-3 w-3" />
      Cache as of {fmtAgo(data.last_built_at)}
      {stale && " · stale"}
    </span>
  );
}
