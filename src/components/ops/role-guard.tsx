import { useRole } from "@/lib/role-context";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function OpsRoleGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole();

  if (role !== "manager" && role !== "admin") {
    return (
      <div className="p-8 max-w-lg mx-auto mt-20">
        <Card>
          <CardContent className="p-12 text-center">
            <ShieldAlert className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Access Restricted</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Operations views are available to managers and administrators only.
            </p>
            <Link href="/">
              <Button variant="outline" size="sm">Return to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
