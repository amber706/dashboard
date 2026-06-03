/**
 * EmptyState — uniform "no rows match the filters" placeholder for every
 * reporting component. Title + body + optional hint about expanding the
 * time filter (the most common cause).
 */

import { Inbox } from "lucide-react";

interface EmptyStateProps {
  /** Short title like "No admits in this date range." */
  title: string;
  /** Optional hint — e.g. "Try expanding the time filter." */
  hint?: string;
  className?: string;
}

export function EmptyState({ title, hint, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-8 px-4 text-sm text-muted-foreground ${className}`}
    >
      <Inbox className="w-6 h-6 mb-2 text-muted-foreground/60" aria-hidden="true" />
      <div className="font-medium">{title}</div>
      {hint && <div className="text-xs text-muted-foreground/80 mt-1">{hint}</div>}
    </div>
  );
}
