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
});
