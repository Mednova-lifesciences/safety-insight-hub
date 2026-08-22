// Deliberately separate from vite.config.ts, which pulls in the full
// TanStack Start SSR/build pipeline via @lovable.dev/vite-tanstack-config —
// unnecessary (and fragile) for running plain unit tests against pure
// service-layer modules. Keeps @/ path-alias resolution via
// vite-tsconfig-paths since some modules under test import through it.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
  },
});
