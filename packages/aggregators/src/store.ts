import type { Db } from "@srirealtime/db";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  aggregatorConnections,
  aggregatorItemMaps,
  aggregatorOrders,
  type AggregatorConnectionRow,
  type AggregatorItemMapRow,
  type AggregatorOrderRow,
  type CallbackEntry,
  type NewAggregatorOrder,
} from "./schema";
import type { AggOrderStatus, ProviderId } from "./types";

export type ConnectionPatch = Partial<Omit<AggregatorConnectionRow, "id" | "tenantId" | "provider" | "createdAt" | "updatedAt">>;
export type OrderPatch = Partial<Omit<AggregatorOrderRow, "id" | "tenantId" | "provider" | "externalId" | "createdAt" | "updatedAt" | "callbacks">>;

/** Persistence of the connector (Postgres in the app, in memory in tests). */
export interface AggregatorStore {
  connectionByKey(key: string): Promise<AggregatorConnectionRow | null>;
  connection(tenantId: string, provider: ProviderId): Promise<AggregatorConnectionRow | null>;
  connections(tenantId: string): Promise<AggregatorConnectionRow[]>;
  /** Creates (with `webhookKey`) or updates the shop's connection to a provider. */
  saveConnection(tenantId: string, provider: ProviderId, patch: ConnectionPatch & { webhookKey: string }): Promise<AggregatorConnectionRow>;
  /** Updates fields of a connection by id (last webhook / error, a new webhook key). */
  touchConnection(id: string, patch: ConnectionPatch): Promise<void>;

  mappings(tenantId: string, provider: ProviderId, externalIds?: string[]): Promise<AggregatorItemMapRow[]>;
  saveMapping(tenantId: string, provider: ProviderId, m: { externalId: string; itemId: string; title: string | null }): Promise<AggregatorItemMapRow>;
  deleteMapping(tenantId: string, id: string): Promise<boolean>;

  /** Inserts unless (shop, provider, external id) exists: `created` false means a repeat webhook. */
  insertOrder(row: NewAggregatorOrder): Promise<{ row: AggregatorOrderRow; created: boolean }>;
  order(tenantId: string, id: string): Promise<AggregatorOrderRow | null>;
  orderByExternal(tenantId: string, provider: ProviderId, externalId: string): Promise<AggregatorOrderRow | null>;
  orderByDining(tenantId: string, diningOrderId: string): Promise<AggregatorOrderRow | null>;
  /** Updates when the status is one of `from` (state machine guard); null when it moved on meanwhile. */
  updateOrder(tenantId: string, id: string, patch: OrderPatch, from?: readonly AggOrderStatus[]): Promise<AggregatorOrderRow | null>;
  addCallback(tenantId: string, id: string, entry: CallbackEntry): Promise<void>;
  listOrders(tenantId: string, q: { statuses?: readonly AggOrderStatus[]; limit: number }): Promise<AggregatorOrderRow[]>;
  ordersBetween(tenantId: string, from: Date, to: Date): Promise<AggregatorOrderRow[]>;
}

/** The Postgres store. */
export function drizzleStore(db: Db): AggregatorStore {
  const C = aggregatorConnections;
  const M = aggregatorItemMaps;
  const O = aggregatorOrders;
  return {
    async connectionByKey(key) {
      const [r] = await db.select().from(C).where(eq(C.webhookKey, key)).limit(1);
      return r ?? null;
    },
    async connection(tenantId, provider) {
      const [r] = await db
        .select()
        .from(C)
        .where(and(eq(C.tenantId, tenantId), eq(C.provider, provider)))
        .limit(1);
      return r ?? null;
    },
    connections: (tenantId) => db.select().from(C).where(eq(C.tenantId, tenantId)).orderBy(C.provider),
    async saveConnection(tenantId, provider, patch) {
      const { webhookKey, ...rest } = patch;
      const [r] = await db
        .insert(C)
        .values({ tenantId, provider, webhookKey, ...rest })
        .onConflictDoUpdate({ target: [C.tenantId, C.provider], set: { ...rest, updatedAt: new Date() } })
        .returning();
      return r!;
    },
    async touchConnection(id, patch) {
      await db.update(C).set(patch).where(eq(C.id, id));
    },

    mappings: (tenantId, provider, externalIds) =>
      externalIds && externalIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(M)
            .where(and(eq(M.tenantId, tenantId), eq(M.provider, provider), externalIds ? inArray(M.externalId, externalIds.slice(0, 1000)) : undefined))
            .orderBy(M.title),
    async saveMapping(tenantId, provider, m) {
      const [r] = await db
        .insert(M)
        .values({ tenantId, provider, ...m })
        .onConflictDoUpdate({ target: [M.tenantId, M.provider, M.externalId], set: { itemId: m.itemId, title: m.title, updatedAt: new Date() } })
        .returning();
      return r!;
    },
    async deleteMapping(tenantId, id) {
      const rows = await db
        .delete(M)
        .where(and(eq(M.tenantId, tenantId), eq(M.id, id)))
        .returning({ id: M.id });
      return rows.length > 0;
    },

    async insertOrder(row) {
      const [r] = await db.insert(O).values(row).onConflictDoNothing({ target: [O.tenantId, O.provider, O.externalId] }).returning();
      if (r) return { row: r, created: true };
      const [existing] = await db
        .select()
        .from(O)
        .where(and(eq(O.tenantId, row.tenantId), eq(O.provider, row.provider), eq(O.externalId, row.externalId)))
        .limit(1);
      return { row: existing!, created: false };
    },
    async order(tenantId, id) {
      const [r] = await db
        .select()
        .from(O)
        .where(and(eq(O.tenantId, tenantId), eq(O.id, id)))
        .limit(1);
      return r ?? null;
    },
    async orderByExternal(tenantId, provider, externalId) {
      const [r] = await db
        .select()
        .from(O)
        .where(and(eq(O.tenantId, tenantId), eq(O.provider, provider), eq(O.externalId, externalId)))
        .limit(1);
      return r ?? null;
    },
    async orderByDining(tenantId, diningOrderId) {
      const [r] = await db
        .select()
        .from(O)
        .where(and(eq(O.tenantId, tenantId), eq(O.diningOrderId, diningOrderId)))
        .limit(1);
      return r ?? null;
    },
    async updateOrder(tenantId, id, patch, from) {
      const [r] = await db
        .update(O)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(O.tenantId, tenantId), eq(O.id, id), from ? inArray(O.status, [...from]) : undefined))
        .returning();
      return r ?? null;
    },
    async addCallback(tenantId, id, entry) {
      // Keep the last 30 reports.
      await db
        .update(O)
        .set({ callbacks: sql`(select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(${O.callbacks} || ${JSON.stringify([entry])}::jsonb) e offset greatest(jsonb_array_length(${O.callbacks}) + 1 - 30, 0)) s)` })
        .where(and(eq(O.tenantId, tenantId), eq(O.id, id)));
    },
    listOrders: (tenantId, q) =>
      db
        .select()
        .from(O)
        .where(and(eq(O.tenantId, tenantId), q.statuses ? inArray(O.status, [...q.statuses]) : undefined))
        .orderBy(desc(O.placedAt))
        .limit(q.limit),
    ordersBetween: (tenantId, from, to) =>
      db
        .select()
        .from(O)
        .where(and(eq(O.tenantId, tenantId), gte(O.placedAt, from), lt(O.placedAt, to)))
        .orderBy(O.placedAt),
  };
}
