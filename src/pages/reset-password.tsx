// /reset-password — landing page for the password-recovery email link.
//
// Supabase's recovery email contains a link like:
//   https://<site>/reset-password#access_token=...&type=recovery&...
//
// The supabase-js client picks up the token from the URL hash on load
// and signs the user in with a temporary recovery session. From inside
// that session we can call updateUser({ password }) to set the new
// password, then redirect to "/".
//
// Edge cases handled:
//   - User opens the link but the token has expired or already been
//     used → show a friendly "request a new link" message with a
//     button back to /login.
//   - User lands here without any token → same as above.
//   - Password mismatch / too short → inline validation, no submit.

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

type Status = "checking" | "ready" | "no_token" | "submitting" | "done" | "error";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  // On mount: detect the recovery session that supabase-js builds from
  // the URL hash. If the user already has a session of any kind we
  // proceed; otherwise show the "request a new link" UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // supabase-js auto-parses the hash on init; give it a tick to
      // settle, then check session.
      await new Promise((r) => setTimeout(r, 50));
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) setStatus("ready");
      else setStatus("no_token");
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStatus("submitting");
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(updateErr.message);
      setStatus("error");
      return;
    }
    setStatus("done");
    // Land them on the dashboard after a moment.
    setTimeout(() => setLocation("/"), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(228,20%,10%)] p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[hsl(220,70%,55%)]/12 mb-1">
            <Activity className="w-7 h-7 text-[hsl(220,70%,60%)]" />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            Set your password
          </h1>
          <p className="text-sm text-[hsl(220,10%,50%)]">
            Choose a new password to finish signing in.
          </p>
        </div>

        {status === "checking" && (
          <div className="flex items-center justify-center text-sm text-[hsl(220,10%,55%)] gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Verifying recovery link…
          </div>
        )}

        {status === "no_token" && (
          <div className="space-y-5">
            <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-4 py-4 text-sm text-amber-400 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium">Link expired or invalid</div>
                <div className="text-amber-400/80 text-[13px]">
                  This recovery link is no longer valid. Request a new one from the login page.
                </div>
              </div>
            </div>
            <Button
              onClick={() => setLocation("/login")}
              variant="outline"
              className="w-full h-11 gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> Back to login
            </Button>
          </div>
        )}

        {status === "done" && (
          <div className="space-y-5">
            <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-4 py-4 text-sm text-emerald-400 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium">Password updated</div>
                <div className="text-emerald-400/80 text-[13px]">
                  Signing you in…
                </div>
              </div>
            </div>
          </div>
        )}

        {(status === "ready" || status === "submitting" || status === "error") && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-[13px] text-[hsl(220,10%,65%)]">
                  New password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                  className="h-11 bg-[hsl(228,18%,14%)] border-[hsl(226,16%,20%)] text-white placeholder:text-[hsl(220,10%,35%)] focus:border-[hsl(220,70%,50%)] focus:ring-[hsl(220,70%,50%)]/20 rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-[13px] text-[hsl(220,10%,65%)]">
                  Confirm password
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter the password"
                  required
                  autoComplete="new-password"
                  className="h-11 bg-[hsl(228,18%,14%)] border-[hsl(226,16%,20%)] text-white placeholder:text-[hsl(220,10%,35%)] focus:border-[hsl(220,70%,50%)] focus:ring-[hsl(220,70%,50%)]/20 rounded-lg"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/8 border border-red-500/15 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={status === "submitting"}
              className="w-full h-11 bg-[hsl(220,70%,50%)] hover:bg-[hsl(220,70%,55%)] text-white font-medium rounded-lg transition-colors"
            >
              {status === "submitting" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Set password and sign in"
              )}
            </Button>
          </form>
        )}

        <p className="text-center text-[11px] text-[hsl(220,10%,30%)]">
          Cornerstone Healing Center
        </p>
      </div>
    </div>
  );
}
