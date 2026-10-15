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
  /** Features this module declares (see docs/features.md). */
  features?: FeatureDef[];
}

/**
 * A switchable capability of a module. Key = `<moduleId>` for the base feature, `<moduleId>.<name>` for optional parts.
 */
export interface FeatureDef {
  /** e.g. "invoices.credit-book" */
  key: string;
  /** e.g. "invoices" */
  module: string;
  /** English label, e.g. "Credit book". */
  label: string;
  description: string;
  /** Features that must be enabled too, e.g. ["invoices"]. */
  dependsOn?: string[];
  /** Shop owners may switch it off/on (default false). */
  shopToggle?: boolean;
  /** Shop-toggle default when the owner never touched it (default true). */
  defaultOn?: boolean;
}

/** Lets a module check a shop's feature outside the request pipeline (public links, background jobs). */
export interface FeatureGatePort {
  isEnabled(tenantId: string, key: string): Promise<boolean>;
}

export const defineModule = (m: SrModule): SrModule => m;
