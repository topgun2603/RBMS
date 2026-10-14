import type { FastifyInstance } from "fastify";

/**
 * A pluggable module. The API host mounts each module's routes under `/v1/<id>`
 * and collects `tables` for Drizzle migrations.
 */
export interface SrModule {
  id: string;
  /** Drizzle tables (and enums/relations) owned by this module. */
  tables?: Record<string, unknown>;
  /** Fastify plugin that registers this module's HTTP routes. */
  routes?: (app: FastifyInstance) => Promise<void> | void;
  /** Called once after every module is registered, e.g. to start workers. */
  start?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
}

export const defineModule = (m: SrModule): SrModule => m;
