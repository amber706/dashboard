/**
 * /reporting/bd render tests — Phase 4 acceptance gate item.
 *
 * Renders without crashing under each role with a mocked resolver. BD is
 * route-gated to manager/admin (MgrMod) and has no specialist-hidden
 * sections, so role assertions cover the header subtitle copy.
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
    useAuth: () => ({ role: currentRole, user: { id: "test-user", role: currentRole } }),
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

import BdPage from "../bd";

function renderPage(role: UserRole) {
  currentRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router>
        <BdPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentRole = "manager";
});

describe("BdPage", () => {
  it.each(["manager", "admin", "rep"] as const)("renders without crashing as %s", (role) => {
    renderPage(role);
    expect(screen.getByText("Business Development")).toBeInTheDocument();
  });

  it("manager/admin see 'Team performance' subtitle", () => {
    renderPage("manager");
    expect(screen.getByText("Team performance")).toBeInTheDocument();
    renderPage("admin");
    expect(screen.getAllByText("Team performance").length).toBeGreaterThan(0);
  });

  it("renders the referral / source / refer-out / meetings sections", () => {
    renderPage("manager");
    expect(screen.getByText("Referral Inflow by Channel")).toBeInTheDocument();
    expect(screen.getByText("Admits by Source")).toBeInTheDocument();
    expect(screen.getByText("Refer-out Destinations")).toBeInTheDocument();
    expect(screen.getByText("Meetings by Type")).toBeInTheDocument();
  });

  it("renders the inflow + refer-out trend charts", () => {
    renderPage("manager");
    expect(screen.getByText("BD Referral Inflow")).toBeInTheDocument();
    expect(screen.getByText("Referred Out (Wins)")).toBeInTheDocument();
  });
});
