import type { FastifyContextConfig } from "fastify";
import type { RouteSchema } from "./fastify";

/**
 * Route options with request / response shapes for the API document (and the generated mobile client), merged into
 * any other route config: `app.post("/x", documented({ body, response }, { feature: "x" }), handler)`.
 * Passing it through this helper (rather than an inline `config: { schema }`) keeps Fastify's generics out of the zod types.
 */
export const documented = (schema: RouteSchema, config: FastifyContextConfig = {}): { config: FastifyContextConfig } => ({ config: { ...config, schema } });
