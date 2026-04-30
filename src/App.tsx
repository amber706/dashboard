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

import Home from "@/pages/home";
import LiveCall from "@/pages/live-call";
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
import OpsAbandonedCalls from "@/pages/ops/abandoned-calls";

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
      <Switch>
        <Route path="/" component={Home} />
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
        <Route path="/ops/abandoned-calls" component={OpsAbandonedCalls} />
        <Route component={NotFound} />
      </Switch>
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
