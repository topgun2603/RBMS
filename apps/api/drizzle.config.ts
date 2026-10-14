import { defineConfig } from "drizzle-kit";

// Every module keeps its tables in packages/<id>/src/schema.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/*/src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://srikit:srikit@localhost:5432/srikit" },
});
