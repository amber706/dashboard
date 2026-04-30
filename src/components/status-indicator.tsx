import { Badge } from "@/components/ui/badge";
import {
  Loader2, Mic, Clock, CloudUpload, CheckCircle2, AlertTriangle, WifiOff,
  RotateCcw, PhoneOff, ClipboardCheck, ShieldAlert, Pause
} from "lucide-react";

export type SystemState =
  | "listening"
  | "transcript-delayed"
  | "syncing"
  | "awaiting-confirmation"
  | "kb-unavailable"
  | "degraded"
  | "retrying-write"
  | "call-ended"
  | "wrap-up-ready"
  | "connected"
  | "paused"
  | "escalation";

const stateConfig: Record<SystemState, { icon: React.ReactNode; label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  listening: { icon: <Mic className="w-3 h-3" />, label: "Listening", variant: "outline", className: "border-green-300 text-green-700 bg-green-50" },
  "transcript-delayed": { icon: <Clock className="w-3 h-3" />, label: "Transcript Delayed", variant: "outline", className: "border-amber-300 text-amber-700 bg-amber-50" },
  syncing: { icon: <CloudUpload className="w-3 h-3 animate-pulse" />, label: "Syncing to Zoho", variant: "outline", className: "border-blue-300 text-blue-700 bg-blue-50" },
  "awaiting-confirmation": { icon: <Pause className="w-3 h-3" />, label: "Awaiting Confirmation", variant: "outline", className: "border-amber-300 text-amber-700 bg-amber-50" },
  "kb-unavailable": { icon: <WifiOff className="w-3 h-3" />, label: "KB Unavailable", variant: "outline", className: "border-red-300 text-red-700 bg-red-50" },
  degraded: { icon: <AlertTriangle className="w-3 h-3" />, label: "Degraded Mode", variant: "destructive" },
  "retrying-write": { icon: <RotateCcw className="w-3 h-3 animate-spin" />, label: "Retrying Write", variant: "outline", className: "border-orange-300 text-orange-700 bg-orange-50" },
  "call-ended": { icon: <PhoneOff className="w-3 h-3" />, label: "Call Ended", variant: "secondary" },
  "wrap-up-ready": { icon: <ClipboardCheck className="w-3 h-3" />, label: "Wrap-up Ready", variant: "outline", className: "border-green-300 text-green-700 bg-green-50" },
  connected: { icon: <CheckCircle2 className="w-3 h-3" />, label: "Connected", variant: "outline", className: "border-green-300 text-green-700 bg-green-50" },
  paused: { icon: <Pause className="w-3 h-3" />, label: "Paused", variant: "secondary" },
  escalation: { icon: <ShieldAlert className="w-3 h-3" />, label: "Escalation", variant: "destructive" },
};

export function StatusIndicator({ state, size = "sm" }: { state: SystemState; size?: "sm" | "md" }) {
  const config = stateConfig[state];
  if (!config) return null;

  return (
    <Badge variant={config.variant} className={`${config.className || ""} ${size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1"} gap-1.5 font-medium`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function DegradedBanner({ message }: { message?: string }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3" role="alert">
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
      <div>
        <span className="text-sm font-medium text-amber-800">Degraded Mode Active</span>
        <span className="text-xs text-amber-600 ml-2">
          {message || "Some features may be limited. The system will continue operating with reduced functionality."}
        </span>
      </div>
    </div>
  );
}

export function EscalationBanner({ reason, onAcknowledge }: { reason?: string; onAcknowledge?: () => void }) {
  return (
    <div className="bg-red-600 text-white px-6 py-3 flex items-center justify-between" role="alert">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-5 h-5 shrink-0" />
        <div>
          <div className="font-semibold text-sm">Escalation Required</div>
          <div className="text-xs opacity-90">{reason || "This call requires supervisor attention."}</div>
        </div>
      </div>
      {onAcknowledge && (
        <button
          onClick={onAcknowledge}
          className="px-3 py-1.5 text-xs font-medium bg-white/15 border border-white/25 rounded-md hover:bg-white/25 transition-colors"
        >
          Acknowledge
        </button>
      )}
    </div>
  );
}

export function SyncStatusRow({ label, status }: { label: string; status: "synced" | "pending" | "failed" | "idle" }) {
  const icons = {
    synced: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
    pending: <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />,
    failed: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
    idle: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
  };
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {icons[status]}
        <span className="text-xs font-medium capitalize">{status}</span>
      </div>
    </div>
  );
}
