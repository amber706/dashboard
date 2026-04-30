import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      setLocation("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

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
            Sign in to your account
          </p>
        </div>

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
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[13px] text-[hsl(220,10%,65%)]">
                Password
              </Label>
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
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        <p className="text-center text-[11px] text-[hsl(220,10%,30%)]">
          Cornerstone Healing Center
        </p>
      </div>
    </div>
  );
}
