/**
 * /reporting/executive render tests — Phase 3 acceptance gate item.
 *
 * Per the page guide: renders without crashing under each of the three
 * roles with a mocked resolver. Executive is route-gated to manager/admin
 * (MgrMod), and unlike Admissions it has NO by-rep / specialist-hidden
 * sections — every tile is team-wide — so the role assertions only cover
 * the header subtitle copy from role_copy.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

import type { UserRole } from "@/lib/auth-context";

let currentRole: UserRole = "manager";

vi.mock("@/lib/auth-context", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useAuth: () => ({
      role: currentRole,
      user: { id: "test-user", role: currentRole },
    }),
  };
});

vi.mock("@/lib/metrics/use-metric", () => ({
  useMetric: () => ({ data: undefined, isLoading: true, isFetching: true, error: null }),
}));

vi.mock("@/components/reporting/use-drilldown", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useDrilldown: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }),
  };
});

vi.mock("@/features/op-reporting/hooks/useUrlDateRange", () => ({
  useUrlDateRange: () => ({
    preset: "MTD",
    range: { from: "2026-05-01", to: "2026-05-31" },
    setPreset: () => {},
  }),
}));

vi.mock("@/features/op-reporting/hooks/useFilterUrlState", () => ({
  useFilterUrlState: (): [
    { pipelines: string[]; sources: string[]; locs: string[]; reps: string[] },
    (v: unknown) => void,
  ] => [{ pipelines: [], sources: [], locs: [], reps: [] }, () => {}],
}));

vi.mock("@/features/op-reporting/components/CacheFreshnessBadge", () => ({
  CacheFreshnessBadge: () => <span data-testid="cache-freshness">cache</span>,
}));

import ExecutivePage from "../executive";

function renderPage(role: UserRole) {
  currentRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router>
        <ExecutivePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentRole = "manager";
});

describe("ExecutivePage", () => {
  it.each(["manager", "admin", "rep"] as const)("renders without crashing as %s", (role) => {
    renderPage(role);
    expect(screen.getByText("Executive")).toBeInTheDocument();
  });

  it("manager sees 'Team performance' subtitle", () => {
    renderPage("manager");
    expect(screen.getByText("Team performance")).toBeInTheDocument();
  });

  it("admin sees 'Team performance' subtitle", () => {
    renderPage("admin");
    expect(screen.getByText("Team performance")).toBeInTheDocument();
  });

  it("renders the conversion funnel + payer mix charts under any role", () => {
    for (const role of ["manager", "admin", "rep"] as const) {
      const { unmount } = renderPage(role);
      expect(screen.getByText("Conversion Funnel")).toBeInTheDocument();
      expect(screen.getByText("Payer Mix")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders the channel-split charts", () => {
    renderPage("manager");
    expect(screen.getByText("Admits by Channel")).toBeInTheDocument();
    expect(screen.getByText("MQLs by Channel")).toBeInTheDocument();
  });

  it("renders the refer-out (Wins) section", () => {
    renderPage("manager");
    expect(screen.getByText("Refer-out Destinations")).toBeInTheDocument();
  });

  it("renders the top-line trend charts + pipeline tabs (MQLs/VOBs/Admits appear)", () => {
    renderPage("manager");
    expect(screen.getAllByText("MQLs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VOBs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Admits").length).toBeGreaterThan(0);
  });
});
