import { Badge } from "@/components/ui/badge";

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400 border-red-600/30",
  high: "bg-orange-600/20 text-orange-400 border-orange-600/30",
  medium: "bg-amber-600/20 text-amber-400 border-amber-600/30",
  low: "bg-slate-600/20 text-slate-400 border-slate-600/30",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge className={`${PRIORITY_STYLES[priority] || PRIORITY_STYLES.low} text-[10px] font-medium`}>
      {priority}
    </Badge>
  );
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  acknowledged: "bg-cyan-600/20 text-cyan-400 border-cyan-600/30",
  acted: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
  dismissed: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  expired: "bg-zinc-600/20 text-zinc-400 border-zinc-600/30",
  pending: "bg-amber-600/20 text-amber-400 border-amber-600/30",
  approved: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
  rejected: "bg-red-600/20 text-red-400 border-red-600/30",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${STATUS_STYLES[status] || STATUS_STYLES.pending} text-[10px] font-medium`}>
      {status}
    </Badge>
  );
}
