import { randomUUID } from "node:crypto";
import type { AggregatorConnectionRow, AggregatorItemMapRow, AggregatorOrderRow } from "./schema";
import type { AggregatorStore } from "./store";

/** In-memory store with the same semantics as the Postgres one (tests, local tools). */
export function memoryStore(): AggregatorStore & { conns: AggregatorConnectionRow[]; maps: AggregatorItemMapRow[]; orders: AggregatorOrderRow[] } {
  const conns: AggregatorConnectionRow[] = [];
  const maps: AggregatorItemMapRow[] = [];
  const orders: AggregatorOrderRow[] = [];
  const stamp = () => ({ createdAt: new Date(), updatedAt: new Date() });
  const clean = <T extends object>(p: T) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<T>;
  return {
    conns,
    maps,
    orders,
    async connectionByKey(key) {
      return conns.find((c) => c.webhookKey === key) ?? null;
    },
    async connection(tenantId, provider) {
      return conns.find((c) => c.tenantId === tenantId && c.provider === provider) ?? null;
    },
    async connections(tenantId) {
      return conns.filter((c) => c.tenantId === tenantId);
    },
    async saveConnection(tenantId, provider, patch) {
      const { webhookKey, ...rest } = patch;
      const found = conns.find((c) => c.tenantId === tenantId && c.provider === provider);
      if (found) {
        Object.assign(found, clean(rest), { updatedAt: new Date() });
        return { ...found };
      }
      const row: AggregatorConnectionRow = {
        id: randomUUID(),
        tenantId,
        provider,
        webhookKey,
        enabled: true,
        username: null,
        apiKeyEnc: null,
        webhookSecretEnc: null,
        storeRef: null,
        baseUrl: null,
        platforms: {},
        autoAccept: false,
        prepMinutes: 20,
        lastWebhookAt: null,
        lastError: null,
        menuPushedAt: null,
        ...stamp(),
        ...clean(rest),
      };
      conns.push(row);
      return { ...row };
    },
    async touchConnection(id, patch) {
      const c = conns.find((x) => x.id === id);
      if (c) Object.assign(c, clean(patch));
    },
    async mappings(tenantId, provider, externalIds) {
      return maps.filter((m) => m.tenantId === tenantId && m.provider === provider && (!externalIds || externalIds.includes(m.externalId)));
    },
    async saveMapping(tenantId, provider, m) {
      const found = maps.find((x) => x.tenantId === tenantId && x.provider === provider && x.externalId === m.externalId);
      if (found) {
        Object.assign(found, m);
        return { ...found };
      }
      const row: AggregatorItemMapRow = { id: randomUUID(), tenantId, provider, ...m, ...stamp() };
      maps.push(row);
      return { ...row };
    },
    async deleteMapping(tenantId, id) {
      const i = maps.findIndex((m) => m.tenantId === tenantId && m.id === id);
      if (i < 0) return false;
      maps.splice(i, 1);
      return true;
    },
    async insertOrder(r) {
      const found = orders.find((o) => o.tenantId === r.tenantId && o.provider === r.provider && o.externalId === r.externalId);
      if (found) return { row: { ...found }, created: false };
      const row: AggregatorOrderRow = {
        id: randomUUID(),
        platformOrderId: null,
        type: "delivery",
        status: "placed",
        diningOrderId: null,
        kitchenNumber: null,
        lines: [],
        unmapped: 0,
        total: 0,
        payment: "prepaid",
        taxMode: "eco_9_5",
        valueOfSupply: 0,
        gst: 0,
        operatorGstin: null,
        expectedPickupAt: null,
        prepMinutes: null,
        acceptedAt: null,
        readyAt: null,
        dispatchedAt: null,
        closedAt: null,
        reason: null,
        rider: null,
        callbacks: [],
        kitchenError: null,
        test: false,
        ...stamp(),
        ...(clean(r) as typeof r),
      } as AggregatorOrderRow;
      orders.push(row);
      return { row: { ...row }, created: true };
    },
    async order(tenantId, id) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === id);
      return o ? { ...o } : null;
    },
    async orderByExternal(tenantId, provider, externalId) {
      const o = orders.find((x) => x.tenantId === tenantId && x.provider === provider && x.externalId === externalId);
      return o ? { ...o } : null;
    },
    async orderByDining(tenantId, diningOrderId) {
      const o = orders.find((x) => x.tenantId === tenantId && x.diningOrderId === diningOrderId);
      return o ? { ...o } : null;
    },
    async updateOrder(tenantId, id, patch, from) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === id);
      if (!o || (from && !from.includes(o.status))) return null;
      Object.assign(o, clean(patch), { updatedAt: new Date() });
      return { ...o };
    },
    async addCallback(tenantId, id, entry) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === id);
      if (o) o.callbacks = [...o.callbacks, entry].slice(-30);
    },
    async listOrders(tenantId, q) {
      return orders
        .filter((o) => o.tenantId === tenantId && (!q.statuses || q.statuses.includes(o.status)))
        .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
        .slice(0, q.limit)
        .map((o) => ({ ...o }));
    },
    async ordersBetween(tenantId, from, to) {
      return orders.filter((o) => o.tenantId === tenantId && o.placedAt >= from && o.placedAt < to).map((o) => ({ ...o }));
    },
  };
}
