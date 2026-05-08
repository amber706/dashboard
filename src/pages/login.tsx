// Login + password-recovery page.
//
// Two modes share the same surface:
//   - signin   → email + password, calls login() from auth-context
//   - recover  → email only, calls supabase.auth.resetPasswordForEmail
//                (sends a magic link to <site>/reset-password). User
//                clicks the link, sets a new password on /reset-password,
//                then logs in normally.
//
// The recovery email's redirect_to is built from window.location.origin
// so it Just Works on production AND localhost dev. The Supabase Auth
// "URL Configuration" dashboard must allow the production origin —
// already done as part of this session's setup.

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";

type Mode = "signin" | "recover";

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signin") {
        await login(username, password);
        setLocation("/");
      } else {
        // Password recovery — send a magic link.
        const redirectTo = `${window.location.origin}/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(username, { redirectTo });
        if (error) throw error;
        setRecoverySent(true);
      }
    } catch (err: any) {
      setError(err.message || (mode === "signin" ? "Login failed" : "Couldn't send recovery email"));
    } finally {
      setLoading(false);
    }
  };

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setRecoverySent(false);
    // Keep the email field populated when switching modes — common
    // case is "tried to sign in, forgot password, click forgot, the
    // email is already there".
    setPassword("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(228,20%,10%)] p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[hsl(220,70%,55%)]/12 mb-1">
            <Activity className="w-7 h-7 text-[hsl(220,70%,60%)]" />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            Admissions Copilot
          </h1>
          <p className="text-sm text-[hsl(220,10%,50%)]">
            {mode === "signin" ? "Sign in to your account" : "Recover your password"}
          </p>
        </div>

        {recoverySent ? (
          <div className="space-y-5">
            <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-4 py-4 text-sm text-emerald-400 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium">Check your email</div>
                <div className="text-emerald-400/80 text-[13px]">
                  We sent a recovery link to <span className="text-emerald-300">{username}</span>. Click it to set a new password.
                </div>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => switchMode("signin")}
              variant="outline"
              className="w-full h-11 gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-[13px] text-[hsl(220,10%,65%)]">
                  Email
                </Label>
                <Input
                  id="username"
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter email"
                  required
                  autoComplete="email"
                  className="h-11 bg-[hsl(228,18%,14%)] border-[hsl(226,16%,20%)] text-white placeholder:text-[hsl(220,10%,35%)] focus:border-[hsl(220,70%,50%)] focus:ring-[hsl(220,70%,50%)]/20 rounded-lg"
                />
              </div>
              {mode === "signin" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-[13px] text-[hsl(220,10%,65%)]">
                      Password
                    </Label>
                    <button
                      type="button"
                      onClick={() => switchMode("recover")}
                      className="text-[12px] text-[hsl(220,70%,60%)] hover:text-[hsl(220,70%,70%)] transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    autoComplete="current-password"
                    className="h-11 bg-[hsl(228,18%,14%)] border-[hsl(226,16%,20%)] text-white placeholder:text-[hsl(220,10%,35%)] focus:border-[hsl(220,70%,50%)] focus:ring-[hsl(220,70%,50%)]/20 rounded-lg"
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/8 border border-red-500/15 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-[hsl(220,70%,50%)] hover:bg-[hsl(220,70%,55%)] text-white font-medium rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {mode === "signin" ? "Signing in..." : "Sending recovery email..."}
                </>
              ) : (
                mode === "signin" ? "Sign In" : "Send recovery email"
              )}
            </Button>

            {mode === "recover" && (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="w-full text-center text-[12px] text-[hsl(220,10%,55%)] hover:text-[hsl(220,10%,75%)] transition-colors"
              >
                ← Back to sign in
              </button>
            )}
          </form>
        )}

        <p className="text-center text-[11px] text-[hsl(220,10%,30%)]">
          Cornerstone Healing Center
        </p>
      </div>
    </div>
  );
}
