// role_copy.test.ts — covers the role-aware label helpers used by every
// reporting dashboard page. Pure-function tests; no React rendering needed
// (which means no @testing-library/react dep is required to land Phase 2B).

import { describe, expect, it } from "vitest";

import {
  pageSubtitle,
  roleLabel,
  showsByRepSections,
} from "../role_copy";

describe("roleLabel", () => {
  it("prefixes 'Your' for the rep role (CLAUDE.md's specialist)", () => {
    expect(roleLabel("rep", "MQLs")).toBe("Your MQLs");
    // Sentence-case input gets first-letter-lowered so the prefix reads
    // naturally — "Your admits", not "Your Admits".
    expect(roleLabel("rep", "Admits")).toBe("Your admits");
  });

  it("prefixes 'Team' for manager and admin", () => {
    expect(roleLabel("manager", "MQLs")).toBe("Team MQLs");
    expect(roleLabel("admin", "MQLs")).toBe("Team MQLs");
  });

  it("lower-cases the first letter of mixed-case labels", () => {
    // "Missed-call rate" → "Your missed-call rate" (sentence-cased)
    expect(roleLabel("rep", "Missed-call rate")).toBe("Your missed-call rate");
    expect(roleLabel("manager", "Inbound calls")).toBe("Team inbound calls");
  });

  it("preserves acronyms when both first chars are upper-case", () => {
    expect(roleLabel("rep", "MQLs")).toBe("Your MQLs");
    expect(roleLabel("rep", "VOBs")).toBe("Your VOBs");
    // Edge case: "BD referrals" is a partial acronym
    expect(roleLabel("manager", "BD referrals")).toBe("Team BD referrals");
  });

  it("handles null / undefined roles by defaulting to 'Team'", () => {
    expect(roleLabel(null, "MQLs")).toBe("Team MQLs");
    expect(roleLabel(undefined, "MQLs")).toBe("Team MQLs");
  });

  it("handles empty labels gracefully", () => {
    expect(roleLabel("rep", "")).toBe("Your");
    expect(roleLabel("manager", "")).toBe("Team");
  });
});

describe("pageSubtitle", () => {
  it("'Your performance' for the rep role", () => {
    expect(pageSubtitle("rep")).toBe("Your performance");
  });

  it("'Team performance' for manager and admin", () => {
    expect(pageSubtitle("manager")).toBe("Team performance");
    expect(pageSubtitle("admin")).toBe("Team performance");
  });

  it("defaults to 'Team performance' for null / undefined", () => {
    expect(pageSubtitle(null)).toBe("Team performance");
    expect(pageSubtitle(undefined)).toBe("Team performance");
  });
});

describe("showsByRepSections", () => {
  it("hides by-rep sections from rep role (they only have themselves)", () => {
    expect(showsByRepSections("rep")).toBe(false);
  });

  it("shows by-rep sections to manager + admin", () => {
    expect(showsByRepSections("manager")).toBe(true);
    expect(showsByRepSections("admin")).toBe(true);
  });

  it("defaults to false for null / undefined (safer default)", () => {
    expect(showsByRepSections(null)).toBe(false);
    expect(showsByRepSections(undefined)).toBe(false);
  });
});
