import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

const PAGE_SIZE = 25;

export interface ColumnDef<T = Record<string, unknown>> {
  key: string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

interface DrillDownPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fetchData: (limit: number, offset: number) => Promise<{ items: Record<string, unknown>[]; total: number }>;
  columns: ColumnDef[];
  onRowClick?: (row: Record<string, unknown>) => void;
  rowClickLabel?: string;
}

export function DrillDownPanel({
  open,
  onOpenChange,
  title,
  fetchData,
  columns,
  onRowClick,
  rowClickLabel,
}: DrillDownPanelProps) {
  const [data, setData] = useState<Record<string, unknown>[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchData(PAGE_SIZE, pageNum * PAGE_SIZE);
      setData(result.items);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    if (open) {
      setPage(0);
      load(0);
    } else {
      setData(null);
      setTotal(0);
      setPage(0);
      setError(null);
    }
  }, [open, load]);

  const goToPage = (p: number) => {
    setPage(p);
    load(p);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showPagination = total > PAGE_SIZE;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <SheetTitle className="text-base">{title}</SheetTitle>
            {!loading && data && (
              <Badge variant="secondary" className="text-xs font-normal">
                {total} {total === 1 ? "record" : "records"}
              </Badge>
            )}
          </div>
          <SheetDescription className="sr-only">
            Detailed records for {title}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4">
            {loading && (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-4 border rounded-lg space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground mb-3">{error}</p>
                <Button variant="outline" size="sm" onClick={() => load(page)}>
                  Retry
                </Button>
              </div>
            )}

            {!loading && !error && data && data.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">No records found</p>
              </div>
            )}

            {!loading && !error && data && data.length > 0 && (
              <div className="space-y-2">
                {data.map((row, idx) => (
                  <div
                    key={idx}
                    className={`p-4 border rounded-lg transition-colors ${
                      onRowClick
                        ? "cursor-pointer hover:bg-muted/50 group"
                        : ""
                    }`}
                    onClick={() => onRowClick?.(row)}
                  >
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {columns.map((col) => (
                        <div key={col.key} className={col.className}>
                          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                            {col.label}
                          </span>
                          <div className="text-sm font-medium mt-0.5">
                            {col.render
                              ? col.render(row[col.key], row)
                              : (row[col.key] as string) ?? "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                    {onRowClick && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <ExternalLink className="w-3 h-3" />
                        {rowClickLabel || "View details"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {showPagination && !loading && !error && (
          <div className="px-6 py-3 border-t flex items-center justify-between shrink-0">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => goToPage(page - 1)}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => goToPage(page + 1)}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
