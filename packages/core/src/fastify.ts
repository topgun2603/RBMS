import type { RequestContext } from "./context";

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
  interface FastifyContextConfig {
    /** Feature key(s) this route belongs to; the API host checks them for requests with a tenant (all required). */
    feature?: string | string[];
  }
}

export {};
