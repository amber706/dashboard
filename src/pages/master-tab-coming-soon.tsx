// Placeholder landing for master tabs that haven't been built yet.
// Renders a friendly "coming soon" with the tab name + a hint about
// what will live there when we build it.

import { useLocation, Link } from "wouter";
import { Construction, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";
import { getActiveMasterTab } from "@/lib/master-tabs";

const TAB_DESCRIPTIONS: Record<string, { title: string; whatGoesHere: string }> = {
  business_development: {
    title: "Business Development",
    whatGoesHere: "Partner referrals pipeline, BD outreach activity, partner-source attribution, and outreach effectiveness analytics. Built next after Admissions.",
  },
  intake: {
    title: "Intake",
    whatGoesHere: "Pre-screen scheduling, intake assessments, no-show tracking, and the handoff between admissions and clinical. Surfaces what intake's working on so admissions can see who's actually showing up.",
  },
  alumni: {
    title: "Alumni",
    whatGoesHere: "Re-admit pipeline, alumni outreach, post-discharge engagement, and re-admit conversion tracking. Closes the loop on long-term outcomes.",
  },
  digital_marketing: {
    title: "Digital Marketing",
    whatGoesHere: "Source-level conversion (SEO, PPC, ZocDoc, BD, Paid Social, etc.), CTM call tracking, ROI by channel, and creative/landing-page performance.",
  },
};

export default function MasterTabComingSoon() {
  const [location] = useLocation();
  const tab = getActiveMasterTab(location);
  const meta = TAB_DESCRIPTIONS[tab.key] ?? {
    title: tab.label,
    whatGoesHere: "Module under construction.",
  };

  return (
    <PageShell
      eyebrow="COMING SOON"
      title={meta.title}
      subtitle="Not built yet — Admissions is the only fully-shipped module today. This tab is a placeholder."
    >
      <Card className="border-dashed">
        <CardContent className="pt-10 pb-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center mx-auto">
            <Construction className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-2 max-w-xl mx-auto">
            <p className="text-sm text-foreground">{meta.whatGoesHere}</p>
            <p className="text-xs text-muted-foreground">
              Admissions is fully built — switch back if you need the day-to-day operational tooling.
            </p>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Admissions
            </Button>
          </Link>
        </CardContent>
      </Card>
    </PageShell>
  );
}
