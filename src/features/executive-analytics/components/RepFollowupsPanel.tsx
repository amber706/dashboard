// RepFollowupsPanel — surfaces Claude-generated per-rep follow-up
// actions on the Rep Performance tab. Fires on-demand (manager clicks
// Generate) so Anthropic spend stays predictable.

import { useState } from "react";
import {
  Sparkles, Loader2, AlertCircle, AlertTriangle, Info,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RepFollowup } from "../api/client";

interface Props {
  byRep: Record<string, { followups: RepFollowup[] }> | null;
  generatedAt: string | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  repOrder: string[];
}

export function RepFollowupsPanel({ byRep, generatedAt, loading, error, onGenerate, repOrder }: Props) {
  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-semibold">AI Follow-ups per rep</span>
          </div>
          <div className="flex items-center gap-2">
            {generatedAt && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(generatedAt).toLocaleTimeString()}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={onGenerate}
              disabled={loading}
            >
              {loading
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing…</>
                : byRep
                  ? <><Sparkles className="w-3 h-3" /> Refresh</>
                  : <><Sparkles className="w-3 h-3" /> Generate follow-ups</>}
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {!byRep && !loading && !error && (
          <p className="text-[11px] text-muted-foreground italic">
            Click <strong>Generate follow-ups</strong> to have Claude analyze each rep's pipeline (stuck deals, stale list, loss reasons, top accounts) and produce 3-5 specific next actions per rep.
          </p>
        )}

        {loading && (
          <div className="space-y-2">
            <div className="h-20 rounded-md bg-muted/30 animate-pulse" />
            <div className="h-20 rounded-md bg-muted/30 animate-pulse" />
            <div className="h-20 rounded-md bg-muted/30 animate-pulse" />
          </div>
        )}

        {byRep && (
          <div className="space-y-2">
            {repOrder
              .filter((name) => byRep[name] && byRep[name].followups.length > 0)
              .map((name) => (
                <RepCard key={name} name={name} followups={byRep[name].followups} />
              ))}
            {repOrder.every((name) => !byRep[name] || byRep[name].followups.length === 0) && (
              <p className="text-[11px] text-muted-foreground italic">
                No follow-ups surfaced — every rep's pipeline looks clean in this window.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RepCard({ name, followups }: { name: string; followups: RepFollowup[] }) {
  const [open, setOpen] = useState(true);
  const highCount = followups.filter((f) => f.priority === "high").length;
  return (
    <div className="rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-sm font-semibold">{name}</span>
        <Badge variant="outline" className="text-[10px]">{followups.length}</Badge>
        {highCount > 0 && (
          <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">
            {highCount} high
          </Badge>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {followups.map((f, i) => (
            <FollowupRow key={i} followup={f} index={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupRow({ followup, index }: { followup: RepFollowup; index: number }) {
  const p = followup.priority;
  const palette = p === "high"
    ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
    : p === "medium"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
      : "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400";
  const Icon = p === "high" ? AlertTriangle : p === "medium" ? AlertCircle : Info;
  return (
    <div className={`rounded-md border ${palette} px-2.5 py-2`}>
      <div className="flex items-start gap-2">
        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
              #{index} · {p}
            </span>
            {followup.ref && (
              <Badge variant="outline" className="text-[9px]">
                {followup.ref}
              </Badge>
            )}
          </div>
          <div className="text-xs text-foreground/90 leading-relaxed font-medium">
            {followup.action}
          </div>
          <div className="text-[11px] text-foreground/70 leading-relaxed">
            <span className="opacity-70">Why: </span>{followup.why}
          </div>
        </div>
      </div>
    </div>
  );
}
