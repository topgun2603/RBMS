import type { FeatureStatus } from "./check";
import type { AreaId, StudioActor, StudioEnv } from "./types";

export interface CatalogueGlance {
  categories: { id: string; slug: string; name: string; products: number }[];
  collections: { slug: string; title: string }[];
  /** A few real products (name and price in rupees) for sample content. */
  products: { name: string; price: number }[];
}

export interface FeatureRow {
  key: string;
  label: string;
  enabled: boolean;
  switchable: boolean;
}

export interface WriteContext {
  tenantId: string;
  actor: StudioActor;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Everything Studio needs from the rest of the platform. The API host implements these over the EXISTING services
 * (branding, cms, settings, staff, auth, features), so Studio can only ever do what those services let an owner do.
 */
export interface StudioPorts {
  env(tenantId: string): Promise<StudioEnv>;
  /** Reads areas as they are now. Every value is JSON. */
  readAreas(tenantId: string, areas: AreaId[]): Promise<Record<AreaId, unknown>>;
  /** Writes one area through its service. `before` is what it holds now; throws when the service refuses. */
  writeArea(ctx: WriteContext, area: AreaId, before: unknown, after: unknown): Promise<void>;
  feature(tenantId: string, key: string): Promise<FeatureStatus>;
  features(tenantId: string): Promise<FeatureRow[]>;
  catalogue(tenantId: string): Promise<CatalogueGlance>;
  /** Pages of the shop (slug, title, status) for the planner. */
  pages(tenantId: string): Promise<{ slug: string; title: string; status: string }[]>;
  /** Number of team members holding a custom role (undo of "create role" must not strip it from people). */
  roleMembers(tenantId: string, roleKey: string): Promise<number>;
  audit(e: { tenantId: string; userId: string; action: string; entityId: string; summary: string; before?: unknown; after?: unknown; ip?: string | null }): Promise<void>;
}
