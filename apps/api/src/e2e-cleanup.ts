import type { Logger } from "pino";
import type { Kit } from "./kit";
import { STORE_PRODUCTS } from "./seed-fixtures";

/**
 * Removal of data the end-to-end scripts left in a shop, identified only by the markers those scripts used:
 *
 * - names starting with "E2E " (products, categories, collections, customers, orders, bills, locations, expense
 *   vendors, shoppers) and coupon codes starting with "E2E";
 * - the fixed people of the billing smoke scripts (Meena Sundaram +919876522222, Online buyer +919876533333,
 *   Anil Kumar +919895012345, the "Walk-in Customer" smoke bills, supplier Erode Handlooms +919876511111);
 * - test phone numbers (+91 98000 001xx/002xx of batch 1, +91 9999 0xxxxx of the e2e shops), the `e2e-cashier` role,
 * - storefront browser-test shoppers: "Test Shopper" accounts and their orders, and the never-named, never-ordering
 *   sign-ins the old version of that test left (+91 906… numbers made from the clock, no name, no email);
 *   `e2e-*.example.com` domains, analytics sessions with anonymous ids ending in "-e2e";
 * - stock: the smoke "Opening count" additions are taken back out, and demo store variants (AK/CP/KS SKUs) that
 *   e2e runs topped up go back to their seeded opening stock.
 *
 * Issued bills and orders are cancelled, never deleted (numbers stay continuous); drafts, carts, unused coupons,
 * reviews, addresses and wishlists of test shoppers are deleted; products are soft-deleted and archived.
 * Re-running finds nothing new to change.
 */

const BILLING_SMOKE_PHONES = ["+919876522222", "+919876533333", "+919895012345"];
const BILLING_SMOKE_NAMES = ["Meena Sundaram", "Online buyer", "Anil Kumar"];
/** Line descriptions of the old billing smoke "Walk-in" bills. */
const WALK_IN_SMOKE_LINES = ["Silk saree", "Cotton shirting fabric", "Blouse stitching"];
const SMOKE_SUPPLIER = { name: "Erode Handlooms", phone: "+919876511111" };
/** Test phones as SQL LIKE patterns: batch 1 staff/buyers and the e2e test identities. */
const TEST_PHONE_LIKE = ["+91980000010_", "+91980000020_", "+9199990%"];
/** Name the storefront browser test (apps/store/test/e2e.cjs) gives its shopper. */
const BROWSER_TEST_SHOPPER = "Test Shopper";
/** Clock-made phones of the old storefront browser test (`9` + last 9 digits of Date.now() → +91 906…). */
const OLD_BROWSER_TEST_PHONE_LIKE = "+91906%";
/** Stock notes of e2e adjustments that changed demo items. */
const SMOKE_STOCK_NOTE = "Opening count";
const CLEANUP_NOTE = "Test data cleanup";

export type CleanupSummary = Record<string, number>;

type Row = Record<string, unknown>;

export class E2eCleanup {
  readonly summary: CleanupSummary = {};
  readonly problems: string[] = [];

  constructor(
    private readonly kit: Kit,
    private readonly tenantId: string,
    private readonly log: Logger,
    private readonly dryRun = false,
  ) {}

