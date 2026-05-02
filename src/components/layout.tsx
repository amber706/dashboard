import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Phone, Settings, Activity, Users,
  BarChart3, BookOpen, Wrench, PhoneIncoming, PhoneOff,
  ClipboardCheck, Shield, ChevronDown, Keyboard, LogOut, Eye,
  Zap, UserCheck, ShieldAlert, HelpCircle, Gauge, Menu, X,
  Search, GraduationCap, AlertTriangle, Bot, Trophy, Award, Calendar, Hourglass,
} from "lucide-react";
import { useWorkflow } from "@/lib/workflow-context";
import { useRole } from "@/lib/role-context";
import { useAuth } from "@/lib/auth-context";
import { StatusIndicator, type SystemState } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { GlobalSearch } from "@/components/global-search";

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
  const [searchOpen, setSearchOpen] = useState(false);
  const isMobile = useIsMobile();

  // Cmd+K / Ctrl+K opens the global search palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    { href: "/me", label: "My Coaching", icon: <Award className="w-4 h-4" />, section: "Overview", roles: ["rep", "manager", "admin"] as const },
    { href: "/ctm-calls", label: "Live Calls", icon: <Phone className="w-4 h-4" />, section: "Workflow", roles: ["rep", "manager", "admin"] as const, pulse: true },
    { href: "/kb", label: "Knowledge Base", icon: <Search className="w-4 h-4" />, section: "Workflow", roles: ["rep", "manager", "admin"] as const },
    { href: "/training", label: "Training", icon: <GraduationCap className="w-4 h-4" />, section: "Workflow", roles: ["rep", "manager", "admin"] as const },
    { href: "/ops/overview", label: "Overview", icon: <Gauge className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/team", label: "Team", icon: <Users className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/staffing", label: "Staffing Schedule", icon: <Calendar className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/suggestions", label: "Suggestions", icon: <Zap className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/workload", label: "Rep Workload", icon: <UserCheck className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/attribution", label: "Attribution", icon: <Activity className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/qa-review", label: "QA Review", icon: <ShieldAlert className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/coaching", label: "Coaching Feed", icon: <Award className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/alerts", label: "High-Priority Alerts", icon: <AlertTriangle className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const, pulse: true },
    { href: "/ops/training-assignments", label: "Training Assignments", icon: <GraduationCap className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/callbacks", label: "Callback Queue", icon: <PhoneOff className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/outreach", label: "Outreach Gaps", icon: <PhoneIncoming className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/stuck-leads", label: "Stuck Leads", icon: <Hourglass className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/dispositions", label: "Dispositions", icon: <ClipboardCheck className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/ai-bot-feedback", label: "AI Bot Feedback", icon: <Bot className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/outcomes", label: "Outcomes", icon: <Trophy className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/kb-drafts", label: "KB Drafts", icon: <BookOpen className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/scenario-review", label: "Scenario Review", icon: <GraduationCap className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/ops/training-analytics", label: "Training Analytics", icon: <BarChart3 className="w-4 h-4" />, section: "Operations", roles: ["manager", "admin"] as const },
    { href: "/admin/leads", label: "Leads", icon: <Users className="w-4 h-4" />, section: "Management", roles: ["manager", "admin"] as const },
    { href: "/admin", label: "Admin Panel", icon: <Settings className="w-4 h-4" />, section: "Management", roles: ["manager", "admin"] as const },
    { href: "/admin/health", label: "System Health", icon: <Activity className="w-4 h-4" />, section: "Management", roles: ["admin"] as const },
    { href: "/admin/audit", label: "Audit Log", icon: <Shield className="w-4 h-4" />, section: "Management", roles: ["admin"] as const },
    { href: "/admin/settings", label: "Notification Settings", icon: <Settings className="w-4 h-4" />, section: "Management", roles: ["admin"] as const },
    { href: "/settings", label: "Settings", icon: <Wrench className="w-4 h-4" />, section: "Management", roles: ["admin"] as const },
  ];

  const filteredItems = navItems.filter((item) => (item.roles as readonly string[]).includes(role));
  const sections = [...new Set(filteredItems.map((i) => i.section))];

  const navContent = (
    <>
      <div className="px-4 py-3 space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0F2549] border border-[#11244A]">
          <div className={`w-1.5 h-1.5 rounded-full ${modeInfo.color} ${mode === "live-call" ? "animate-pulse" : ""}`} />
          <span className="eyebrow text-[#A6B5D0]">{modeInfo.label} MODE</span>
        </div>
        <button
          onClick={() => setSearchOpen(true)}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[#0F2549] border border-[#11244A] hover:border-[#1B335F] focus:border-[#5BA3D4] focus:ring-2 focus:ring-[#5BA3D4]/30 transition-colors text-left text-xs text-[#A6B5D0]"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1">Search…</span>
          <kbd className="text-[10px] font-mono bg-[#02071A]/80 px-1.5 py-0.5 rounded text-[#6E7E9E]">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section}>
            <div className="eyebrow text-[#6E7E9E] mt-5 mb-2 px-3">
              {section}
            </div>
            {filteredItems.filter((i) => i.section === section).map((item) => {
              const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href.split("/").slice(0, 2).join("/"));
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setDrawerOpen(false)}
                  className={`relative flex items-center justify-between pl-4 pr-3 py-2 min-h-[36px] rounded-lg text-[13px] transition-all duration-150 ${
                    isActive
                      ? "nav-active bg-[#0F2549] text-[#F4EFE6] font-medium"
                      : "text-[#A6B5D0] hover:bg-[#0F2549]/60 hover:text-[#F4EFE6]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {item.icon}
                    {item.label}
                  </div>
                  {item.pulse && <span className="w-1.5 h-1.5 rounded-full bg-[#E89077] animate-pulse" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-[#11244A] space-y-2">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[44px] rounded-lg hover:bg-[#0F2549]/60 transition-all duration-150 text-left"
        >
          <div className="w-8 h-8 rounded-full bg-[#0F2549] border border-[#1B335F] flex items-center justify-center text-xs font-semibold shrink-0 text-[#F4EFE6]">
            {userName ? userName.split(" ").map((n: string) => n[0]).join("").toUpperCase() : "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate text-[#F4EFE6]">{userName}</div>
            <div className="text-[11px] text-[#6E7E9E] flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              {role === "admin" ? "Administrator" : role === "manager" ? "Manager" : "Representative"}
            </div>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-[#6E7E9E] transition-transform ${showUserMenu ? "rotate-180" : ""}`} />
        </button>

        {showUserMenu && (
          <div className="bg-[#0F2549]/40 border border-[#11244A] rounded-lg p-1.5">
            <button
              onClick={() => { logout(); setShowUserMenu(false); setDrawerOpen(false); }}
              className="w-full text-left text-xs px-3 py-2.5 min-h-[40px] rounded-md text-[#E89077] hover:bg-[#E89077]/10 flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        )}

        <div className="flex items-center justify-center px-2">
          <button className="text-[10px] text-[#3D4E6E] hover:text-[#6E7E9E] transition-colors flex items-center gap-1.5 min-h-[36px]" title="Press ? for shortcuts">
            <Keyboard className="w-3 h-3" />
            Press ? for shortcuts
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
    <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    <div className="min-h-screen flex w-full">
      <aside className="w-[15.5rem] glass-sunken text-[#A6B5D0] flex-col hidden md:flex shrink-0 relative z-10" role="navigation" aria-label="Main navigation">
        <div className="px-5 pt-6 pb-3">
          <img
            src="/brand/cornerstone-wordmark.png"
            alt="Cornerstone Healing Center"
            className="w-full h-auto max-w-[200px] mx-auto block"
            style={{ mixBlendMode: "lighten" }}
          />
        </div>
        <div className="px-5 mb-3 flex items-center justify-center">
          <span className="font-display text-[13px] text-[#5BA3D4]/90 tracking-[-0.005em]">Admissions Copilot</span>
        </div>
        <div className="mx-5 chc-divider opacity-60 mb-2" />
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
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] glass-sunken text-[#A6B5D0] flex flex-col animate-in slide-in-from-left duration-300"
            role="navigation"
            aria-label="Mobile navigation"
          >
            <div className="flex items-center justify-between px-5 pt-6 pb-3 gap-3">
              <img
                src="/brand/cornerstone-wordmark.png"
                alt="Cornerstone Healing Center"
                className="h-5 w-auto"
                style={{ mixBlendMode: "lighten" }}
              />
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#0F2549]/60 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 mb-3 flex items-center">
              <span className="font-display text-[13px] text-[#5BA3D4]/90 tracking-[-0.005em]">Admissions Copilot</span>
            </div>
            <div className="mx-5 chc-divider opacity-60 mb-2" />
            {navContent}
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-12 backdrop-blur-xl border-b border-white/5 flex items-center px-4 justify-between shrink-0 md:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-10 h-10 flex items-center justify-center -ml-2 rounded-lg hover:bg-[#0F2549]/60 transition-colors text-[#A6B5D0]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <img
              src="/brand/cornerstone-wordmark.png"
              alt="Cornerstone Healing Center"
              className="h-4 w-auto"
              style={{ mixBlendMode: "lighten" }}
            />
          </div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0F2549] border border-[#11244A]">
            <div className={`w-1.5 h-1.5 rounded-full ${modeInfo.color} ${mode === "live-call" ? "animate-pulse" : ""}`} />
            <span className="eyebrow text-[#A6B5D0]">{modeInfo.label}</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto" role="main">
          {children}
        </div>
      </main>
    </div>
    </>
  );
}
