/// <reference types="@testing-library/jest-dom" />
// vitest.setup.ts — global setup for every test file.
//
// Adds @testing-library/jest-dom matchers so component tests can do
// `expect(node).toBeInTheDocument()` etc., and registers `afterEach`
// cleanup so the jsdom container is reset between tests.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
