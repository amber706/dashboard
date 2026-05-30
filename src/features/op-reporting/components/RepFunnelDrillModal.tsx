// RepFunnelDrillModal — opens when a user clicks a number cell in the
// "Funnel by specialist" table on /analytics/op-rep-activity. Shows the
// deal-level rows that contribute to that (rep, metric, window) count,
// each clickable through to Zoho CRM for verification.

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import {
  useOpRepFunnelDrill,
  zohoDealUrl,
  type DrillMetric,
} from "@/features/op-reporting/hooks/useOpRepFunnelDrill";

const METRIC_LABEL: Record<DrillMetric, string> = {
  mqls: "MQLs",
  vobs: "VOBs",
  admits: "Admits",
  closed_lost: "Closed Lost",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName: string | null;
  metric: DrillMetric | null;
  range: DateRange;
}

export function RepFunnelDrillModal({ open, onOpenChange, userId, userName, metric, range }: Props) {
  const { data, isLoading, error } = useOpRepFunnelDrill({ userId, metric, range });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {userName ?? "Specialist"} — {metric ? METRIC_LABEL[metric] : ""}
          </DialogTitle>
          <DialogDescription>
            {range.from} → {range.to} · click any deal to open in Zoho CRM
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <div className="text-sm text-red-600 py-4">
              Could not load — {(error as Error).message}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No deals match this cell.
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4">Deal</th>
                  <th className="py-2 pr-4">Stage</th>
                  {data.some((r) => r.event_label != null) && (
                    <th className="py-2 pr-4">Event</th>
                  )}
                  <th className="py-2 pr-0 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={`${r.source_deal_id}-${r.event_label ?? ""}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <a
                        href={zohoDealUrl(r.source_deal_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#5BA3D4] hover:underline"
                      >
                        {r.deal_name}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.stage_raw}</td>
                    {data.some((row) => row.event_label != null) && (
                      <td className="py-2 pr-4">
                        {r.event_label && (
                          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                            r.event_label === "Screening sold"
                              ? "bg-[#5BA3D4]/10 text-[#5BA3D4] border-[#5BA3D4]/30"
                              : r.event_label === "Course sold"
                              ? "bg-[#8A78D4]/10 text-[#8A78D4] border-[#8A78D4]/30"
                              : "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30"
                          }`}>
                            {r.event_label}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 pr-0 text-right tabular-nums text-muted-foreground">
                      {r.date_key ?? "—"}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2 pr-4">Total events</td>
                  <td className="py-2 pr-4"></td>
                  {data.some((r) => r.event_label != null) && <td className="py-2 pr-4"></td>}
                  <td className="py-2 pr-0 text-right tabular-nums">{data.length}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
