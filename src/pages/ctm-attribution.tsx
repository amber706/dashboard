import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Loader2,
} from "lucide-react";

interface ReviewItem {
  id: number;
  ctm_call_id: string;
  field: string;
  old_value: string;
  new_value: string;
  reason: string;
  status: string;
  created_at: string;
}

export default function CTMAttribution() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<number | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/ctm-admin/attribution/review?limit=100");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const resolve = async (eventId: number, action: string) => {
    setResolving(eventId);
    try {
      const res = await apiFetch(`/ctm-admin/attribution/review/${eventId}/resolve?action=${action}`, { method: "POST" });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== eventId));
      }
    } catch {
    } finally {
      setResolving(null);
    }
  };

  const pending = items.filter(i => i.status === "pending");

  return (
    <div className="p-5 md:p-8 lg:p-10 space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Attribution Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Review conflicting CTM attribution data before it writes to Zoho</p>
        </div>
        <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={fetchQueue}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">{pending.length}</div>
          <div className="text-xs text-muted-foreground">Pending Review</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">{items.length}</div>
          <div className="text-xs text-muted-foreground">Total Items</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{items.filter(i => i.status !== "pending").length}</div>
          <div className="text-xs text-muted-foreground">Resolved</div>
        </CardContent></Card>
      </div>

      <Card>
        <ScrollArea className="h-[600px]">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <div className="text-lg font-medium">All Clear</div>
              <div className="text-sm text-muted-foreground">No attribution conflicts pending review</div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.id} className="px-4 py-4 space-y-2 hover:bg-accent/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-medium">{item.field}</span>
                      <Badge variant="outline" className="text-[10px]">Call {item.ctm_call_id}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm pl-6">
                    <Badge variant="outline" className="font-mono text-[11px]">{item.old_value || "(empty)"}</Badge>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 font-mono text-[11px]">{item.new_value}</Badge>
                  </div>

                  <div className="pl-6 text-[11px] text-muted-foreground italic">{item.reason}</div>

                  <div className="pl-6 flex gap-2 flex-wrap">
                    {item.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11 md:h-7 text-xs text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/10"
                          onClick={() => resolve(item.id, "approved")}
                          disabled={resolving === item.id}
                        >
                          {resolving === item.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11 md:h-7 text-xs text-red-400 border-red-600/30 hover:bg-red-600/10"
                          onClick={() => resolve(item.id, "rejected")}
                          disabled={resolving === item.id}
                        >
                          <XCircle className="w-3 h-3 mr-1" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-11 md:h-7 text-xs"
                          onClick={() => resolve(item.id, "dismissed")}
                          disabled={resolving === item.id}
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <Badge className={
                        item.status === "approved"
                          ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30 text-[10px]"
                          : "bg-red-600/20 text-red-400 border-red-600/30 text-[10px]"
                      }>
                        {item.status}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
