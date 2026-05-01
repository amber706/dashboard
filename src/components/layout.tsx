import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Phone, Settings, Activity, Users,
  BarChart3, BookOpen, Wrench, PhoneIncoming, PhoneOff,
  ClipboardCheck, Shield, ChevronDown, Keyboard, LogOut, Eye,
  Zap, UserCheck, ShieldAlert, HelpCircle, Gauge, Menu, X,
  Search, GraduationCap, AlertTriangle, Bot,
} from "lucide-react";
import { useWorkflow } from "@/lib/workflow-context";
import { useRole } from "@/lib/role-context";
import { useAuth } from "@/lib/auth-context";
import { StatusIndicator, type SystemState } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const modeLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  "pre-call": { label: "Pre-Call", icon: <PhoneIncoming className="w-3.5 h-3.5" />, color: "bg-blue-500" },
  "live-call": { label: "Live Call", icon: <Phone className="w-3.5 h-3.5" />, color: "bg-emerald-500" },
  "wrap-up": { label: "Wrap-Up", icon: <ClipboardCheck className="w-3.5 h-3.5" />, color: "bg-amber-500" },
  "admin": { label: "Admin", icon: <Shield className="w-3.5 h-3.5" />, color: "bg-slate-500" },
};

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { mode } = useWorkflow();
  const { role, userName, isAdmin } = useRole();
  const { logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    setDrawerOpen(false);
    setShowUserMenu(false);
  }, [location]);

  useEffect(() => {
    if (!isMobile) {
      setDrawerOpen(false);
      setShowUserMenu(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") setDrawerOpen(false);
      };
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.body.style.overflow = "";
        document.removeEventListener("keydown", handleEscape);
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [drawerOpen]);

  const modeInfo = modeLabels[mode] || modeLabels.admin;

  const navItems = [
    { href: "/", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, section: "Overview", roles: ["rep", "manager", "admin"] as const },
    { href: "/ctm-calls", label: "Live Calls", icon: <Phone className="w-4 h-4" />, section: "Workflow", roles: ["rep", "manager", "admin"] as const, pulse: true },
    { href: "/kb", label: "Knowledge Base", icon: <Search className="w-4 h-4" />, section: "Workflow", roles: ["rep", "manager", "admin"] as const },
    { href: "/training", label: "Training", icon: <GraduationCap className="w-4 h-4" />, section: "Workflow", roles: ["rep", "manager", "admin"] as const },
    { href: "/ops/overview", label: "Overview", icon: <Gauge className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/suggestions", label: "Suggestions", icon: <Zap className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/workload", label: "Rep Workload", icon: <UserCheck className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/attribution", label: "Attribution", icon: <Activity className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/qa-review", label: "QA Review", icon: <ShieldAlert className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/alerts", label: "High-Priority Alerts", icon: <AlertTriangle className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const, pulse: true },
    { href: "/ops/training-assignments", label: "Training Assignments", icon: <GraduationCap className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/abandoned-calls", label: "Abandoned Calls", icon: <PhoneOff className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/ai-bot-feedback", label: "AI Bot Feedback", icon: <Bot className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/kb-drafts", label: "KB Drafts", icon: <BookOpen className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/scenario-review", label: "Scenario Review", icon: <GraduationCap className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/training-analytics", label: "Training Analytics", icon: <BarChart3 className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/admin/leads", label: "Leads", icon: <Users className="w-4 h-4" />, section: "Management", roles: ["manager", "admin"] as const },
    { href: "/admin", label: "Admin Panel", icon: <Settings className="w-4 h-4" />, section: "Management", roles: ["manager", "admin"] as const },
    { href: "/settings", label: "Settings", icon: <Wrench className="w-4 h-4" />, section: "Management", roles: ["admin"] as const },
  ];

  const filteredItems = navItems.filter((item) => (item.roles as readonly string[]).includes(role));
  const sections = [...new Set(filteredItems.map((i) => i.section))];

  const navContent = (
    <>
      <div className="px-4 py-3 border-b border-sidebar-border/60">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-sidebar-accent/40">
          <div className={`w-2 h-2 rounded-full ${modeInfo.color} ${mode === "live-call" ? "animate-pulse" : ""}`} />
          <span className="text-xs font-medium text-sidebar-foreground/70">{modeInfo.label} Mode</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section}>
            <div className="text-[10px] font-semibold text-sidebar-foreground/35 mt-5 mb-2 px-3 uppercase tracking-[0.1em]">
              {section}
            </div>
            {filteredItems.filter((i) => i.section === section).map((item) => {
              const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href.split("/").slice(0, 2).join("/"));
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center justify-between px-3 py-2 min-h-[40px] rounded-lg text-[13px] transition-all duration-150 ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/55 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/90"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {item.icon}
                    {item.label}
                  </div>
                  {item.pulse && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border/60 space-y-2">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[44px] rounded-lg hover:bg-sidebar-accent/30 transition-all duration-150 text-left"
        >
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-semibold shrink-0 text-sidebar-accent-foreground">
            {userName ? userName.split(" ").map((n: string) => n[0]).join("").toUpperCase() : "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate">{userName}</div>
            <div className="text-[11px] text-sidebar-foreground/40 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {role === "admin" ? "Administrator" : role === "manager" ? "Manager" : "Representative"}
            </div>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-sidebar-foreground/30 transition-transform ${showUserMenu ? "rotate-180" : ""}`} />
        </button>

        {showUserMenu && (
          <div className="bg-sidebar-accent/20 rounded-lg p-1.5">
            <button
              onClick={() => { logout(); setShowUserMenu(false); setDrawerOpen(false); }}
              className="w-full text-left text-xs px-3 py-2.5 min-h-[40px] rounded-md text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        )}

        <div className="flex items-center justify-center px-2">
          <button className="text-[10px] text-sidebar-foreground/25 hover:text-sidebar-foreground/50 transition-colors flex items-center gap-1.5 min-h-[36px]" title="Press ? for shortcuts">
            <Keyboard className="w-3 h-3" />
            Press ? for shortcuts
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background w-full">
      <aside className="w-[15.5rem] bg-sidebar text-sidebar-foreground border-r border-sidebar-border/60 flex-col hidden md:flex shrink-0" role="navigation" aria-label="Main navigation">
        <div className="h-14 flex items-center px-5 font-semibold border-b border-sidebar-border/60 text-sidebar-primary-foreground tracking-tight gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-sidebar-primary/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-sidebar-primary" />
          </div>
          <span className="text-[13px] font-semibold">Admissions Copilot</span>
        </div>
        {navContent}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          />
          <aside
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground border-r border-sidebar-border/60 flex flex-col animate-in slide-in-from-left duration-300"
            role="navigation"
            aria-label="Mobile navigation"
          >
            <div className="h-14 flex items-center justify-between px-5 font-semibold border-b border-sidebar-border/60 text-sidebar-primary-foreground tracking-tight">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-sidebar-primary/20 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-sidebar-primary" />
                </div>
                <span className="text-[13px] font-semibold">Admissions Copilot</span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-sidebar-accent/30 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {navContent}
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-12 bg-background border-b border-border/60 flex items-center px-4 justify-between shrink-0 md:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-10 h-10 flex items-center justify-center -ml-2 rounded-lg hover:bg-accent/30 transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="font-semibold flex items-center gap-2 text-foreground tracking-tight text-sm">
              <Activity className="w-4 h-4 text-primary" />
              Copilot
            </div>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
            <div className={`w-2 h-2 rounded-full ${modeInfo.color} ${mode === "live-call" ? "animate-pulse" : ""}`} />
            <span className="text-xs text-muted-foreground font-medium">{modeInfo.label}</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto" role="main">
          {children}
        </div>
      </main>
    </div>
  );
}
