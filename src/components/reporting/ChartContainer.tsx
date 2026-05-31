/**
 * ChartContainer — the standard frame every TrendChart / BarChart /
 * MatrixTable on a reporting page sits inside. Provides the title row,
 * subtitle, optional "View records" button (drill-down) + export action,
 * and consistent padding.
 */

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  /** Optional click handler — renders a "View records" drill-down button. */
  onViewRecords?: () => void;
  /** Optional click handler — renders an export button. */
  onExport?: () => void;
  /** The chart / table itself. */
  children: ReactNode;
  className?: string;
}

export function ChartContainer({
  title,
  subtitle,
  onViewRecords,
  onExport,
  children,
  className = "",
}: ChartContainerProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onExport && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={onExport}
            >
              Export
            </Button>
          )}
          {onViewRecords && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={onViewRecords}
            >
              View records <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
