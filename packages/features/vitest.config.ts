import { defineConfig } from "vitest/config";

// The preHandler tests boot Fastify; under a full `pnpm -r test` the first boot can pass the 5 s default.
export default defineConfig({ test: { testTimeout: 15_000 } });
