import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Zap, Loader2 } from "lucide-react";

interface SuggestionActionsProps {
  suggestionId: number;
  onAcknowledge: (id: number) => void;
  onDismiss: (id: number) => void;
  onAct: (id: number) => void;
  loading?: number | null;
}

export function SuggestionActions({ suggestionId, onAcknowledge, onDismiss, onAct, loading }: SuggestionActionsProps) {
  const isLoading = loading === suggestionId;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/10 gap-1"
        onClick={() => onAct(suggestionId)}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        Act
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs text-blue-400 border-blue-600/30 hover:bg-blue-600/10 gap-1"
        onClick={() => onAcknowledge(suggestionId)}
        disabled={isLoading}
      >
        <CheckCircle2 className="w-3 h-3" />
        Acknowledge
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-muted-foreground gap-1"
        onClick={() => onDismiss(suggestionId)}
        disabled={isLoading}
      >
        <XCircle className="w-3 h-3" />
        Dismiss
      </Button>
    </div>
  );
}

interface ReviewActionsProps {
  itemId: number;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onPreserve?: (id: number) => void;
  loading?: number | null;
  approveLabel?: string;
  rejectLabel?: string;
  preserveLabel?: string;
}

export function ReviewActions({ itemId, onApprove, onReject, onPreserve, loading, approveLabel = "Approve", rejectLabel = "Reject", preserveLabel }: ReviewActionsProps) {
  const isLoading = loading === itemId;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/10 gap-1"
        onClick={() => onApprove(itemId)}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
        {approveLabel}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs text-red-400 border-red-600/30 hover:bg-red-600/10 gap-1"
        onClick={() => onReject(itemId)}
        disabled={isLoading}
      >
        <XCircle className="w-3 h-3" />
        {rejectLabel}
      </Button>
      {onPreserve && preserveLabel && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground gap-1"
          onClick={() => onPreserve(itemId)}
          disabled={isLoading}
        >
          {preserveLabel}
        </Button>
      )}
    </div>
  );
}
