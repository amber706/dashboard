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
import { RequireRole } from "@/components/require-role";

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
import ResetPasswordPage from "@/pages/reset-password";
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
import AdminUsers from "@/pages/admin/users";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Role-gating helpers. RequireRole renders an "unauthorized" screen
// (with a back-to-dashboard CTA) when the current user's role isn't in
// the allowed list. The two helpers below cover the common cases —
// any path that needs a different shape (admin-only, etc.) wraps
// inline. Defined at module scope so React doesn't re-create the
// wrapper on every render.
const Mgr = (Component: React.ComponentType) => () => (
  <RequireRole roles={["manager", "admin"]}>
    <Component />
  </RequireRole>
);
const AdminOnly = (Component: React.ComponentType) => () => (
  <RequireRole roles={["admin"]}>
    <Component />
  </RequireRole>
);

function AppRoutes() {
  return (
    <Layout>
      <ErrorBoundary>
      <Switch>
        {/* Open to every authenticated role (staff + manager + admin). */}
        <Route path="/" component={Home} />
        <Route path="/me" component={MyCoaching} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/ctm-calls" component={CTMCalls} />
        <Route path="/queue" component={QueuePage} />
        <Route path="/kb" component={KnowledgeBase} />
        <Route path="/training" component={TrainingScenarios} />
        <Route path="/training/:id" component={TrainingSession} />
        <Route path="/pre-call/:id" component={PreCall} />
        <Route path="/live/:id" component={LiveCall} />
        <Route path="/wrap-up/:id" component={WrapUp} />
        <Route path="/leads/:id" component={LeadDetail} />

        {/* Manager + admin only. RLS would already filter the data
            for staff, but the page shells expose information that
            isn't theirs to see (other reps' QA, compliance flags,
            executive boards, BD reporting, ops command center). */}
        <Route path="/legacy-home" component={Mgr(LegacyHome)} />
        <Route path="/admin" component={Mgr(Admin)} />
        <Route path="/executive" component={Mgr(ExecutiveOverview)} />
        <Route path="/analytics" component={Mgr(Analytics)} />
        <Route path="/suggestion/:id" component={Mgr(SuggestionDetail)} />
        <Route path="/ctm-agents" component={Mgr(CTMAgents)} />
        <Route path="/ctm-attribution" component={Mgr(CTMAttribution)} />
        <Route path="/knowledge-review" component={Mgr(KnowledgeReview)} />
        <Route path="/ops/overview" component={Mgr(OpsOverview)} />
        <Route path="/ops/suggestions" component={Mgr(OpsSuggestions)} />
        <Route path="/ops/workload" component={Mgr(OpsWorkload)} />
        <Route path="/ops/attribution" component={Mgr(OpsAttribution)} />
        <Route path="/ops/supervisor-review" component={Mgr(OpsSupervisorReview)} />
        <Route path="/ops/knowledge" component={Mgr(OpsKnowledge)} />
        <Route path="/ops/alerts" component={Mgr(OpsAlerts)} />
        <Route path="/ops/kb-drafts" component={Mgr(OpsKBDrafts)} />
        <Route path="/ops/scenario-review" component={Mgr(OpsScenarioReview)} />
        <Route path="/ops/training-analytics" component={Mgr(OpsTrainingAnalytics)} />
        <Route path="/ops/training-assignments" component={Mgr(OpsTrainingAssignments)} />
        <Route path="/ops/qa-review" component={Mgr(OpsQAReview)} />
        <Route path="/ops/coaching" component={Mgr(OpsCoaching)} />
        <Route path="/ops/outreach" component={Mgr(OpsOutreach)} />
        <Route path="/ops/stuck-leads" component={Mgr(OpsStuckLeads)} />
        <Route path="/ops/vob" component={Mgr(OpsVOB)} />
        <Route path="/ops/intakes" component={Mgr(OpsIntakes)} />
        <Route path="/ops/training-paths" component={Mgr(OpsTrainingPaths)} />
        <Route path="/ops/funnel" component={Mgr(OpsFunnel)} />
        <Route path="/ops/objections" component={Mgr(OpsObjections)} />
        <Route path="/ops/dispositions" component={Mgr(OpsDispositions)} />
        <Route path="/ops/specialist/:id" component={Mgr(SpecialistDeepDive)} />
        <Route path="/ops/rep-leads/:id" component={Mgr(RepLeadsDrilldown)} />
        <Route path="/ops/abandoned-calls" component={Mgr(OpsAbandonedCalls)} />
        <Route path="/ops/ai-bot-feedback" component={Mgr(OpsAIBotFeedback)} />
        <Route path="/ops/outcomes" component={Mgr(OpsOutcomes)} />
        <Route path="/ops/callbacks" component={Mgr(OpsCallbacks)} />
        <Route path="/ops/team" component={Mgr(OpsTeam)} />
        <Route path="/ops/staffing" component={Mgr(OpsStaffing)} />
        <Route path="/admin/leads" component={Mgr(AdminLeads)} />

        {/* Admin only. Health check, audit log, notification + global
            settings — these expose org-level config that managers
            shouldn't touch either. */}
        <Route path="/admin/health" component={AdminOnly(HealthPage)} />
        <Route path="/admin/audit" component={AdminOnly(AuditPage)} />
        <Route path="/admin/settings" component={AdminOnly(AdminSettings)} />
        <Route path="/admin/users" component={AdminOnly(AdminUsers)} />
        <Route path="/settings" component={AdminOnly(SettingsPage)} />

        {/* Business Development workspace — manager + admin. */}
        <Route path="/bd" component={Mgr(BdDashboard)} />
        <Route path="/bd/referrals" component={Mgr(BdReferrals)} />
        <Route path="/bd/stuck-accounts" component={Mgr(BdStuckAccounts)} />
        <Route path="/bd/account" component={Mgr(BdAccountIntelligence)} />
        <Route path="/bd/top-accounts" component={Mgr(BdTopAccounts)} />
        <Route path="/bd/meetings" component={Mgr(BdMeetings)} />

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

  // Password-recovery landing page must short-circuit BOTH the loading
  // and the authenticated-redirect branches. The recovery email link
  // creates a session via the URL hash, which makes isAuthenticated
  // true — without this check, the user would land on / instead of
  // the password-set form. The page itself uses wouter's useLocation
  // for navigation, so wrap it in a minimal Router.
  if (typeof window !== "undefined" && window.location.pathname.endsWith("/reset-password")) {
    return (
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <ResetPasswordPage />
      </WouterRouter>
    );
  }

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