  private q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    // The postgres-js client drizzle wraps (parameterised raw SQL; apps/api has no direct drizzle-orm dependency).
    const client = (this.kit.db as unknown as { $client: { unsafe(text: string, params: unknown[]): Promise<unknown[]> } }).$client;
    return client.unsafe(text, params) as Promise<T[]>;
  }

  private count(key: string, n = 1) {
    if (n) this.summary[key] = (this.summary[key] ?? 0) + n;
  }

  /** Runs one change; failures are collected instead of stopping the cleanup. */
  private async apply(key: string, what: string, fn: () => Promise<unknown>) {
    if (this.dryRun) return this.count(key);
    try {
      await fn();
      this.count(key);
    } catch (err) {
      this.problems.push(`${what}: ${(err as Error).message}`);
    }
  }

  async run(): Promise<CleanupSummary> {
    await this.findTestShoppers();
    await this.orders();
    await this.customersAndBills();
    await this.suppliers();
    await this.coupons();
    await this.storeShoppers();
    await this.products();
    await this.locations();
    await this.staff();
    await this.expenses();
    await this.analytics();
    await this.domains();
    await this.stock();
    return this.summary;
  }

  // ---------------------------------------------------------------- orders

  private testOrderIds = new Set<string>();
  /** Store accounts (store_customers) of test shoppers, found before their orders are cancelled. */
  private testShoppers: { id: string; user_id: string }[] = [];

  async findTestShoppers() {
    this.testShoppers = await this.q<{ id: string; user_id: string }>(
      `select c.id, c.user_id from store_customers c
        where c.tenant_id = $1
          and (c.name like 'E2E %' or c.name = $3 or c.phone like any($2::text[])
            or (coalesce(c.name, '') = '' and c.email is null and c.phone like $4
              and not exists (select 1 from orders o where o.tenant_id = c.tenant_id and o.customer->>'accountId' = c.id::text
                and coalesce(o.customer->>'name', '') <> $3)))`,
      [this.tenantId, TEST_PHONE_LIKE, BROWSER_TEST_SHOPPER, OLD_BROWSER_TEST_PHONE_LIKE],
    );
    return this.testShoppers;
  }

  async orders() {
    const t = this.tenantId;
    const rows = await this.q<{ id: string; number: string; status: string; invoice_id: string | null; invoice_status: string | null }>(
      `select o.id, o.number, o.status, o.invoice_id, i.status as invoice_status
         from orders o left join invoices i on i.id = o.invoice_id
        where o.tenant_id = $1
          and (o.customer->>'name' like 'E2E %' or o.customer->>'phone' like any($2::text[])
            or o.customer->>'name' = $3 or o.customer->>'accountId' = any($4::text[]))`,
      [t, TEST_PHONE_LIKE, BROWSER_TEST_SHOPPER, this.testShoppers.map((s) => s.id)],
    );
    for (const o of rows) {
      this.testOrderIds.add(o.id);
      if (["placed", "confirmed", "packed"].includes(o.status)) {
        await this.apply("orders cancelled", `order ${o.number}`, () =>
          this.kit.orders.service.updateStatus(t, o.id, { status: "cancelled", note: CLEANUP_NOTE }),
        );
      } else if (!["cancelled", "returned"].includes(o.status)) {
        // Shipped/delivered test orders can't be cancelled through the order flow: mark them cancelled directly
        // (stock was committed against test or demo variants, which stock() resets) and release their coupon.
        await this.apply("orders cancelled (were shipped/delivered)", `order ${o.number}`, async () => {
          await this.q(
            `update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = $3, updated_at = now() where tenant_id = $1 and id = $2`,
            [t, o.id, CLEANUP_NOTE],
          );
          await this.q(
            `insert into order_events (tenant_id, order_id, type, from_status, to_status, message, data) values ($1, $2, 'status', $3, 'cancelled', $4, '{}'::jsonb)`,
            [t, o.id, o.status, CLEANUP_NOTE],
          );
          await this.kit.coupons.service.release(t, "order", o.id);
          await this.kit.inventory.service.release(t, "order", o.id);
        });
      }
      if (o.invoice_id && o.invoice_status && !["cancelled", "draft"].includes(o.invoice_status)) {
        await this.apply("order bills cancelled", `bill of order ${o.number}`, () => this.kit.invoices.service.cancel(t, o.invoice_id!, CLEANUP_NOTE));
      }
    }
  }

  // ---------------------------------------------------------------- billing customers and bills

  async customersAndBills() {
    const t = this.tenantId;
    const customers = await this.q<{ id: string; name: string }>(
      `select id, name from billing_customers
        where tenant_id = $1 and deleted_at is null
          and (name like 'E2E %' or phone = any($2::text[]) or phone like any($3::text[]))`,
      [t, BILLING_SMOKE_PHONES, TEST_PHONE_LIKE],
    );
    const ids = customers.map((c) => c.id);
    // Receipts first: deleting one takes its amounts back off the bills, so cancelling the bills leaves no advance.
    const receipts = ids.length
      ? await this.q<{ id: string; customer_id: string }>(`select id, customer_id from customer_receipts where tenant_id = $1 and customer_id = any($2::uuid[])`, [t, ids])
      : [];
    for (const r of receipts) {
      await this.apply("receipts deleted", `receipt ${r.id}`, () => this.kit.invoices.service.deleteReceipt(t, r.customer_id, r.id));
    }

    const bills = await this.q<{ id: string; number: string | null; status: string; customer: { name?: string }; lines: { description?: string }[] }>(
      `select id, number, status, customer, lines from invoices
        where tenant_id = $1 and status <> 'cancelled'
          and (customer_id = any($2::uuid[])
            or customer->>'name' like 'E2E %'
            or customer->>'name' = any($3::text[])
            or customer->>'phone' = any($4::text[])
            or customer->>'phone' like any($5::text[])
            or customer->>'name' in ('Walk-in', 'Walk-in Customer', 'X'))`,
      [t, ids, BILLING_SMOKE_NAMES, BILLING_SMOKE_PHONES, TEST_PHONE_LIKE],
    );
    for (const b of bills) {
      const name = b.customer?.name ?? "";
      // Walk-in bills only when every line is one of the smoke lines; "X" only as a smoke draft.
      if (["Walk-in", "Walk-in Customer"].includes(name) && !b.lines.every((l) => WALK_IN_SMOKE_LINES.includes(l.description ?? ""))) continue;
      if (name === "X" && b.status !== "draft") continue;
      if (b.status === "draft") {
        await this.apply("draft bills deleted", `draft ${b.id}`, () => this.kit.invoices.service.deleteDraft(t, b.id));
      } else {
        await this.apply("bills cancelled", `bill ${b.number}`, () => this.kit.invoices.service.cancel(t, b.id, CLEANUP_NOTE));
      }
    }
    for (const c of customers) {
      await this.apply("customers deleted", `customer ${c.name}`, () => this.kit.invoices.service.deleteCustomer(t, c.id));
    }
  }

  // ---------------------------------------------------------------- suppliers and purchases

  async suppliers() {
    const t = this.tenantId;
    const sups = await this.q<{ id: string; name: string }>(
      `select id, name from suppliers where tenant_id = $1 and deleted_at is null and ((name = $2 and phone = $3) or name like 'E2E %')`,
      [t, SMOKE_SUPPLIER.name, SMOKE_SUPPLIER.phone],
    );
    if (sups.length === 0) return;
    const purchases = await this.q<{ id: string; bill_number: string | null }>(
      `select id, bill_number from purchases where tenant_id = $1 and supplier_id = any($2::uuid[]) and status <> 'cancelled'`,
      [t, sups.map((s) => s.id)],
    );
    for (const p of purchases) {
      await this.apply("purchases cancelled", `purchase ${p.bill_number}`, () => this.kit.inventory.service.cancelPurchase(t, p.id));
    }
    for (const s of sups) await this.apply("suppliers deleted", `supplier ${s.name}`, () => this.kit.inventory.service.deleteSupplier(t, s.id));
  }

  // ---------------------------------------------------------------- coupons

  async coupons() {
    const t = this.tenantId;
    const orderIds = [...this.testOrderIds];
    if (orderIds.length) {
      // Redemptions by test orders (all released or cancelled above), so WELCOME10 shows no test usage.
      const n = this.dryRun
        ? (await this.q(`select 1 from coupon_redemptions where tenant_id = $1 and ref_type = 'order' and ref_id::text = any($2::text[])`, [t, orderIds])).length
        : (await this.q(`delete from coupon_redemptions where tenant_id = $1 and ref_type = 'order' and ref_id::text = any($2::text[]) returning id`, [t, orderIds])).length;
      this.count("coupon redemptions by test orders deleted", n);
    }
    const codes = await this.q<{ id: string; code: string }>(`select id, code from coupons where tenant_id = $1 and code like 'E2E%'`, [t]);
    for (const c of codes) {
      await this.apply("coupons deleted", `coupon ${c.code}`, async () => {
        try {
          await this.kit.coupons.service.remove(t, c.id);
        } catch (err) {
          // Used by an order that isn't a test order: keep it, switched off.
          await this.kit.coupons.service.update(t, c.id, { active: false });
          this.count("coupons switched off (used)");
          this.log.warn({ code: c.code, err: (err as Error).message }, "cleanup: coupon kept, switched off");
        }
      });
    }
  }

  // ---------------------------------------------------------------- store shoppers, reviews, carts

  async storeShoppers() {
    const t = this.tenantId;
    const shoppers = this.testShoppers.length ? this.testShoppers : await this.findTestShoppers();
    const reviews = await this.q<{ id: string }>(
      `select id from product_reviews where tenant_id = $1 and (author_name like 'E2E%' or author_name = $3 or user_id = any($2::uuid[]))`,
      [t, shoppers.map((s) => s.user_id), BROWSER_TEST_SHOPPER],
    );
    for (const r of reviews) await this.apply("reviews deleted", `review ${r.id}`, () => this.kit.reviews.service.remove(t, r.id));
    if (shoppers.length === 0) return;
    // "Helpful" votes test shoppers left on other reviews.
    const userIds = shoppers.map((s) => s.user_id);
    const votes = this.dryRun
      ? (await this.q(`select 1 from review_votes where tenant_id = $1 and user_id = any($2::uuid[])`, [t, userIds])).length
      : (await this.q(`delete from review_votes where tenant_id = $1 and user_id = any($2::uuid[]) returning id`, [t, userIds])).length;
    this.count("review votes deleted", votes);
    const ids = shoppers.map((s) => s.id);
    for (const [table, key] of [
      ["store_carts", "carts deleted"],
      ["store_addresses", "shopper addresses deleted"],
      ["store_wishlist", "wishlist entries deleted"],
    ] as const) {
      const n = this.dryRun
        ? (await this.q(`select 1 from ${table} where tenant_id = $1 and customer_id = any($2::uuid[])`, [t, ids])).length
        : (await this.q(`delete from ${table} where tenant_id = $1 and customer_id = any($2::uuid[]) returning id`, [t, ids])).length;
      this.count(key, n);
    }
    const n = this.dryRun ? ids.length : (await this.q(`delete from store_customers where tenant_id = $1 and id = any($2::uuid[]) returning id`, [t, ids])).length;
    this.count("test shoppers deleted", n);
  }

  // ---------------------------------------------------------------- catalogue

  async products() {
    const t = this.tenantId;
    const products = await this.q<{ id: string; name: string }>(
      `select id, name from catalog_products where tenant_id = $1 and deleted_at is null and name like 'E2E %'`,
      [t],
    );
    for (const p of products) {
      await this.apply("products deleted (archived)", `product ${p.name}`, () => this.kit.catalogue.service.deleteProduct(t, p.id));
    }
    // Children before parents; only categories left without live products.
    const cats = await this.q<{ id: string; name: string }>(
      `select id, name from catalog_categories c where tenant_id = $1 and name like 'E2E %'
        order by (select count(*) from catalog_categories k where k.parent_id = c.id)`,
      [t],
    );
    for (const c of cats) await this.apply("categories deleted", `category ${c.name}`, () => this.kit.catalogue.service.deleteCategory(t, c.id));
    const cols = await this.q<{ id: string; name: string }>(`select id, name from catalog_collections where tenant_id = $1 and name like 'E2E %'`, [t]);
    for (const c of cols) await this.apply("collections deleted", `collection ${c.name}`, () => this.kit.catalogue.service.deleteCollection(t, c.id));
  }

  /** Only the test products and their categories (the e2e seed uses this to keep e2e shops' lists short). */
  async productsOnly() {
    await this.products();
    return this.summary;
  }

  // ---------------------------------------------------------------- inventory locations

  async locations() {
    const t = this.tenantId;
    const locs = await this.q<{ id: string; name: string }>(
      `select id, name from stock_locations where tenant_id = $1 and name like 'E2E %' and active and not is_default`,
      [t],
    );
    // They hold history (transfers), so they are switched off rather than deleted.
    for (const l of locs) await this.apply("locations deactivated", `location ${l.name}`, () => this.kit.inventory.service.updateLocation(t, l.id, { active: false }));
  }

  // ---------------------------------------------------------------- staff

  async staff() {
    const t = this.tenantId;
    const tenant = await this.kit.tenancy.service.getRef(t);
    if (!tenant) return;
    const members = await this.q<{ user_id: string; phone: string }>(
      `select m.user_id, u.phone from tenant_memberships m join users u on u.id = m.user_id
        where m.tenant_id = $1 and u.phone like any($2::text[]) and not ('owner' = any(m.roles))`,
      [t, TEST_PHONE_LIKE],
    );
    const [owner] = await this.q<{ user_id: string }>(`select user_id from tenant_memberships where tenant_id = $1 and 'owner' = any(roles) limit 1`, [t]);
    if (!owner && members.length) return void this.problems.push("staff: shop has no owner to act as");
    const actor = { userId: owner?.user_id ?? "", level: "owner" as const };
    for (const m of members) await this.apply("test staff removed", `member ${m.phone}`, () => this.kit.staff.service.removeMember(tenant, m.user_id, actor));
    const roles = await this.q<{ key: string }>(`select key from tenant_roles where tenant_id = $1 and key like 'e2e-%' and not builtin`, [t]);
    for (const r of roles) await this.apply("test roles deleted", `role ${r.key}`, () => this.kit.staff.service.deleteRole(t, r.key));
  }

  // ---------------------------------------------------------------- expenses

  async expenses() {
    const t = this.tenantId;
    const rows = await this.q<{ id: string }>(`select id from expenses where tenant_id = $1 and vendor_name like 'E2E %' and status <> 'cancelled'`, [t]);
    for (const e of rows) await this.apply("expenses cancelled", `expense ${e.id}`, () => this.kit.expenses.service.cancel(t, e.id));
  }

  // ---------------------------------------------------------------- analytics

  async analytics() {
    const t = this.tenantId;
    const days = await this.q<{ d: string; n: number }>(
      `select to_char((at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as d, count(*)::int as n
         from analytics_events where tenant_id = $1 and anonymous_id like '%-e2e' group by 1`,
      [t],
    );
    if (days.length === 0) return;
    this.count("analytics events deleted", days.reduce((s, d) => s + d.n, 0));
    if (this.dryRun) return;
    await this.q(`delete from analytics_events where tenant_id = $1 and anonymous_id like '%-e2e'`, [t]);
    // Rebuild those days' rollups from what is left.
    for (const d of days) await this.apply("analytics days re-rolled", `rollup ${d.d}`, () => this.kit.analytics.service.rollupDay(t, d.d));
  }

  // ---------------------------------------------------------------- custom domains

  async domains() {
    const t = this.tenantId;
    const rows = await this.q<{ id: string; domain: string }>(
      `select id, domain from tenant_domains where tenant_id = $1 and (domain like 'e2e-%.example.com' or domain like 'k-e2e-%.example.com')`,
      [t],
    );
    for (const d of rows) await this.apply("test domains removed", `domain ${d.domain}`, () => this.kit.tenancy.service.removeDomain(t, d.id));
  }

  // ---------------------------------------------------------------- stock of demo items

  async stock() {
    const t = this.tenantId;
    // Billing smoke: "Opening count" additions (mode add) on demo items are taken back out.
    const added = await this.q<{ item_id: string; name: string; delta: string }>(
      `select m.item_id, p.name, sum(m.delta)::text as delta
         from stock_movements m join catalog_variants v on v.id = m.item_id join catalog_products p on p.id = v.product_id
        where m.tenant_id = $1 and m.note = $2 and m.reason in ('adjustment', 'opening') and p.name not like 'E2E %'
          and not exists (select 1 from stock_movements c where c.tenant_id = m.tenant_id and c.item_id = m.item_id and c.note = $3)
        group by 1, 2`,
      [t, SMOKE_STOCK_NOTE, `${CLEANUP_NOTE}: smoke stock taken out`],
    );
    for (const a of added) {
      const level = await this.kit.inventory.service.getStock(t, a.item_id);
      const qty = Math.max(0, Number(level.qty) - Number(a.delta));
      await this.apply("demo stock reset", `stock of ${a.name}`, () =>
        this.kit.inventory.service.adjust(t, a.item_id, { mode: "set", qty, note: `${CLEANUP_NOTE}: smoke stock taken out` }),
      );
    }
    // Billing smoke set a reorder level of 8 on Cotton saree; the demo has none.
    const reorder = await this.q<{ item_id: string }>(
      `select s.item_id from stock_items s join catalog_variants v on v.id = s.item_id join catalog_products p on p.id = v.product_id
        where s.tenant_id = $1 and p.name = 'Cotton saree' and s.reorder_level = 8`,
      [t],
    );
    for (const r of reorder) await this.apply("reorder levels reset", "reorder level", () => this.kit.inventory.service.updateStock(t, r.item_id, { reorderLevel: 0 }));

    // Store demo variants (seeded with "Opening stock (seed)") that e2e runs changed go back to their opening stock.
    const opening = new Map<string, number>();
    for (const p of STORE_PRODUCTS) {
      if (p.sizes.length) for (const s of p.sizes) opening.set(`${p.skuPrefix}-${s}`, p.stock);
      else opening.set(`${p.skuPrefix}-1`, p.stock);
    }
    const demo = await this.q<{ id: string; sku: string; name: string }>(
      `select v.id, v.sku, p.name from catalog_variants v join catalog_products p on p.id = v.product_id
        where v.tenant_id = $1 and v.deleted_at is null and v.sku = any($2::text[]) and 'demo' = any(p.tags)
          and exists (select 1 from stock_movements m where m.tenant_id = v.tenant_id and m.item_id = v.id and m.note like 'E2E %')`,
      [t, [...opening.keys()]],
    );
    for (const v of demo) {
      const level = await this.kit.inventory.service.getStock(t, v.id);
      const want = opening.get(v.sku)!;
      if (Number(level.qty) === want && Number(level.reserved) === 0) continue;
      await this.apply("demo stock reset", `stock of ${v.name} ${v.sku}`, () =>
        this.kit.inventory.service.adjust(t, v.id, { mode: "set", qty: want, note: `${CLEANUP_NOTE}: back to the demo opening stock` }),
      );
    }
  }
}
