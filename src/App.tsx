import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { WorkflowProvider } from "@/lib/workflow-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RoleProvider } from "@/lib/role-context";
import { FeatureFlagsProvider, type FeatureKey } from "@/lib/feature-flags-context";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { ErrorBoundary } from "@/components/error-boundary";
import { RequireRole } from "@/components/require-role";
import { RequireFeature } from "@/components/require-feature";

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
import ExecutiveAnalytics from "@/pages/executive/analytics";
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
// Module-gated routes — wraps a component in BOTH a feature-flag gate
// (so admins can turn the whole module off via /admin/settings) AND
// the role check. Use Mod() for staff-visible modules and MgrMod()
// for manager-and-up modules.
const Mod = (feature: FeatureKey, Component: React.ComponentType) => () => (
  <RequireFeature feature={feature}>
    <Component />
  </RequireFeature>
);
const MgrMod = (feature: FeatureKey, Component: React.ComponentType) => () => (
  <RequireFeature feature={feature}>
    <RequireRole roles={["manager", "admin"]}>
      <Component />
    </RequireRole>
  </RequireFeature>
);

function AppRoutes() {
  return (
    <Layout>
      <ErrorBoundary>
      <Switch>
        {/* Open to every authenticated role (staff + manager + admin). */}
        <Route path="/" component={Home} />
        <Route path="/me" component={Mod("page_my_coaching", MyCoaching)} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/ctm-calls" component={Mod("module_ctm", CTMCalls)} />
        <Route path="/queue" component={Mod("page_queue", QueuePage)} />
        <Route path="/kb" component={Mod("module_kb", KnowledgeBase)} />
        <Route path="/training" component={Mod("module_training", TrainingScenarios)} />
        <Route path="/training/:id" component={Mod("module_training", TrainingSession)} />
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
        <Route path="/executive" component={MgrMod("module_executive", ExecutiveOverview)} />
        {/* Executive Analytics Dashboard — manager+admin only, gated
            behind the page_analytics_dashboard feature flag. Inside
            the page, role lens (admissions/bd/digitalMarketing/all)
            slices the data view. */}
        <Route path="/executive/analytics" component={MgrMod("page_analytics_dashboard", ExecutiveAnalytics)} />
        <Route path="/analytics" component={MgrMod("module_executive", Analytics)} />
        <Route path="/suggestion/:id" component={Mgr(SuggestionDetail)} />
        <Route path="/ctm-agents" component={MgrMod("module_ctm", CTMAgents)} />
        <Route path="/ctm-attribution" component={MgrMod("module_ctm", CTMAttribution)} />
        <Route path="/knowledge-review" component={MgrMod("page_knowledge_review", KnowledgeReview)} />
        <Route path="/ops/overview" component={MgrMod("page_ops_overview", OpsOverview)} />
        {/* AI Suggestions — open to all roles per Amber. Specialists
            see the same list managers see; manager-only views (sign-off,
            dismiss-all) are still gated client-side inside the page. */}
        <Route path="/ops/suggestions" component={Mod("page_suggestions", OpsSuggestions)} />
        <Route path="/ops/workload" component={MgrMod("page_rep_workload", OpsWorkload)} />
        <Route path="/ops/attribution" component={MgrMod("page_attribution", OpsAttribution)} />
        <Route path="/ops/supervisor-review" component={MgrMod("page_supervisor_review", OpsSupervisorReview)} />
        <Route path="/ops/knowledge" component={Mgr(OpsKnowledge)} />
        <Route path="/ops/alerts" component={MgrMod("page_high_priority_alerts", OpsAlerts)} />
        <Route path="/ops/kb-drafts" component={MgrMod("page_kb_drafts", OpsKBDrafts)} />
        <Route path="/ops/scenario-review" component={MgrMod("module_training", OpsScenarioReview)} />
        <Route path="/ops/training-analytics" component={MgrMod("page_training_analytics", OpsTrainingAnalytics)} />
        <Route path="/ops/training-assignments" component={MgrMod("module_training", OpsTrainingAssignments)} />
        <Route path="/ops/qa-review" component={MgrMod("module_qa", OpsQAReview)} />
        <Route path="/ops/coaching" component={MgrMod("module_qa", OpsCoaching)} />
        <Route path="/ops/outreach" component={Mgr(OpsOutreach)} />
        <Route path="/ops/stuck-leads" component={Mgr(OpsStuckLeads)} />
        <Route path="/ops/vob" component={Mgr(OpsVOB)} />
        <Route path="/ops/intakes" component={Mgr(OpsIntakes)} />
        <Route path="/ops/training-paths" component={MgrMod("page_training_paths", OpsTrainingPaths)} />
        <Route path="/ops/funnel" component={MgrMod("page_funnel", OpsFunnel)} />
        <Route path="/ops/objections" component={MgrMod("page_objection_mining", OpsObjections)} />
        <Route path="/ops/dispositions" component={MgrMod("page_dispositions", OpsDispositions)} />
        <Route path="/ops/specialist/:id" component={Mgr(SpecialistDeepDive)} />
        <Route path="/ops/rep-leads/:id" component={Mgr(RepLeadsDrilldown)} />
        <Route path="/ops/abandoned-calls" component={Mgr(OpsAbandonedCalls)} />
        <Route path="/ops/ai-bot-feedback" component={MgrMod("page_ai_bot_feedback", OpsAIBotFeedback)} />
        <Route path="/ops/outcomes" component={MgrMod("page_outcomes", OpsOutcomes)} />
        <Route path="/ops/callbacks" component={Mgr(OpsCallbacks)} />
        <Route path="/ops/team" component={Mgr(OpsTeam)} />
        <Route path="/ops/staffing" component={MgrMod("page_staffing_schedule", OpsStaffing)} />
        {/* Leads — moved out of Admin gating per Amber. Lives under
            Admissions Workflow now and is open to every authenticated
            role. The page itself enforces what each role can edit. */}
        <Route path="/admin/leads" component={AdminLeads} />

        {/* Admin only. Health check, audit log, notification + global
            settings — these expose org-level config that managers
            shouldn't touch either. */}
        <Route path="/admin/health" component={AdminOnly(HealthPage)} />
        <Route path="/admin/audit" component={AdminOnly(AuditPage)} />
        <Route path="/admin/settings" component={AdminOnly(AdminSettings)} />
        <Route path="/admin/users" component={AdminOnly(AdminUsers)} />
        <Route path="/settings" component={AdminOnly(SettingsPage)} />

        {/* Business Development workspace — manager + admin. */}
        <Route path="/bd" component={MgrMod("module_bd", BdDashboard)} />
        <Route path="/bd/referrals" component={MgrMod("page_bd_referrals", BdReferrals)} />
        <Route path="/bd/stuck-accounts" component={MgrMod("page_bd_stuck_accounts", BdStuckAccounts)} />
        <Route path="/bd/account" component={MgrMod("page_bd_account_intel", BdAccountIntelligence)} />
        <Route path="/bd/top-accounts" component={MgrMod("page_bd_top_accounts", BdTopAccounts)} />
        <Route path="/bd/meetings" component={MgrMod("page_bd_meetings", BdMeetings)} />

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
      <FeatureFlagsProvider>
        <WorkflowProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
            <ShortcutsOverlay />
          </WouterRouter>
          <Toaster />
        </WorkflowProvider>
      </FeatureFlagsProvider>
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
