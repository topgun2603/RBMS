import { authOtps, authSessions } from "@srirealtime/auth";
import { chatMessages } from "@srirealtime/chat";
import {
  PRIVACY_SETTINGS_DEFAULTS,
  normalisePhone,
  type PrivacyHostPort,
  type PrivacySettings,
  type RetentionCategory,
  type RightsService,
  type RetentionService,
  type SubjectHandler,
  type SubjectQuery,
} from "@srirealtime/consent";
import { billingCustomers, invoices } from "@srirealtime/invoices";
import { kycDocuments } from "@srirealtime/kyc";
import { loyaltyLedger, loyaltyMembers } from "@srirealtime/loyalty";
import { medicinePrescriptions } from "@srirealtime/medicines";
import { membershipMembers, membershipSubscriptions } from "@srirealtime/memberships";
import { orders } from "@srirealtime/orders";
import { payrollEmployees } from "@srirealtime/payroll";
import type { SettingsService } from "@srirealtime/settings";
import { storeAddresses, storeCarts, storeCustomers, storeWishlist } from "@srirealtime/storefront";
import { supportMessages, supportTickets } from "@srirealtime/support";
import { tenants } from "@srirealtime/tenancy";
import { files, type UploadsService } from "@srirealtime/uploads";
import { waContacts, waMessages } from "@srirealtime/whatsapp";
import type { Db } from "@srirealtime/db";
import type { FeaturesService } from "@srirealtime/features";
import { and, count, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";

/** Tables each retention category touches; the test in kit-privacy.test.ts checks none is a tax / accounting table. */
type Cat = RetentionCategory;
const BATCH = 1000;

export interface PrivacyKitDeps {
  db: Db;
  settings: SettingsService;
  features: () => FeaturesService;
  uploads: () => UploadsService;
  /** Display name and legal address of a shop (the `billing` settings are read through `settings`). */
  log?: { warn(o: unknown, m?: string): void };
}

/** Settings, shop facts and the shop list for the privacy services (consent package), read lazily from the kit. */
export function createPrivacyHost(deps: PrivacyKitDeps): PrivacyHostPort {
  // Handles are looked up on use: the namespaces are defined after the consent module is created.
  return {
    async settings(tenantId): Promise<PrivacySettings> {
      return { ...PRIVACY_SETTINGS_DEFAULTS, ...((await deps.settings.handle("privacy").get({ tenantId })) as PrivacySettings) };
    },
    async facts(tenantId) {
      if (!tenantId) {
        return {
          shopName: "RBMS",
          legalName: "RBMS (Retail & Business Management Suite)",
          address: "",
          modules: { storefront: false, loyalty: false, memberships: false, pharmacy: false, payroll: false, ai: false, messaging: false, delivery: false, services: false },
        };
      }
      const [t] = await deps.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      const [b, aiSettings] = await Promise.all([deps.settings.handle("billing").get({ tenantId }) as Promise<Record<string, string>>, deps.settings.handle("ai").get({ tenantId }) as Promise<{ enabled?: boolean }>]);
      const f = deps.features();
      const on = (key: string) => f.isEnabled(tenantId, key).catch(() => false);
      const [storefront, loyalty, memberships, pharmacy, payroll, aiOn, whatsapp, delivery, bookings, jobcards] = await Promise.all(
        ["storefront", "loyalty", "memberships", "medicines", "payroll", "ai", "whatsapp", "delivery", "bookings", "jobcards"].map(on),
      );
      return {
        shopName: t?.name ?? "",
        legalName: b?.legalName ?? "",
        address: [b?.address, b?.city, b?.pincode].filter(Boolean).join(", "),
        modules: {
          storefront: !!storefront,
          loyalty: !!loyalty,
          memberships: !!memberships,
          pharmacy: !!pharmacy,
          payroll: !!payroll,
          ai: !!aiOn && !!aiSettings?.enabled,
          messaging: !!whatsapp,
          delivery: !!delivery,
          services: !!bookings || !!jobcards,
        },
      };
    },
    async tenantIds() {
      const rows = await deps.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
      return rows.map((r) => r.id);
    },
    async contactOf(tenantId, userId) {
      const [c] = await deps.db
        .select({ name: storeCustomers.name, phone: storeCustomers.phone, email: storeCustomers.email })
        .from(storeCustomers)
        .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.userId, userId)))
        .limit(1);
      return c ? { name: c.name || null, phone: c.phone, email: c.email } : null;
    },
  };
}

