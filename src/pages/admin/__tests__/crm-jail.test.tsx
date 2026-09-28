import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RosterRep } from "@/lib/crm-jail-roster";

const mutate = vi.fn();

const REPS: RosterRep[] = [
  { id: "1", zoho_user_id: "z1", full_name: "Kenny Reitz", email: "kennyr@x.com",
    team: "bd", auditor_email: "aaron@x.com", active: true, notes: null },
  { id: "2", zoho_user_id: "z2", full_name: "Eric Wade", email: "ericw@x.com",
    team: "admissions", auditor_email: "megan@x.com", active: true, notes: null },
  { id: "3", zoho_user_id: "z3", full_name: "Robert Dallessandro", email: "robertd@x.com",
    team: "admissions", auditor_email: "megan@x.com", active: false,
    notes: 'discovered via Zoho profile "TREATMENT Standard" — confirm before activating' },
];

vi.mock("@/lib/crm-jail-roster", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm-jail-roster")>();
  return {
    ...actual,
    useRoster: () => ({ data: REPS, isLoading: false, error: null }),
    useSetRepActive: () => ({ mutate }),
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import CrmJailRoster from "@/pages/admin/crm-jail";

describe("CRM Jail roster admin", () => {
  it("lists reps under their team", () => {
    render(<CrmJailRoster />);
    expect(screen.getByText("Kenny Reitz")).toBeInTheDocument();
    expect(screen.getByText("Eric Wade")).toBeInTheDocument();
    expect(screen.getByText("Business Development")).toBeInTheDocument();
    expect(screen.getByText("Admissions")).toBeInTheDocument();
  });

  it("shows who audits each rep", () => {
    render(<CrmJailRoster />);
    expect(screen.getAllByText("megan@x.com").length).toBeGreaterThan(0);
    expect(screen.getByText("aaron@x.com")).toBeInTheDocument();
  });

  it("separates discovered candidates from audited reps", () => {
    render(<CrmJailRoster />);
    // Robert is Court Services on TREATMENT Standard — discovered, not audited.
    expect(screen.getByText("Robert Dallessandro")).toBeInTheDocument();
    expect(screen.getByText("Candidate")).toBeInTheDocument();
    expect(screen.getByText(/awaiting review/)).toBeInTheDocument();
  });

  it("warns that activating someone exposes them to real discipline", () => {
    render(<CrmJailRoster />);
    expect(screen.getByText(/can be assigned CRM Jail/)).toBeInTheDocument();
  });

  it("a candidate's switch is off so nobody is audited by accident", () => {
    render(<CrmJailRoster />);
    const sw = screen.getByLabelText("Audit Robert Dallessandro");
    expect(sw).toHaveAttribute("data-state", "unchecked");
  });
});
