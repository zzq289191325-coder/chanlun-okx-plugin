import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "@intelligence/core": resolve(import.meta.dirname, "../../packages/core/src/index.ts"),
      "@intelligence/contracts": resolve(import.meta.dirname, "../../packages/contracts/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["dist/**", "src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  },
});
