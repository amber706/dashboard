import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { WorkflowProvider } from "@/lib/workflow-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RoleProvider } from "@/lib/role-context";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { ErrorBoundary } from "@/components/error-boundary";

import Home from "@/pages/home-v2";
import LegacyHome from "@/pages/home";
import LiveCall from "@/pages/live-call-v2";
import Admin from "@/pages/admin";
import PreCall from "@/pages/pre-call";
import WrapUp from "@/pages/wrap-up";
import Analytics from "@/pages/analytics";
import Onboarding from "@/pages/onboarding";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import CTMCalls from "@/pages/ctm-calls";
import CTMAgents from "@/pages/ctm-agents";
import CTMAttribution from "@/pages/ctm-attribution";
import ExecutiveOverview from "@/pages/executive-overview";
import KnowledgeReview from "@/pages/knowledge-review";
import KnowledgeBase from "@/pages/kb";
import TrainingScenarios from "@/pages/training";
import TrainingSession from "@/pages/training-session";
import SuggestionDetail from "@/pages/suggestion-detail";
import OpsOverview from "@/pages/ops/overview";
import OpsSuggestions from "@/pages/ops/suggestions";
import OpsWorkload from "@/pages/ops/workload";
import OpsAttribution from "@/pages/ops/attribution";
import OpsSupervisorReview from "@/pages/ops/supervisor-review";
import OpsKnowledge from "@/pages/ops/knowledge";
import OpsAlerts from "@/pages/ops/alerts";
import OpsKBDrafts from "@/pages/ops/kb-drafts";
import OpsScenarioReview from "@/pages/ops/scenario-review";
import OpsTrainingAnalytics from "@/pages/ops/training-analytics";
import OpsTrainingAssignments from "@/pages/ops/training-assignments";
import OpsQAReview from "@/pages/ops/qa-review";
import OpsCoaching from "@/pages/ops/coaching";
import OpsOutreach from "@/pages/ops/outreach";
import OpsStuckLeads from "@/pages/ops/stuck-leads";
import OpsVOB from "@/pages/ops/vob";
import OpsIntakes from "@/pages/ops/intakes";
import OpsTrainingPaths from "@/pages/ops/training-paths";
import QueuePage from "@/pages/queue";
import OpsFunnel from "@/pages/ops/funnel";
import OpsObjections from "@/pages/ops/objections";
import OpsDispositions from "@/pages/ops/dispositions";
import SpecialistDeepDive from "@/pages/ops/specialist/[id]";
import RepLeadsDrilldown from "@/pages/ops/rep-leads/[id]";
import AdminLeads from "@/pages/admin/leads";
import MasterTabComingSoon from "@/pages/master-tab-coming-soon";
import BdDashboard from "@/pages/bd/dashboard";
import BdAccountIntelligence from "@/pages/bd/account";
import BdMeetings from "@/pages/bd/meetings";
import BdTopAccounts from "@/pages/bd/top-accounts";
import BdReferrals from "@/pages/bd/referrals";
import BdStuckAccounts from "@/pages/bd/stuck-accounts";
import OpsAbandonedCalls from "@/pages/ops/abandoned-calls";
import OpsAIBotFeedback from "@/pages/ops/ai-bot-feedback";
import OpsOutcomes from "@/pages/ops/outcomes";
import MyCoaching from "@/pages/me";
import LeadDetail from "@/pages/leads/[id]";
import OpsCallbacks from "@/pages/ops/callbacks";
import HealthPage from "@/pages/admin/health";
import OpsTeam from "@/pages/ops/team";
import AuditPage from "@/pages/admin/audit";
import OpsStaffing from "@/pages/ops/staffing";
import AdminSettings from "@/pages/admin/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  return (
    <Layout>
      <ErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/legacy-home" component={LegacyHome} />
        <Route path="/pre-call/:id" component={PreCall} />
        <Route path="/live/:id" component={LiveCall} />
        <Route path="/wrap-up/:id" component={WrapUp} />
        <Route path="/admin" component={Admin} />
        <Route path="/executive" component={ExecutiveOverview} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/suggestion/:id" component={SuggestionDetail} />
        <Route path="/ctm-calls" component={CTMCalls} />
        <Route path="/ctm-agents" component={CTMAgents} />
        <Route path="/ctm-attribution" component={CTMAttribution} />
        <Route path="/knowledge-review" component={KnowledgeReview} />
        <Route path="/kb" component={KnowledgeBase} />
        <Route path="/training" component={TrainingScenarios} />
        <Route path="/training/:id" component={TrainingSession} />
        <Route path="/ops/overview" component={OpsOverview} />
        <Route path="/ops/suggestions" component={OpsSuggestions} />
        <Route path="/ops/workload" component={OpsWorkload} />
        <Route path="/ops/attribution" component={OpsAttribution} />
        <Route path="/ops/supervisor-review" component={OpsSupervisorReview} />
        <Route path="/ops/knowledge" component={OpsKnowledge} />
        <Route path="/ops/alerts" component={OpsAlerts} />
        <Route path="/ops/kb-drafts" component={OpsKBDrafts} />
        <Route path="/ops/scenario-review" component={OpsScenarioReview} />
        <Route path="/ops/training-analytics" component={OpsTrainingAnalytics} />
        <Route path="/ops/training-assignments" component={OpsTrainingAssignments} />
        <Route path="/ops/qa-review" component={OpsQAReview} />
        <Route path="/ops/coaching" component={OpsCoaching} />
        <Route path="/ops/outreach" component={OpsOutreach} />
        <Route path="/ops/stuck-leads" component={OpsStuckLeads} />
        <Route path="/ops/vob" component={OpsVOB} />
        <Route path="/ops/intakes" component={OpsIntakes} />
        <Route path="/ops/training-paths" component={OpsTrainingPaths} />
        <Route path="/queue" component={QueuePage} />
        <Route path="/ops/funnel" component={OpsFunnel} />
        <Route path="/ops/objections" component={OpsObjections} />
        <Route path="/ops/dispositions" component={OpsDispositions} />
        <Route path="/ops/specialist/:id" component={SpecialistDeepDive} />
        <Route path="/ops/rep-leads/:id" component={RepLeadsDrilldown} />
        <Route path="/admin/leads" component={AdminLeads} />
        <Route path="/ops/abandoned-calls" component={OpsAbandonedCalls} />
        <Route path="/ops/ai-bot-feedback" component={OpsAIBotFeedback} />
        <Route path="/ops/outcomes" component={OpsOutcomes} />
        <Route path="/me" component={MyCoaching} />
        <Route path="/leads/:id" component={LeadDetail} />
        <Route path="/ops/callbacks" component={OpsCallbacks} />
        <Route path="/admin/health" component={HealthPage} />
        <Route path="/ops/team" component={OpsTeam} />
        <Route path="/admin/audit" component={AuditPage} />
        <Route path="/ops/staffing" component={OpsStaffing} />
        <Route path="/admin/settings" component={AdminSettings} />
        {/* Business Development workspace */}
        <Route path="/bd" component={BdDashboard} />
        <Route path="/bd/referrals" component={BdReferrals} />
        <Route path="/bd/stuck-accounts" component={BdStuckAccounts} />
        <Route path="/bd/account" component={BdAccountIntelligence} />
        <Route path="/bd/top-accounts" component={BdTopAccounts} />
        <Route path="/bd/meetings" component={BdMeetings} />

        {/* Master-tab placeholder routes — modules not yet built.
            Each one lands on the same Coming Soon page which
            auto-detects which tab it's on via the URL. */}
        <Route path="/intake" component={MasterTabComingSoon} />
        <Route path="/alumni" component={MasterTabComingSoon} />
        <Route path="/marketing" component={MasterTabComingSoon} />
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    </Layout>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="animate-pulse text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <RoleProvider>
      <WorkflowProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRoutes />
          <ShortcutsOverlay />
        </WouterRouter>
        <Toaster />
      </WorkflowProvider>
    </RoleProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
