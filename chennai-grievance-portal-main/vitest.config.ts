import path from "path";
import { defineConfig } from "vitest/config";

// Unit tests for Ask District IQ (src/**/*.test.ts). No database or AI provider is needed: the
// compiler and catalog tests run on the committed schema snapshot.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" }
});