/** "+919876543210" and its stored variants. */
const phoneVariants = (phone: string | null | undefined): string[] => {
  const p = normalisePhone(phone);
  if (!p) return [];
  const digits = p.replace(/^\+/, "");
  return [p, digits, digits.replace(/^91/, "")];
};
const emailKey = (e: string | null | undefined) => (e ? e.trim().toLowerCase() : null);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** Removes uploaded files whose public URL (or key) is one of `urls`. Best effort: a missing file is fine. */
async function removeUploads(db: Db, uploads: () => UploadsService, tenantId: string, urls: Array<string | null | undefined>) {
  const keys = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    let path = u;
    try {
      path = new URL(u).pathname;
    } catch {
      /* a bare key */
    }
    const parts = path.replace(/^\/+/, "").split("/");
    for (let i = 0; i < Math.min(parts.length, 4); i++) keys.add(parts.slice(i).join("/"));
  }
  if (keys.size === 0) return;
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.tenantId, tenantId), ne(files.status, "deleted"), inArray(files.key, [...keys])));
  for (const r of rows) await uploads().remove(r.id, tenantId).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------- subject handlers

export function createSubjectHandlers(deps: { db: Db; uploads: () => UploadsService }): SubjectHandler[] {
  const { db } = deps;
  const phoneOr = (col: Parameters<typeof inArray>[0], q: SubjectQuery): SQL[] => {
    const v = phoneVariants(q.phone);
    return v.length ? [inArray(col, v)] : [];
  };
  const emailEq = (col: SQL | Parameters<typeof eq>[0], q: SubjectQuery): SQL[] => {
    const e = emailKey(q.email);
    return e ? [sql`lower(${col}) = ${e}`] : [];
  };

  /** Anonymises online-store accounts (also used by the inactive-customer retention rule). */
  async function anonymiseStoreCustomer(tenantId: string, id: string) {
    await db.delete(storeAddresses).where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, id)));
    await db.delete(storeWishlist).where(and(eq(storeWishlist.tenantId, tenantId), eq(storeWishlist.customerId, id)));
    await db.delete(storeCarts).where(and(eq(storeCarts.tenantId, tenantId), eq(storeCarts.customerId, id)));
    await db.update(storeCustomers).set({ name: "", phone: null, email: null, marketingOptIn: false }).where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, id)));
    const [o] = await db.select({ n: count() }).from(orders).where(and(eq(orders.tenantId, tenantId), sql`${orders.customer}->>'accountId' = ${id}`));
    return Number(o?.n ?? 0);
  }

  const storeCustomersHandler: SubjectHandler = {
    id: "store_customers",
    label: "Online store account",
    async locate(tenantId, q) {
      const or_ = [...(q.userId ? [eq(storeCustomers.userId, q.userId)] : []), ...phoneOr(storeCustomers.phone, q), ...emailEq(storeCustomers.email, q)];
      if (!or_.length) return [];
      const rows = await db.select({ id: storeCustomers.id, name: storeCustomers.name, phone: storeCustomers.phone }).from(storeCustomers).where(and(eq(storeCustomers.tenantId, tenantId), or(...or_)));
      return rows.map((r) => ({ id: r.id, label: r.name || r.phone || r.id.slice(0, 8) }));
    },
    async export(tenantId, id) {
      const [c] = await db.select().from(storeCustomers).where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, id))).limit(1);
      const [addresses, wishlist, ords] = await Promise.all([
        db.select().from(storeAddresses).where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, id))),
        db.select({ productId: storeWishlist.productId, createdAt: storeWishlist.createdAt }).from(storeWishlist).where(and(eq(storeWishlist.tenantId, tenantId), eq(storeWishlist.customerId, id))),
        db
          .select({ number: orders.number, placedAt: orders.placedAt, total: orders.total, status: orders.status, paymentStatus: orders.paymentStatus })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), sql`${orders.customer}->>'accountId' = ${id}`)),
      ]);
      return {
        account: c ? { name: c.name, phone: c.phone, email: c.email, marketingOptIn: c.marketingOptIn, ordersCount: c.ordersCount, createdAt: c.createdAt } : null,
        addresses: addresses.map((a) => ({ label: a.label, name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, pincode: a.pincode })),
        wishlist,
        orders: ords.map((o) => ({ ...o, totalRupees: o.total / 100 })),
      };
    },
    async anonymise(tenantId, id) {
      const kept = await anonymiseStoreCustomer(tenantId, id);
      return { anonymised: true, kept: kept ? [`${kept} online order${kept === 1 ? "" : "s"} kept as sales records (GST: 8 years, CGST Act s.36); the account link is removed`] : [] };
    },
    async stopMarketing(tenantId, id) {
      await db.update(storeCustomers).set({ marketingOptIn: false }).where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, id)));
    },
    correctionHint: "Online store account: the shopper edits name and email in the account; addresses in Addresses.",
  };

  const billingHandler: SubjectHandler = {
    id: "billing_customers",
    label: "Customer in the bills",
    async locate(tenantId, q) {
      const or_ = [...phoneOr(billingCustomers.phone, q), ...emailEq(billingCustomers.email, q)];
      if (!or_.length) return [];
      const rows = await db.select({ id: billingCustomers.id, name: billingCustomers.name }).from(billingCustomers).where(and(eq(billingCustomers.tenantId, tenantId), or(...or_)));
      return rows.map((r) => ({ id: r.id, label: r.name }));
    },
    async export(tenantId, id) {
      const [c] = await db.select().from(billingCustomers).where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, id))).limit(1);
      const bills = await db
        .select({ number: invoices.number, date: invoices.date, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, id)));
      return { customer: c ? { name: c.name, phone: c.phone, email: c.email, gstin: c.gstin, address: c.address } : null, bills };
    },
    async anonymise(tenantId, id) {
      const open = await db
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, id), inArray(invoices.status, ["issued", "partially_paid"])));
      if (Number(open[0]?.n ?? 0) > 0) return { anonymised: false, kept: ["Customer record kept: there are unpaid bills (they are removed once settled)"] };
      const [b] = await db.select({ n: count() }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, id)));
      await db
        .update(billingCustomers)
        .set({ name: "Erased customer", phone: null, email: null, address: null, statementToken: null, ...(Number(b?.n ?? 0) === 0 ? { gstin: null } : {}) })
        .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, id)));
      const n = Number(b?.n ?? 0);
      return { anonymised: true, kept: n ? [`${n} GST bill${n === 1 ? "" : "s"} kept with the name and GSTIN printed on them (8 years, CGST Act s.36)`] : [] };
    },
    correctionHint: "Customer in the bills: edit the customer under Customers.",
  };

  const loyaltyHandler: SubjectHandler = {
    id: "loyalty_members",
    label: "Loyalty member",
    async locate(tenantId, q) {
      const v = phoneVariants(q.phone);
      if (!v.length) return [];
      const rows = await db.select({ id: loyaltyMembers.id, name: loyaltyMembers.name, key: loyaltyMembers.memberKey }).from(loyaltyMembers).where(and(eq(loyaltyMembers.tenantId, tenantId), inArray(loyaltyMembers.memberKey, v)));
      return rows.map((r) => ({ id: r.id, label: r.name || r.key }));
    },
    async export(tenantId, id) {
      const [m] = await db.select().from(loyaltyMembers).where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.id, id))).limit(1);
      const ledger = await db.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.memberId, id)));
      return { member: m ? { name: m.name, phone: m.memberKey, points: m.pointsBalance, tier: m.tier, joinedAt: m.joinedAt } : null, ledger };
    },
    async anonymise(tenantId, id) {
      await db.update(loyaltyMembers).set({ name: null, memberKey: `erased:${id}`, pointsBalance: 0 }).where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.id, id)));
      return { anonymised: true, kept: [] };
    },
    correctionHint: "Loyalty member: edit the name under Loyalty.",
  };

  const membershipHandler: SubjectHandler = {
    id: "membership_members",
    label: "Member",
    async locate(tenantId, q) {
      const or_ = phoneOr(membershipMembers.phone, q);
      if (!or_.length) return [];
      const rows = await db.select({ id: membershipMembers.id, name: membershipMembers.name, code: membershipMembers.memberCode }).from(membershipMembers).where(and(eq(membershipMembers.tenantId, tenantId), or(...or_)));
      return rows.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }));
    },
    async export(tenantId, id) {
      const [m] = await db.select().from(membershipMembers).where(and(eq(membershipMembers.tenantId, tenantId), eq(membershipMembers.id, id))).limit(1);
      const subs = await db.select({ startDate: membershipSubscriptions.startDate, endDate: membershipSubscriptions.endDate, status: membershipSubscriptions.status }).from(membershipSubscriptions).where(and(eq(membershipSubscriptions.tenantId, tenantId), eq(membershipSubscriptions.memberId, id)));
      return { member: m ? { name: m.name, phone: m.phone, code: m.memberCode, notes: m.notes } : null, subscriptions: subs };
    },
    async anonymise(tenantId, id) {
      const [m] = await db.select({ photo: membershipMembers.photoUrl }).from(membershipMembers).where(and(eq(membershipMembers.tenantId, tenantId), eq(membershipMembers.id, id))).limit(1);
      await db.update(membershipMembers).set({ name: "Erased member", phone: null, notes: null, photoUrl: null }).where(and(eq(membershipMembers.tenantId, tenantId), eq(membershipMembers.id, id)));
      await removeUploads(db, deps.uploads, tenantId, [m?.photo]);
      return { anonymised: true, kept: [] };
    },
    correctionHint: "Member: edit the member under Memberships.",
  };

  const whatsappHandler: SubjectHandler = {
    id: "wa_contacts",
    label: "WhatsApp conversation",
    async locate(tenantId, q) {
      const v = phoneVariants(q.phone).map((p) => (p.startsWith("+") ? p : `+${p.length === 10 ? "91" : ""}${p}`));
      if (!v.length) return [];
      const rows = await db.select({ id: waContacts.id, name: waContacts.name, phone: waContacts.phone }).from(waContacts).where(and(eq(waContacts.tenantId, tenantId), inArray(waContacts.phone, v)));
      return rows.map((r) => ({ id: r.id, label: r.name || r.phone }));
    },
    async export(tenantId, id) {
      const [c] = await db.select().from(waContacts).where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, id))).limit(1);
      const msgs = await db.select({ direction: waMessages.direction, type: waMessages.type, body: waMessages.body, createdAt: waMessages.createdAt }).from(waMessages).where(and(eq(waMessages.tenantId, tenantId), eq(waMessages.contactId, id)));
      return { contact: c ? { name: c.name, phone: c.phone, optedIn: c.optedIn } : null, messages: msgs };
    },
    async anonymise(tenantId, id) {
      await db.delete(waMessages).where(and(eq(waMessages.tenantId, tenantId), eq(waMessages.contactId, id)));
      await db
        .update(waContacts)
        .set({ name: null, phone: `erased:${id}`, optedIn: false, optedOutAt: new Date(), tags: [], lastMessagePreview: null })
        .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, id)));
      return { anonymised: true, kept: [] };
    },
    async stopMarketing(tenantId, id) {
      await db.update(waContacts).set({ optedIn: false, optedOutAt: new Date() }).where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, id)));
    },
  };

  const supportHandler: SubjectHandler = {
    id: "support_tickets",
    label: "Help desk ticket",
    async locate(tenantId, q) {
      const or_ = [...(q.userId ? [eq(supportTickets.requesterUserId, q.userId)] : []), ...phoneOr(supportTickets.requesterPhone, q), ...emailEq(supportTickets.requesterEmail, q)];
      if (!or_.length) return [];
      const rows = await db.select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject }).from(supportTickets).where(and(eq(supportTickets.tenantId, tenantId), or(...or_)));
      return rows.map((r) => ({ id: r.id, label: `${r.number} ${r.subject}` }));
    },
    async export(tenantId, id) {
      const [t] = await db.select({ number: supportTickets.number, subject: supportTickets.subject, status: supportTickets.status, createdAt: supportTickets.createdAt }).from(supportTickets).where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id))).limit(1);
      const msgs = await db.select({ authorKind: supportMessages.authorKind, body: supportMessages.body, createdAt: supportMessages.createdAt }).from(supportMessages).where(and(eq(supportMessages.tenantId, tenantId), eq(supportMessages.ticketId, id)));
      return { ticket: t ?? null, messages: msgs };
    },
    async anonymise(tenantId, id) {
      await db.delete(supportTickets).where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id)));
      return { anonymised: true, kept: [] };
    },
  };

  return [storeCustomersHandler, billingHandler, loyaltyHandler, membershipHandler, whatsappHandler, supportHandler];
}

