import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/section-header";
import { Construction } from "lucide-react";

// Shared shell for dashboards whose UI hasn't been ported yet. Each
// route component below is a thin wrapper that supplies the title and
// the fact tables it will eventually read from. Replace with the real
// page when porting that dashboard.
interface StubProps {
  title: string;
  blurb: string;
  sources: string[];
  feature: string;
}

export function WarehouseStub({ title, blurb, sources, feature }: StubProps) {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader title={title} subtitle={blurb} />
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="w-5 h-5 text-amber-500" />
            Port in progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Schema is in place and ETL populates the underlying tables;
            this view's UI is the next thing to land.
          </p>
          <p className="text-muted-foreground">
            Reads from: {sources.map((s) => <code key={s} className="mx-1">{s}</code>)}
          </p>
          <p className="text-muted-foreground">
            Feature flag: <code>{feature}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
