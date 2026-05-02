import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { getConfidenceLabel, getConfidenceColor } from "@/lib/design-tokens";
import {
  ThumbsUp, ThumbsDown, Minus, Lock, Unlock, Info,
  CheckCircle2, Shield, AlertTriangle, MessageSquare
} from "lucide-react";

interface FieldAction {
  field_name: string;
  field_value: string | null;
  confidence: number;
  source?: string;
  status: "pending" | "confirmed" | "rejected" | "locked";
  reason?: string;
}

export function FieldConfirmRow({ field, onConfirm, onReject, onLock, onUnlock, showWhy = false }: {
  field: FieldAction;
  onConfirm?: (name: string, value: string | null) => void;
  onReject?: (name: string) => void;
  onLock?: (name: string) => void;
  onUnlock?: (name: string) => void;
  showWhy?: boolean;
}) {
  const [showReason, setShowReason] = useState(false);

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
      field.status === "confirmed" ? "bg-green-50/50 border-green-200" :
      field.status === "rejected" ? "bg-red-50/50 border-red-200" :
      field.status === "locked" ? "bg-blue-50/50 border-blue-200" :
      "bg-amber-50/30 border-amber-200/50"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{field.field_name}</span>
          <ConfidenceBadge confidence={field.confidence} />
          {field.status === "locked" && <Lock className="w-3 h-3 text-blue-500" />}
        </div>
        <div className="text-sm font-medium mt-0.5">{field.field_value || <span className="text-muted-foreground">Empty</span>}</div>
        {showReason && field.reason && (
          <p className="text-xs text-muted-foreground mt-1 bg-muted/30 rounded px-2 py-1">{field.reason}</p>
        )}
      </div>

      <div className="flex items-center gap-1 ml-3 shrink-0">
        {showWhy && field.reason && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowReason(!showReason)} title="Why this was written">
            <Info className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        )}

        {field.status === "pending" && (
          <>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => onReject?.(field.field_name)} title="Reject (Esc)">
              <ThumbsDown className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => onConfirm?.(field.field_name, field.field_value)} title="Confirm (Enter)">
              <ThumbsUp className="w-3.5 h-3.5" />
            </Button>
          </>
        )}

        {field.status !== "locked" && onLock && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onLock(field.field_name)} title="Lock field">
            <Lock className="w-3 h-3 text-muted-foreground" />
          </Button>
        )}
        {field.status === "locked" && onUnlock && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onUnlock(field.field_name)} title="Unlock field">
            <Unlock className="w-3 h-3 text-blue-500" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConfidenceBadge({ confidence, showLabel = true }: { confidence: number; showLabel?: boolean }) {
  const label = getConfidenceLabel(confidence);
  const colorClass = getConfidenceColor(confidence);

  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${colorClass} border-current/20`}>
      {Math.round(confidence * 100)}%{showLabel && ` — ${label}`}
    </Badge>
  );
}

interface SuggestionFeedbackProps {
  suggestion: string;
  source?: string;
  onFeedback?: (type: "helpful" | "not-helpful" | "partial", text?: string) => void;
}

export function SuggestionFeedback({ suggestion, source, onFeedback }: SuggestionFeedbackProps) {
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const handleFeedback = (type: "helpful" | "not-helpful" | "partial") => {
    if (type === "partial") {
      setShowTextInput(true);
      return;
    }
    setFeedbackGiven(type);
    onFeedback?.(type);
  };

  const submitPartial = () => {
    setFeedbackGiven("partial");
    onFeedback?.("partial", feedbackText);
    setShowTextInput(false);
  };

  if (feedbackGiven) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="w-3 h-3 text-green-500" />
        Feedback recorded
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Was this helpful?</span>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleFeedback("helpful")} title="Helpful">
          <ThumbsUp className="w-3 h-3 text-green-600" />
        </Button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleFeedback("not-helpful")} title="Not helpful">
          <ThumbsDown className="w-3 h-3 text-red-500" />
        </Button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleFeedback("partial")} title="Partially helpful">
          <Minus className="w-3 h-3 text-amber-500" />
        </Button>
      </div>
      {showTextInput && (
        <div className="flex items-center gap-1.5">
          <Input
            placeholder="What could be better?"
            value={feedbackText}
            onChange={(e: any) => setFeedbackText(e.target.value)}
            className="h-6 text-[10px] flex-1"
          />
          <Button size="sm" className="h-6 text-[10px] px-2" onClick={submitPartial}>Send</Button>
        </div>
      )}
    </div>
  );
}

export function DuplicateWarning({ matchedPhone, matchedName, onReview }: { matchedPhone?: string; matchedName?: string; onReview?: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg" role="alert">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <div>
          <span className="text-xs font-semibold text-amber-800">Possible Duplicate</span>
          <span className="text-xs text-amber-600 ml-1.5">
            {matchedName && `"${matchedName}"`} {matchedPhone && `(${matchedPhone})`}
          </span>
        </div>
      </div>
      {onReview && (
        <Button size="sm" variant="outline" className="h-6 text-[10px] border-amber-300" onClick={onReview}>Review</Button>
      )}
    </div>
  );
}

export function SupervisorOverride({ onOverride }: { onOverride?: (reason: string) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div>
      {!showForm ? (
        <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setShowForm(true)}>
          <Shield className="w-3 h-3" />
          Supervisor Override
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Input placeholder="Override reason..." value={reason} onChange={(e: any) => setReason(e.target.value)} className="h-7 text-xs flex-1" />
          <Button size="sm" className="h-7 text-xs" onClick={() => { onOverride?.(reason); setShowForm(false); }}>Override</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
