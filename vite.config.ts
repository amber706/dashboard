/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@workspace/api-client-react": path.resolve(
        import.meta.dirname,
        "src/lib/workspace-api-stub.ts",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    host: "localhost",
  },
  test: {
    // jsdom environment for component tests via @testing-library/react.
    // Pure-logic test files don't pay for the jsdom overhead — vitest
    // creates the environment lazily per file.
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // Keep Playwright e2e specs out of vitest's collection. They run
    // under `npm run test:e2e` against a real browser.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
