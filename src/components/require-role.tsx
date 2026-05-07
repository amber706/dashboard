// RequireRole — route-level access guard.
//
// Wrap a manager-only page in <RequireRole roles={["manager", "admin"]}>
// and a staff member who navigates directly to the URL gets a clean
// "Not authorized" screen instead of the manager UI shell with empty
// (RLS-filtered) data.
//
// This is layered on top of the existing protections, not replacing
// them:
//   - The sidebar in layout.tsx already hides manager pages from
//     staff (visual gate).
//   - The Postgres RLS policies on every PHI-bearing table already
//     filter rows to the calling user's scope (data gate).
//   - This component closes the gap: direct URL navigation no longer
//     renders the wrong UI for a role that shouldn't see it.
//
// Loading state: while the auth context is still hydrating, render a
// minimal placeholder rather than flashing the unauthorized screen.

import type { ReactNode } from "react";
import { Link } from "wouter";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useRole } from "@/lib/role-context";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type AppRole = "rep" | "manager" | "admin";

export function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { role } = useRole();
  const { isLoading } = useAuth();

  if (isLoading) {
    // Auth context still resolving — don't flash the wrong UI.
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!roles.includes(role as AppRole)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <ShieldAlert className="w-10 h-10 text-amber-500/70 mx-auto" />
            <div>
              <div className="text-base font-semibold mb-1">This page isn't available to your role</div>
              <p className="text-sm text-muted-foreground">
                Managers and administrators have access to this view. If you think you should be able to see it,
                ask an admin to update your role.
              </p>
            </div>
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to your dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
