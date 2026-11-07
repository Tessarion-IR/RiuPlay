// M0 research tests: run with  npx vitest run --config research/m0/vitest.config.ts
// Kept apart from the app's suites; nothing here is part of the shipped application.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["research/m0/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