// ---------------------------------------------------------------------------------------------------- retention catalogue

export function createRetentionCategories(deps: { db: Db; uploads: () => UploadsService }): RetentionCategory[] {
  const { db } = deps;
  const tid = (s: { tenantId: string | null }) => {
    if (!s.tenantId) throw new Error("privacy: a shop category needs a shop");
    return s.tenantId;
  };

  const cats: Cat[] = [
    {
      key: "abandoned_carts",
      scope: "shop",
      defaultDays: 30,
      minDays: 1,
      action: "delete",
      touches: ["store_carts"],
      async count(s, cutoff) {
        const [r] = await db.select({ n: count() }).from(storeCarts).where(and(eq(storeCarts.tenantId, tid(s)), lt(storeCarts.updatedAt, cutoff)));
        return Number(r?.n ?? 0);
      },
      async purge(s, cutoff) {
        const rows = await db.delete(storeCarts).where(and(eq(storeCarts.tenantId, tid(s)), lt(storeCarts.updatedAt, cutoff))).returning({ id: storeCarts.id });
        return rows.length;
      },
    },
    (() => {
      const stale = (tenantId: string, cutoff: Date) =>
        and(
          eq(storeCustomers.tenantId, tenantId),
          lt(storeCustomers.updatedAt, cutoff),
          or(isNull(storeCustomers.lastOrderAt), lt(storeCustomers.lastOrderAt, cutoff)),
          or(isNotNull(storeCustomers.phone), isNotNull(storeCustomers.email), ne(storeCustomers.name, "")),
        );
      return {
        key: "inactive_store_customers",
        scope: "shop",
        defaultDays: 1095,
        minDays: 365,
        action: "anonymise",
        touches: ["store_customers", "store_addresses", "store_wishlist", "store_carts"],
        async count(s, cutoff) {
          const [r] = await db.select({ n: count() }).from(storeCustomers).where(stale(tid(s), cutoff));
          return Number(r?.n ?? 0);
        },
        async purge(s, cutoff) {
          const t = tid(s);
          const rows = await db.select({ id: storeCustomers.id }).from(storeCustomers).where(stale(t, cutoff)).limit(BATCH);
          for (const r of rows) {
            await db.delete(storeAddresses).where(and(eq(storeAddresses.tenantId, t), eq(storeAddresses.customerId, r.id)));
            await db.delete(storeWishlist).where(and(eq(storeWishlist.tenantId, t), eq(storeWishlist.customerId, r.id)));
            await db.delete(storeCarts).where(and(eq(storeCarts.tenantId, t), eq(storeCarts.customerId, r.id)));
            await db.update(storeCustomers).set({ name: "", phone: null, email: null, marketingOptIn: false }).where(eq(storeCustomers.id, r.id));
          }
          return rows.length;
        },
      } satisfies Cat;
    })(),
    (() => {
      const old = (tenantId: string, cutoff: Date) => and(eq(supportTickets.tenantId, tenantId), inArray(supportTickets.status, ["resolved", "closed"]), lt(supportTickets.lastMessageAt, cutoff));
      return {
        key: "support_transcripts",
        scope: "shop",
        defaultDays: 1095,
        minDays: 90,
        action: "delete",
        touches: ["support_tickets", "support_messages"],
        async count(s, cutoff) {
          const [r] = await db.select({ n: count() }).from(supportTickets).where(old(tid(s), cutoff));
          return Number(r?.n ?? 0);
        },
        async purge(s, cutoff) {
          const rows = await db.delete(supportTickets).where(old(tid(s), cutoff)).returning({ id: supportTickets.id });
          return rows.length;
        },
      } satisfies Cat;
    })(),
    {
      key: "chat_messages",
      scope: "shop",
      defaultDays: 730,
      minDays: 90,
      action: "delete",
      touches: ["chat_messages"],
      async count(s, cutoff) {
        const [r] = await db.select({ n: count() }).from(chatMessages).where(and(eq(chatMessages.tenantId, tid(s)), lt(chatMessages.createdAt, cutoff)));
        return Number(r?.n ?? 0);
      },
      async purge(s, cutoff) {
        const rows = await db.delete(chatMessages).where(and(eq(chatMessages.tenantId, tid(s)), lt(chatMessages.createdAt, cutoff))).returning({ id: chatMessages.id });
        return rows.length;
      },
    },
    {
      key: "whatsapp_chats",
      scope: "shop",
      defaultDays: 730,
      minDays: 90,
      action: "delete",
      touches: ["wa_messages"],
      async count(s, cutoff) {
        const [r] = await db.select({ n: count() }).from(waMessages).where(and(eq(waMessages.tenantId, tid(s)), lt(waMessages.createdAt, cutoff)));
        return Number(r?.n ?? 0);
      },
      async purge(s, cutoff) {
        const rows = await db.delete(waMessages).where(and(eq(waMessages.tenantId, tid(s)), lt(waMessages.createdAt, cutoff))).returning({ id: waMessages.id });
        return rows.length;
      },
    },
    (() => {
      // The pharmacy prescription register is kept at least 3 years (Drugs Rules); after that the patient is anonymised.
      const old = (tenantId: string, cutoff: Date) => and(eq(medicinePrescriptions.tenantId, tenantId), lt(medicinePrescriptions.rxDate, dateOnly(cutoff)), ne(medicinePrescriptions.patientName, "Removed"));
      return {
        key: "prescriptions",
        scope: "shop",
        defaultDays: 1095,
        minDays: 1095,
        action: "anonymise",
        touches: ["medicine_prescriptions", "files"],
        async count(s, cutoff) {
          const [r] = await db.select({ n: count() }).from(medicinePrescriptions).where(old(tid(s), cutoff));
          return Number(r?.n ?? 0);
        },
        async purge(s, cutoff) {
          const t = tid(s);
          const rows = await db.select({ id: medicinePrescriptions.id, img: medicinePrescriptions.imageUrl }).from(medicinePrescriptions).where(old(t, cutoff)).limit(BATCH);
          if (!rows.length) return 0;
          await db
            .update(medicinePrescriptions)
            .set({ patientName: "Removed", patientAge: null, patientPhone: null, patientAddress: null, imageUrl: null, note: null })
            .where(inArray(medicinePrescriptions.id, rows.map((r) => r.id)));
          await removeUploads(db, deps.uploads, t, rows.map((r) => r.img));
          return rows.length;
        },
      } satisfies Cat;
    })(),
    (() => {
      const lapsed = (tenantId: string, cutoff: Date) =>
        and(
          eq(membershipMembers.tenantId, tenantId),
          lt(membershipMembers.createdAt, cutoff),
          ne(membershipMembers.name, "Erased member"),
          sql`not exists (select 1 from ${membershipSubscriptions} s where s.member_id = ${membershipMembers.id} and s.end_date >= ${dateOnly(cutoff)})`,
        );
      return {
        key: "lapsed_members",
        scope: "shop",
        defaultDays: 1095,
        minDays: 365,
        action: "anonymise",
        touches: ["membership_members", "files"],
        async count(s, cutoff) {
          const [r] = await db.select({ n: count() }).from(membershipMembers).where(lapsed(tid(s), cutoff));
          return Number(r?.n ?? 0);
        },
        async purge(s, cutoff) {
          const t = tid(s);
          const rows = await db.select({ id: membershipMembers.id, photo: membershipMembers.photoUrl }).from(membershipMembers).where(lapsed(t, cutoff)).limit(BATCH);
          if (!rows.length) return 0;
          await db.update(membershipMembers).set({ name: "Erased member", phone: null, notes: null, photoUrl: null }).where(inArray(membershipMembers.id, rows.map((r) => r.id)));
          await removeUploads(db, deps.uploads, t, rows.map((r) => r.photo));
          return rows.length;
        },
      } satisfies Cat;
    })(),
    (() => {
      // Pay runs, payslip lines and payments (accounting) stay; only the person's contact and ID numbers are cleared.
      const left = (tenantId: string, cutoff: Date) =>
        and(
          eq(payrollEmployees.tenantId, tenantId),
          isNotNull(payrollEmployees.leaveDate),
          lt(payrollEmployees.leaveDate, dateOnly(cutoff)),
          or(isNotNull(payrollEmployees.phone), isNotNull(payrollEmployees.accountNumber), isNotNull(payrollEmployees.pan), isNotNull(payrollEmployees.uan), isNotNull(payrollEmployees.esiNumber), isNotNull(payrollEmployees.upiId)),
        );
      return {
        key: "staff_after_exit",
        scope: "shop",
        defaultDays: 2920,
        minDays: 1095,
        action: "anonymise",
        touches: ["payroll_employees"],
        async count(s, cutoff) {
          const [r] = await db.select({ n: count() }).from(payrollEmployees).where(left(tid(s), cutoff));
          return Number(r?.n ?? 0);
        },
        async purge(s, cutoff) {
          const rows = await db
            .update(payrollEmployees)
            .set({ phone: null, bankName: null, accountNumber: null, ifsc: null, upiId: null, uan: null, esiNumber: null, pan: null, notes: null })
            .where(left(tid(s), cutoff))
            .returning({ id: payrollEmployees.id });
          return rows.length;
        },
      } satisfies Cat;
    })(),
    {
      key: "kyc_documents",
      scope: "shop",
      defaultDays: 1825,
      minDays: 365,
      action: "delete",
      touches: ["kyc_documents", "files"],
      async count(s, cutoff) {
        const [r] = await db.select({ n: count() }).from(kycDocuments).where(and(eq(kycDocuments.tenantId, tid(s)), lt(kycDocuments.createdAt, cutoff)));
        return Number(r?.n ?? 0);
      },
      async purge(s, cutoff) {
        const t = tid(s);
        const rows = await db.delete(kycDocuments).where(and(eq(kycDocuments.tenantId, t), lt(kycDocuments.createdAt, cutoff))).returning({ url: kycDocuments.fileUrl });
        await removeUploads(db, deps.uploads, t, rows.map((r) => r.url));
        return rows.length;
      },
    },
    // Another job already does these; shown so the owner sees every period in one place.
    { key: "ai_run_inputs", scope: "shop", defaultDays: 7, minDays: 7, action: "anonymise", touches: ["ai_runs"], managedBy: { job: "ai.purge-debug", days: 7 } },
    // ---- platform
    {
      key: "otp_logs",
      scope: "platform",
      defaultDays: 30,
      minDays: 1,
      action: "delete",
      touches: ["auth_otps"],
      async count(_s, cutoff) {
        const [r] = await db.select({ n: count() }).from(authOtps).where(lt(authOtps.createdAt, cutoff));
        return Number(r?.n ?? 0);
      },
      async purge(_s, cutoff) {
        const rows = await db.delete(authOtps).where(lt(authOtps.createdAt, cutoff)).returning({ id: authOtps.id });
        return rows.length;
      },
    },
    {
      key: "login_sessions",
      scope: "platform",
      defaultDays: 180,
      minDays: 30,
      action: "delete",
      touches: ["auth_sessions"],
      async count(_s, cutoff) {
        const [r] = await db.select({ n: count() }).from(authSessions).where(or(lt(authSessions.expiresAt, cutoff), lt(authSessions.revokedAt, cutoff)));
        return Number(r?.n ?? 0);
      },
      async purge(_s, cutoff) {
        const rows = await db.delete(authSessions).where(or(lt(authSessions.expiresAt, cutoff), lt(authSessions.revokedAt, cutoff))).returning({ id: authSessions.id });
        return rows.length;
      },
    },
    { key: "audit_log", scope: "platform", defaultDays: 400, minDays: 400, action: "delete", touches: ["audit_events"], managedBy: { job: "audit.purge", days: 400 } },
    { key: "data_exports", scope: "platform", defaultDays: 7, minDays: 7, action: "delete", touches: ["data_requests"], managedBy: { job: "consent.sweep", days: 7 } },
  ];
  return cats;
}

/** Registers handlers and categories on the services (called once by the kit). */
export function wirePrivacy(deps: { db: Db; uploads: () => UploadsService; rights: RightsService; retention: RetentionService }) {
  for (const h of createSubjectHandlers(deps)) deps.rights.registerHandler(h);
  for (const c of createRetentionCategories(deps)) deps.retention.register(c);
}
