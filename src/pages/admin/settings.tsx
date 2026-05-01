import { useState, useCallback } from "react";
import {
  Settings as SettingsIcon, Mail, Loader2, CheckCircle2, AlertCircle,
  Send, Calendar, Database, Activity, ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type TestState = "idle" | "running" | "ok" | "skipped" | "error";

export default function AdminSettings() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" /> Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Integration and notification configuration. Test that things actually work end-to-end.
        </p>
      </div>

      <NotificationsCard />
      <DailyDigestCard />
      <IntegrationsStatusCard />

      <Card className="border-muted">
        <CardContent className="pt-4 pb-4 text-xs text-muted-foreground space-y-1">
          <div><strong className="text-foreground">Database backups:</strong> managed by Supabase. Daily on every paid tier; point-in-time recovery on Pro+. Verify retention in the Supabase dashboard → Database → Backups.</div>
          <div><strong className="text-foreground">HIPAA BAA:</strong> required with Supabase, Anthropic, OpenAI, and Resend before live PHI. Each provider has a distinct enrollment process — see their HIPAA pages.</div>
          <div><strong className="text-foreground">Audit log retention:</strong> rows in audit_log are retained indefinitely. Set up an off-platform log shipper (e.g. Vector → S3) for compliance-grade retention.</div>
          <div className="pt-2 mt-2 border-t">
            Full pre-launch checklist + setup steps for each item lives in <code className="bg-muted px-1 rounded">docs/PRODUCTION_READINESS.md</code> in the backend repo.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationsCard() {
  const [testState, setTestState] = useState<TestState>("idle");
  const [testDetail, setTestDetail] = useState<string>("");

  const fireTest = useCallback(async () => {
    setTestState("running");
    setTestDetail("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-managers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          subject: "Admissions Copilot — test notification",
          text: `This is a test notification fired from /admin/settings at ${new Date().toLocaleString()}.`,
        }),
      });
      const body = await res.json();
      if (body.skipped === "no_resend_key") {
        setTestState("skipped");
        setTestDetail("RESEND_API_KEY isn't set in Supabase secrets. Set it to activate email delivery.");
      } else if (body.skipped === "no_recipients") {
        setTestState("skipped");
        setTestDetail("No active manager/admin profiles with an email on file.");
      } else if (body.ok) {
        setTestState("ok");
        setTestDetail(`Sent to ${body.sent}/${body.recipients?.length ?? 0} manager${body.recipients?.length === 1 ? "" : "s"}: ${(body.recipients ?? []).join(", ")}`);
      } else {
        setTestState("error");
        setTestDetail(body.error || JSON.stringify(body));
      }
    } catch (e) {
      setTestState("error");
      setTestDetail(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" /> Email notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Critical alerts fire emails to every active manager/admin via Resend. Without
          <code className="text-[11px] bg-muted px-1 rounded mx-1">RESEND_API_KEY</code>
          set in Supabase secrets, every send is a no-op.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={fireTest} disabled={testState === "running"} className="gap-1.5">
            {testState === "running"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
            Send test notification
          </Button>
          {testState === "ok" && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1"><CheckCircle2 className="w-3 h-3" /> Sent</Badge>}
          {testState === "skipped" && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 gap-1"><AlertCircle className="w-3 h-3" /> Skipped</Badge>}
          {testState === "error" && <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 gap-1"><AlertCircle className="w-3 h-3" /> Error</Badge>}
        </div>
        {testDetail && (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 font-mono break-words">
            {testDetail}
          </div>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Setup instructions
          </summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <div>1. Sign up at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">resend.com <ExternalLink className="w-2.5 h-2.5" /></a> (free tier covers 3k emails/month).</div>
            <div>2. Verify a sending domain (or use the default <code>onboarding@resend.dev</code> for testing).</div>
            <div>3. Generate an API key in the Resend dashboard.</div>
            <div>4. In your terminal:
              <pre className="bg-muted/40 rounded p-2 my-1 font-mono text-[10px] overflow-x-auto">supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set NOTIFY_FROM_EMAIL="Admissions Copilot &lt;alerts@yourdomain.com&gt;"</pre>
            </div>
            <div>5. Click "Send test notification" above.</div>
            <div className="pt-2 border-t mt-2">For HIPAA: complete Resend's BAA before any PHI lands in email bodies (e.g. critical-alert excerpts).</div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function DailyDigestCard() {
  const [state, setState] = useState<TestState>("idle");
  const [detail, setDetail] = useState<string>("");
  const [previewText, setPreviewText] = useState<string>("");

  async function fire() {
    setState("running");
    setDetail("");
    setPreviewText("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-digest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: "{}",
      });
      const body = await res.json();
      if (body.skipped === "no_resend_key") {
        setState("skipped");
        setDetail("Sent to 0 (RESEND_API_KEY not set). Digest body shown below.");
      } else if (body.ok) {
        setState("ok");
        setDetail(`Sent to ${body.sent} manager${body.sent === 1 ? "" : "s"}.`);
      } else {
        setState("error");
        setDetail(body.error || JSON.stringify(body));
      }
      if (body.digest?.text) setPreviewText(body.digest.text);
    } catch (e) {
      setState("error");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4" /> Daily digest
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Morning summary of yesterday's calls / outcomes / callbacks / suggestions / bot
          feedback. Schedule via <code className="text-[11px] bg-muted px-1 rounded">/schedule</code>{" "}
          to fire at 14:00 UTC (7 AM Phoenix) daily.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={fire} disabled={state === "running"} variant="outline" className="gap-1.5">
            {state === "running"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
            Fire digest now (preview & send)
          </Button>
          {state === "ok" && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1"><CheckCircle2 className="w-3 h-3" /> Sent</Badge>}
          {state === "skipped" && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 gap-1"><AlertCircle className="w-3 h-3" /> Preview only</Badge>}
          {state === "error" && <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 gap-1"><AlertCircle className="w-3 h-3" /> Error</Badge>}
        </div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
        {previewText && (
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Preview</div>
            <pre className="text-xs bg-muted/40 rounded p-3 whitespace-pre-wrap font-sans">{previewText}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsStatusCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="w-4 h-4" /> Integration status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <IntegrationRow label="CTM webhook" desc="Inbound call ingest" healthLink="/admin/health" />
          <IntegrationRow label="Zoho CRM" desc="Lead sync (pull + writeback)" healthLink="/admin/health" />
          <IntegrationRow label="Anthropic" desc="AI scoring, classification, drafting" healthLink="/admin/health" />
          <IntegrationRow label="OpenAI" desc="KB embeddings + TTS" healthLink="/admin/health" />
          <IntegrationRow label="Supabase" desc="Database + auth + edge functions" healthLink={null} />
          <IntegrationRow label="Resend" desc="Manager notifications (optional)" healthLink={null} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 italic">
          Pipeline freshness for each integration is tracked on{" "}
          <a href="/admin/health" className="text-primary hover:underline">/admin/health</a>.
        </p>
      </CardContent>
    </Card>
  );
}

function IntegrationRow({ label, desc, healthLink }: { label: string; desc: string; healthLink: string | null }) {
  return (
    <div className="border rounded-md p-3">
      <div className="font-medium text-sm">{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      {healthLink && (
        <a href={healthLink} className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-1">
          <Activity className="w-3 h-3" /> Health
        </a>
      )}
    </div>
  );
}
