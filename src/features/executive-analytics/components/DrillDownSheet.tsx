// DrillDownSheet — generic right-side drawer that opens when a user
// clicks a KPI, kanban column, list row, or table cell. Shows the
// underlying rows that produced the number, plus a deep-link to the
// matching Zoho record where applicable.
//
// Designed to be source-agnostic: callers pass a title, the rows, and
// the column definitions. Keeps the analytics dashboard from needing
// one custom drawer per metric.

import { ExternalLink } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

export interface DrillDownColumn<T> {
  key: keyof T | string;
  label: string;
  align?: "left" | "right";
  /** Optional cell renderer; defaults to String(row[key]). */
  render?: (row: T) => React.ReactNode;
  /** Hidden on narrow widths. */
  hideOnMobile?: boolean;
}

export interface DrillDownConfig<T = Record<string, unknown>> {
  title: string;
  /** One-line description shown under the title. */
  subtitle?: string;
  /** Total count badge — defaults to rows.length. */
  totalLabel?: string;
  rows: T[];
  columns: Array<DrillDownColumn<T>>;
  /** When provided, builds the row's "open in Zoho" link. */
  zohoLinkFor?: (row: T) => string | null;
  /** Max rows to render before showing "+N more" footer. */
  limit?: number;
  /** Optional empty-state message. */
  emptyMessage?: string;
}

interface DrillDownSheetProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DrillDownConfig<T> | null;
}

export function DrillDownSheet<T extends Record<string, any>>({
  open, onOpenChange, config,
}: DrillDownSheetProps<T>) {
  if (!config) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl" />
      </Sheet>
    );
  }
  const limit = config.limit ?? 100;
  const total = config.rows.length;
  const shown = config.rows.slice(0, limit);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base">{config.title}</SheetTitle>
            <Badge variant="outline" className="text-[10px]">
              {config.totalLabel ?? `${total} ${total === 1 ? "row" : "rows"}`}
            </Badge>
          </div>
          {config.subtitle && (
            <SheetDescription className="text-xs">{config.subtitle}</SheetDescription>
          )}
        </SheetHeader>

        {total === 0 ? (
          <div className="mt-6 text-xs text-muted-foreground italic">
            {config.emptyMessage ?? "No rows for this slice."}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  {config.columns.map((c) => (
                    <th
                      key={String(c.key)}
                      className={`py-1.5 px-2 ${
                        c.align === "right" ? "text-right" : "text-left"
                      } ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}
                    >
                      {c.label}
                    </th>
                  ))}
                  {config.zohoLinkFor && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => {
                  const link = config.zohoLinkFor?.(row) ?? null;
                  return (
                    <tr key={i} className="border-t">
                      {config.columns.map((c) => {
                        const raw = c.render ? c.render(row) : String(row[c.key as keyof T] ?? "");
                        return (
                          <td
                            key={String(c.key)}
                            className={`py-1.5 px-2 ${
                              c.align === "right" ? "text-right tabular-nums" : ""
                            } ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}
                          >
                            {raw}
                          </td>
                        );
                      })}
                      {config.zohoLinkFor && (
                        <td className="py-1.5 px-2 text-right">
                          {link && (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center text-muted-foreground hover:text-foreground"
                              aria-label="Open in Zoho"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {total > limit && (
              <div className="text-[10px] text-muted-foreground italic mt-2 px-2">
                Showing first {limit} of {total} rows.
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Build a Zoho Deal detail URL from a record id. */
export function zohoDealUrl(id: string): string {
  return `https://crm.zoho.com/crm/tab/Potentials/${id}`;
}
