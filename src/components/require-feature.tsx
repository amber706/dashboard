// RequireFeature — wraps a route in a feature-flag gate.
//
// When the flag is OFF, render a "module disabled" card with a link
// back to /. When ON, render the children. While the flags are still
// loading we render nothing (avoids a flash of the disabled card on
// first paint).
//
// This sits one layer beneath RequireRole — typical chain looks like
//   <RequireFeature feature="module_training">
//     <RequireRole roles={["manager", "admin"]}>...</RequireRole>
//   </RequireFeature>
// — but for the common case the App.tsx route table uses a Module()
// helper that composes both.

import type { ReactNode } from "react";
import { Link } from "wouter";
import { PowerOff, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFeatureFlags, type FeatureKey } from "@/lib/feature-flags-context";

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { isEnabled, loading, flags } = useFeatureFlags();

  if (loading) return null;

  if (!isEnabled(feature)) {
    const meta = flags[feature];
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <PowerOff className="w-10 h-10 text-muted-foreground/60 mx-auto" />
            <div>
              <div className="text-base font-semibold mb-1">
                {meta?.label ?? "This module"} is currently off
              </div>
              <p className="text-sm text-muted-foreground">
                An administrator has turned this feature off. If you need access, ask an admin to
                re-enable it under Admin → Settings.
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
