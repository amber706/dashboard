import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/section-header";
import { Hourglass } from "lucide-react";

// Shared landing for routes the user has explicitly placed on HOLD.
// Routed from both /analytics/cpa-cpl and /analytics/revenue-proxy.
export default function WarehouseHold() {
  const [location] = useLocation();
  const isCpa     = location.includes("cpa-cpl");
  const title     = isCpa ? "Cost per Admit / CPL" : "Revenue Proxy";
  const blocker   = isCpa
    ? "fact_spend ingestion from the Marketing Living Budget sheet"
    : "the app.revenue_assumptions config surface and revenue-per-admit logic";
  const unblock   = isCpa
    ? "Add MARKETING_BUDGET_SHEET_ID to admissions-copilot/.env.local, remove 'spend' from HOLD_TABS in etl/ingest.ts, uncomment the fact_spend rebuild in the same file, and rerun the ETL."
    : "Surface app.revenue_assumptions as admin-editable, then port the dashboard's revenue-proxy panel.";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title={`${title} — on HOLD`}
        subtitle="This dashboard is intentionally paused. Schema is in place; data ingestion and UI are not."
      />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hourglass className="w-5 h-5 text-amber-500" />
            What's needed to unpause
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-medium">Blocker:</span> {blocker}.
          </p>
          <p>
            <span className="font-medium">To unpause:</span> {unblock}
          </p>
          <p className="text-muted-foreground">
            Flag controlling visibility: <code>{isCpa ? "page_warehouse_cpa_cpl" : "page_warehouse_revenue_proxy"}</code>.
            Disable it in <code>/admin/settings</code> to hide this entry from the sidebar entirely.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
