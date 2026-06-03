import { lazy, Suspense } from "react";
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

// Eagerly imported — first-paint home, the pre-auth screens (rendered by
// AuthGate before the lazy route tree mounts), and the lightweight specialist
// workflow pages on the hot path (pre-call → live → wrap-up → lead). None of
// these pull `recharts`, so keeping them in the entry chunk stays cheap.
import Home from "@/pages/home-v2";
import LiveCall from "@/pages/live-call-v2";
import PreCall from "@/pages/pre-call";
import WrapUp from "@/pages/wrap-up";
import Onboarding from "@/pages/onboarding";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import LeadDetail from "@/pages/leads/[id]";
import AdminLeads from "@/pages/admin/leads";
import MasterTabComingSoon from "@/pages/master-tab-coming-soon";

// Everything below is route-level code-split via React.lazy so each page (and
// its deps — `recharts` is the heaviest) ships in its own chunk, loaded on
// demand. The gating helpers (Mgr/Mod/MgrMod/AdminOnly) render these inside a
// single <Suspense> in AppRoutes. Keep this list lazy: the analytics /
// reporting / bd dashboards are large and the entry bundle should not carry
// them. See the perf budget in the Phase 2 brief (<2s FMP).
const LegacyHome = lazy(() => import("@/pages/home"));
const Admin = lazy(() => import("@/pages/admin"));
const Analytics = lazy(() => import("@/pages/analytics"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const CTMCalls = lazy(() => import("@/pages/ctm-calls"));
const CTMAgents = lazy(() => import("@/pages/ctm-agents"));
const CTMAttribution = lazy(() => import("@/pages/ctm-attribution"));
const ExecutiveOverview = lazy(() => import("@/pages/executive-overview"));
const ExecutiveAnalytics = lazy(() => import("@/pages/executive/analytics"));
const KnowledgeReview = lazy(() => import("@/pages/knowledge-review"));
const KnowledgeBase = lazy(() => import("@/pages/kb"));
const TrainingScenarios = lazy(() => import("@/pages/training"));
const TrainingSession = lazy(() => import("@/pages/training-session"));
const SuggestionDetail = lazy(() => import("@/pages/suggestion-detail"));
const OpsOverview = lazy(() => import("@/pages/ops/overview"));
const OpsSuggestions = lazy(() => import("@/pages/ops/suggestions"));
const OpsWorkload = lazy(() => import("@/pages/ops/workload"));
const OpsAttribution = lazy(() => import("@/pages/ops/attribution"));
const OpsSupervisorReview = lazy(() => import("@/pages/ops/supervisor-review"));
const OpsKnowledge = lazy(() => import("@/pages/ops/knowledge"));
const OpsAlerts = lazy(() => import("@/pages/ops/alerts"));
const OpsKBDrafts = lazy(() => import("@/pages/ops/kb-drafts"));
const OpsScenarioReview = lazy(() => import("@/pages/ops/scenario-review"));
const OpsTrainingAnalytics = lazy(() => import("@/pages/ops/training-analytics"));
const OpsTrainingAssignments = lazy(() => import("@/pages/ops/training-assignments"));
const OpsQAReview = lazy(() => import("@/pages/ops/qa-review"));
const OpsCoaching = lazy(() => import("@/pages/ops/coaching"));
const OpsOutreach = lazy(() => import("@/pages/ops/outreach"));
const OpsStuckLeads = lazy(() => import("@/pages/ops/stuck-leads"));
const OpsVOB = lazy(() => import("@/pages/ops/vob"));
const OpsIntakes = lazy(() => import("@/pages/ops/intakes"));
const OpsTrainingPaths = lazy(() => import("@/pages/ops/training-paths"));
const QueuePage = lazy(() => import("@/pages/queue"));
const OpsFunnel = lazy(() => import("@/pages/ops/funnel"));
const OpsObjections = lazy(() => import("@/pages/ops/objections"));
const OpsDispositions = lazy(() => import("@/pages/ops/dispositions"));
const SpecialistDeepDive = lazy(() => import("@/pages/ops/specialist/[id]"));
const RepLeadsDrilldown = lazy(() => import("@/pages/ops/rep-leads/[id]"));
const BdDashboard = lazy(() => import("@/pages/bd/dashboard"));
const BdAccountIntelligence = lazy(() => import("@/pages/bd/account"));
const BdMeetings = lazy(() => import("@/pages/bd/meetings"));
const BdTopAccounts = lazy(() => import("@/pages/bd/top-accounts"));
const BdAccountTrends = lazy(() => import("@/pages/bd/account-trends"));
const BdStrategy = lazy(() => import("@/pages/bd/strategy"));
const BdReferOutStrategy = lazy(() => import("@/pages/bd/refer-out-strategy"));
const AllVobs = lazy(() => import("@/pages/vobs"));
const BdReferrals = lazy(() => import("@/pages/bd/referrals"));
const BdStuckAccounts = lazy(() => import("@/pages/bd/stuck-accounts"));
const OpsAbandonedCalls = lazy(() => import("@/pages/ops/abandoned-calls"));
const OpsAIBotFeedback = lazy(() => import("@/pages/ops/ai-bot-feedback"));
const OpsOutcomes = lazy(() => import("@/pages/ops/outcomes"));
const MyCoaching = lazy(() => import("@/pages/me"));
const OpsCallbacks = lazy(() => import("@/pages/ops/callbacks"));
const HealthPage = lazy(() => import("@/pages/admin/health"));
const OpsTeam = lazy(() => import("@/pages/ops/team"));
const AuditPage = lazy(() => import("@/pages/admin/audit"));
const OpsStaffing = lazy(() => import("@/pages/ops/staffing"));
const AdminSettings = lazy(() => import("@/pages/admin/settings"));
const AdminUsers = lazy(() => import("@/pages/admin/users"));

// Warehouse-backed analytics dashboards ported from cornerstone-dashboard.
// Each page reads from fact_*/dim_* tables in Supabase (populated by the
// ETL in admissions-copilot/etl/).
const WarehouseExecutive = lazy(() => import("@/pages/analytics/executive"));
const WarehouseFunnel = lazy(() => import("@/pages/analytics/funnel"));
const OpFunnel = lazy(() => import("@/pages/analytics/op-funnel"));
const OpRepActivity = lazy(() => import("@/pages/analytics/op-rep-activity"));
const OpReferrals = lazy(() => import("@/pages/analytics/op-referrals"));
const OpOverview = lazy(() => import("@/pages/analytics/op-overview"));
const OpPayerMix = lazy(() => import("@/pages/analytics/op-payer-mix"));
const OpDataQuality = lazy(() => import("@/pages/analytics/op-data-quality"));
const OpSalesCycle = lazy(() => import("@/pages/analytics/op-sales-cycle"));

// Phase 2 reporting pages — substrate via /src/lib/metrics + /src/components/reporting.
const AdmissionsReportingPage = lazy(() => import("@/pages/reporting/admissions"));
const ExecutiveReportingPage = lazy(() => import("@/pages/reporting/executive"));
const WarehouseRepMetrics = lazy(() => import("@/pages/analytics/rep-metrics"));
const WarehouseChannel = lazy(() => import("@/pages/analytics/channel"));
const AnalyticsChartView = lazy(() => import("@/pages/analytics/chart-view"));
const WarehousePayer = lazy(() => import("@/pages/analytics/payer"));
const WarehouseTeam = lazy(() => import("@/pages/analytics/team"));
const WarehouseCensus = lazy(() => import("@/pages/analytics/census"));
const WarehouseBdActivity = lazy(() => import("@/pages/analytics/bd-activity"));
const WarehouseHold = lazy(() => import("@/pages/analytics/hold"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Page components reach these helpers either eagerly imported or wrapped in
// React.lazy(); both are valid JSX element types, so the gating helpers accept
// either. (LazyExoticComponent isn't assignable to React.ComponentType, hence
// the union.)
type PageComponent =
  | React.ComponentType
  | React.LazyExoticComponent<React.ComponentType<any>>;

// Role-gating helpers. RequireRole renders an "unauthorized" screen
// (with a back-to-dashboard CTA) when the current user's role isn't in
// the allowed list. The two helpers below cover the common cases —
// any path that needs a different shape (admin-only, etc.) wraps
// inline. Defined at module scope so React doesn't re-create the
// wrapper on every render.
const Mgr = (Component: PageComponent) => () => (
  <RequireRole roles={["manager", "admin"]}>
    <Component />
  </RequireRole>
);
const AdminOnly = (Component: PageComponent) => () => (
  <RequireRole roles={["admin"]}>
    <Component />
  </RequireRole>
);
// Module-gated routes — wraps a component in BOTH a feature-flag gate
// (so admins can turn the whole module off via /admin/settings) AND
// the role check. Use Mod() for staff-visible modules and MgrMod()
// for manager-and-up modules.
const Mod = (feature: FeatureKey, Component: PageComponent) => () => (
  <RequireFeature feature={feature}>
    <Component />
  </RequireFeature>
);
const MgrMod = (feature: FeatureKey, Component: PageComponent) => () => (
  <RequireFeature feature={feature}>
    <RequireRole roles={["manager", "admin"]}>
      <Component />
    </RequireRole>
  </RequireFeature>
);

// Shown while a lazily-loaded route chunk is in flight. Mirrors the AuthGate
// loading shell, but sized for the content area — it renders inside <Layout>,
// which already paints the sidebar/header chrome.
function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="animate-pulse text-slate-400 text-sm">Loading…</div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Layout>
      <ErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
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
        <Route path="/vobs" component={Mod("page_all_vobs", AllVobs)} />

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

        {/* Warehouse-backed analytics — ported from cornerstone-dashboard.
            Reads from fact_ and dim_ tables populated by the ETL. Each
            sub-page is independently flag-gated; module_analytics_warehouse
            cascades visibility across them all. */}
        <Route path="/analytics/executive"     component={MgrMod("page_warehouse_executive",   WarehouseExecutive)} />
        <Route path="/analytics/funnel"        component={MgrMod("page_warehouse_funnel",      WarehouseFunnel)} />
        <Route path="/analytics/op-funnel"        component={MgrMod("page_warehouse_funnel",      OpFunnel)} />
        <Route path="/analytics/op-rep-activity"  component={MgrMod("page_warehouse_rep_metrics", OpRepActivity)} />
        <Route path="/analytics/op-overview"      component={MgrMod("page_warehouse_executive",   OpOverview)} />
        <Route path="/analytics/op-referrals"     component={MgrMod("page_warehouse_bd_activity", OpReferrals)} />

        {/* Phase 2 reporting pages — visible to all roles; RLS handles scope. */}
        <Route path="/reporting/admissions"       component={Mod("page_reporting_admissions",     AdmissionsReportingPage)} />
        <Route path="/reporting/executive"        component={MgrMod("page_reporting_executive",   ExecutiveReportingPage)} />
        <Route path="/analytics/op-payer-mix"     component={MgrMod("page_warehouse_payer",       OpPayerMix)} />
        <Route path="/analytics/op-data-quality"  component={MgrMod("page_warehouse_executive",   OpDataQuality)} />
        <Route path="/analytics/op-sales-cycle"   component={MgrMod("page_warehouse_executive",   OpSalesCycle)} />
        <Route path="/analytics/rep-metrics"   component={MgrMod("page_warehouse_rep_metrics", WarehouseRepMetrics)} />
        <Route path="/analytics/channel"       component={MgrMod("page_warehouse_channel",     WarehouseChannel)} />
        <Route path="/analytics/chart-view"    component={MgrMod("page_warehouse_chart_view",  AnalyticsChartView)} />
        <Route path="/analytics/payer"         component={MgrMod("page_warehouse_payer",       WarehousePayer)} />
        <Route path="/analytics/team"          component={MgrMod("page_warehouse_team",        WarehouseTeam)} />
        <Route path="/analytics/census"        component={MgrMod("page_warehouse_census",      WarehouseCensus)} />
        <Route path="/analytics/bd-activity"   component={MgrMod("page_warehouse_bd_activity", WarehouseBdActivity)} />
        {/* HOLD — same component renders a coming-soon explainer that
            says why this view is paused and what's needed to unpause. */}
        <Route path="/analytics/cpa-cpl"       component={MgrMod("page_warehouse_cpa_cpl",       WarehouseHold)} />
        <Route path="/analytics/revenue-proxy" component={MgrMod("page_warehouse_revenue_proxy", WarehouseHold)} />
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
        <Route path="/bd/account-trends" component={MgrMod("page_bd_account_trends", BdAccountTrends)} />
        <Route path="/bd/strategy" component={MgrMod("page_bd_strategy", BdStrategy)} />
        <Route path="/bd/refer-out-strategy" component={MgrMod("page_bd_refer_out", BdReferOutStrategy)} />
        <Route path="/bd/meetings" component={MgrMod("page_bd_meetings", BdMeetings)} />

        {/* Master-tab placeholder routes — modules not yet built.
            Each one lands on the same Coming Soon page which
            auto-detects which tab it's on via the URL. */}
        <Route path="/intake" component={MasterTabComingSoon} />
        <Route path="/alumni" component={MasterTabComingSoon} />
        <Route path="/marketing" component={MasterTabComingSoon} />
        <Route component={NotFound} />
      </Switch>
      </Suspense>
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
