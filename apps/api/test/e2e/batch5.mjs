// Batch 5 end-to-end (docs/batch5.md "E2E") against the running API (http://localhost:4000) and the real database.
//   node test/e2e/batch5.mjs        (test:e2e:all seeds and runs every script)
// Needs the API in development: test OTP (TEST_OTP_CODE / TEST_OTP_TARGETS), no PLATFORM_RAZORPAY_* (mock provider)
// and Chrome for the invoice PDF. Every run signs up fresh throwaway shops `e2e-su…-<run>` owned by new
// `e2e-su…-<run>@example.com` test identities; `pnpm --filter @srirealtime/api cleanup:e2e-data` deletes them. The
// lifecycle job runs through the dev-only `POST /v1/subscriptions/mock/lifecycle` for one shop with a clock override,
// so no other shop is touched. The super-admin steps use e2e-owner@example.com (made super-admin by seed:e2e).
import { createHmac } from "node:crypto";
import { call, eq, expect, fails, ok, OWNER, results, RUN, signIn, step, testPhone, tokens, waitForApi } from "./b3/lib.mjs";

const run = RUN.toLowerCase();
const SHOP1 = `e2e-su-${run}`; // BL, Tamil Nadu: trial → pro → paid (CGST+SGST) → failed → expired (free)
const SHOP2 = `e2e-su2-${run}`; // EC, Karnataka: pro (IGST) → downgrade to starter → cancel/resume → cancelled
const SHOP3 = `e2e-su3-${run}`; // owner 1's second shop: no second trial; comp by super-admin
const SHOP4 = `e2e-su4-${run}`; // owner 2's second shop (Tamil Nadu): paid starter → upgrades that wait for payment, with credit
const OWNER1 = `e2e-su-${run}@example.com`;
const OWNER2 = `e2e-su2-${run}@example.com`;
const MOCK_WEBHOOK_SECRET = "mock_webhook_secret";
const GSTIN_TN = "33AABFR1234K1ZI";

const PRO_MONTHLY = 149_900;
const STARTER_MONTHLY = 49_900;
const charge = (p) => p + Math.round((p * 18) / 100);
const sub = (path) => `/v1/subscriptions${path}`;
const as1 = (tenant) => ({ as: "su1", tenant });
const as2 = (tenant) => ({ as: "su2", tenant });
const later = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

await waitForApi();
await signIn("owner", OWNER);
await signIn("su1", OWNER1, null, "E2E Signup One");
await signIn("su2", OWNER2, null, "E2E Signup Two");

const ctx = {};

// ---------------------------------------------------------------- slug check
await step("slug check: taken, reserved, invalid and free addresses (with suggestions)", async () => {
  const taken = ok(await call("GET", "/v1/tenancy/slug-available?slug=e2e-bill", undefined, { as: null, tenant: null }), "taken");
  eq(taken.available, false, "taken available");
  eq(taken.code, "taken", "taken code");
  expect(taken.suggestions.length > 0 && taken.suggestions.every((s) => s !== "e2e-bill"), `suggestions ${JSON.stringify(taken.suggestions)}`);
  const sugg = ok(await call("GET", `/v1/tenancy/slug-available?slug=${taken.suggestions[0]}`, undefined, { as: null, tenant: null }), "suggestion");
  eq(sugg.available, true, "a suggestion is free");
  const reserved = ok(await call("GET", "/v1/tenancy/slug-available?slug=admin", undefined, { as: null, tenant: null }), "reserved");
  eq(reserved.code, "reserved", "reserved code");
  const bad = ok(await call("GET", "/v1/tenancy/slug-available?slug=AB", undefined, { as: null, tenant: null }), "invalid");
  eq(bad.available, false, "invalid");
  const city = ok(await call("GET", "/v1/tenancy/slug-available?slug=e2e-bill&city=Madurai", undefined, { as: null, tenant: null }), "city");
  expect(city.suggestions.includes("e2e-bill-madurai"), `city suggestion ${JSON.stringify(city.suggestions)}`);
  const free = ok(await call("GET", `/v1/tenancy/slug-available?slug=${SHOP1}`, undefined, { as: null, tenant: null }), "free");
  eq(free.available, true, "free");
  return `suggestions ${taken.suggestions.join(", ")}`;
});

// ---------------------------------------------------------------- sign-up
const signupBody = (over = {}) => ({
  shopName: `E2E Signup ${RUN}`,
  slug: SHOP1,
  appId: "BL",
  planId: "starter",
  interval: "monthly",
  businessType: "textiles",
  state: "33",
  gstin: GSTIN_TN,
  phone: testPhone(5),
  ...over,
});

await step("sign-up refuses anonymous callers, a GSTIN of another state and a reserved address", async () => {
  fails(await call("POST", "/v1/signup", signupBody(), { as: null, tenant: null }), 401, "unauthorized", "anonymous");
  const gst = fails(await call("POST", "/v1/signup", signupBody({ state: "29" }), { as: "su1", tenant: null }), 400, null, "gstin state");
  eq(gst.error.details?.field, "gstin", "gstin field");
  fails(await call("POST", "/v1/signup", signupBody({ slug: "admin" }), { as: "su1", tenant: null }), 400, "invalid_slug", "reserved");
  fails(await call("POST", "/v1/signup", signupBody({ planId: "enterprise" }), { as: "su1", tenant: null }), 400, null, "private plan");
});

await step("sign-up (BL, starter, Tamil Nadu) creates the shop, a 14-day trial, defaults and a handoff", async () => {
  const r = ok(await call("POST", "/v1/signup", signupBody(), { as: "su1", tenant: null }), "signup");
  eq(r.tenant.slug, SHOP1, "slug");
  eq(r.tenant.appId, "BL", "app");
  eq(r.tenant.planId, "starter", "tenant plan");
  eq(r.trial, true, "trial");
  expect(r.appUrl.includes(SHOP1), `appUrl ${r.appUrl}`);
  expect(typeof r.handoff?.code === "string" && r.handoff.code.length >= 16, "handoff code");
  expect(r.loginUrl.includes("/login?handoff="), `loginUrl ${r.loginUrl}`);
  ctx.shop1 = r.tenant;
  ctx.handoff1 = r.handoff.code;
  const dup = fails(await call("POST", "/v1/signup", signupBody(), { as: "su1", tenant: null }), 409, "slug_taken", "duplicate");
  expect(dup.error.details?.suggestions?.length > 0, "duplicate suggestions");
  return `${r.appUrl} (trial ends ${r.subscription.trialEndsAt})`;
});

await step("handoff: redeem once for a session on the shop's origin; a second redeem fails", async () => {
  const r = ok(await call("POST", "/v1/auth/handoff/redeem", { code: ctx.handoff1 }, { as: null, tenant: null }), "redeem");
  expect(typeof r.token === "string" && r.token !== tokens.su1, "new session token");
  eq(r.user.email, OWNER1, "user");
  fails(await call("POST", "/v1/auth/handoff/redeem", { code: ctx.handoff1 }, { as: null, tenant: null }), 400, "invalid_handoff", "second redeem");
  fails(await call("POST", "/v1/auth/handoff/redeem", { code: "x".repeat(30) }, { as: null, tenant: null }), 400, "invalid_handoff", "unknown code");
  fails(await call("POST", "/v1/auth/handoff", {}, { as: null, tenant: null }), 401, "unauthorized", "anonymous create");
  tokens.su1b = r.token;
  const me = ok(await call("GET", "/v1/auth/me", undefined, { as: "su1b", tenant: SHOP1 }), "me on the shop");
  expect(me.tenantRoles.includes("owner"), "owner in the shop");
  // "Open my shop": a handoff for one of the user's shops names its login URL; others are refused.
  const h = ok(await call("POST", "/v1/auth/handoff", { tenantId: ctx.shop1.id }, { as: "su1", tenant: null }), "handoff for shop");
  expect(h.url?.includes(`${SHOP1}.`) && h.url.includes("/login?handoff="), `handoff url ${h.url}`);
  fails(await call("POST", "/v1/auth/handoff", { tenantId: ctx.shop1.id }, { as: "su2", tenant: null }), 404, "not_found", "not a member");
});

await step("new shop works at once: business profile, branding, features (Plan & billing on), onboarding", async () => {
  const billing = ok(await call("GET", "/v1/settings/billing", undefined, as1(SHOP1)), "billing settings");
  const b = billing.values ?? billing;
  eq(b.legalName, `E2E Signup ${RUN}`, "legal name");
  eq(b.stateCode, "33", "state");
  eq(b.gstin, GSTIN_TN, "gstin");
  const brand = ok(await call("GET", "/v1/branding", undefined, { as: null, tenant: SHOP1 }), "branding");
  eq(brand.appName, `E2E Signup ${RUN}`, "brand name");
  const f = ok(await call("GET", "/v1/features", undefined, as1(SHOP1)), "features");
  expect(f.enabled.includes("subscriptions"), "subscriptions feature on");
  eq(f.planId, "starter", "features plan");
  const onb = ok(await call("GET", "/v1/onboarding", undefined, as1(SHOP1)), "onboarding");
  const profile = (onb.steps ?? onb.items ?? []).find((s) => s.key === "business-profile");
  expect(!profile || profile.done === true, `business-profile step ${JSON.stringify(profile)}`);
  ok(await call("GET", "/v1/invoices/summary", undefined, as1(SHOP1)), "billing dashboard summary");
});

await step("trial state: GET /current", async () => {
  const c = ok(await call("GET", sub("/current"), undefined, as1(SHOP1)), "current");
  eq(c.subscription.status, "trialing", "status");
  eq(c.subscription.planId, "starter", "plan");
  eq(c.plan.id, "starter", "plan object");
  eq(c.trialDaysLeft, 14, "trial days");
  eq(c.canTrial, false, "no second trial");
  expect(Array.isArray(c.usage) && c.usage.some((u) => u.key === "invoices_per_month"), "usage");
  ctx.trialEndsAt = c.subscription.trialEndsAt;
  fails(await call("GET", sub("/current"), undefined, { as: "su2", tenant: SHOP1 }), 403, null, "other user");
});

await step("change plan in the trial: starter → pro (no payment)", async () => {
  const r = ok(await call("POST", sub("/change"), { planId: "pro", interval: "monthly" }, as1(SHOP1)), "change");
  eq(r.applied, "now", "applied");
  eq(r.subscription.status, "trialing", "still trialing");
  eq(r.subscription.planId, "pro", "plan");
  const f = ok(await call("GET", "/v1/features", undefined, as1(SHOP1)), "features");
  eq(f.planId, "pro", "tenant plan follows");
  ok(await call("GET", "/v1/staff/members", undefined, as1(SHOP1)), "staff page on pro");
});

await step("checkout during the trial → mock mandate URL → authorise → active from the trial end", async () => {
  const r = ok(await call("POST", sub("/checkout"), { planId: "pro", interval: "monthly" }, as1(SHOP1)), "checkout");
  expect(r.authUrl.includes(`mockAuth=${r.providerSubscriptionId}`) && r.authUrl.includes(SHOP1), `authUrl ${r.authUrl}`);
  eq(r.provider, "mock", "provider");
  ctx.sub1 = r.providerSubscriptionId;
  const a = ok(await call("POST", sub("/mock/authorize"), { subscriptionId: ctx.sub1 }, { as: null, tenant: null }), "authorize");
  eq(a.subscription.status, "active", "active");
  eq(a.subscription.authUrl, null, "authUrl cleared");
  eq(a.subscription.currentPeriodStart, ctx.trialEndsAt, "period starts at the trial end");
  const again = ok(await call("POST", sub("/mock/authorize"), { subscriptionId: ctx.sub1 }, { as: null, tenant: null }), "authorize again");
  eq(again.outcome, "ignored: already active", "idempotent");
  fails(await call("POST", sub("/checkout"), { planId: "pro", interval: "monthly" }, as1(SHOP1)), 409, "conflict", "already paid");
});

await step("mock charge → paid platform invoice, intra-state GST (CGST + SGST), PDF", async () => {
  const r = ok(await call("POST", sub("/mock/charge"), { subscriptionId: ctx.sub1 }, { as: null, tenant: null }), "charge");
  const inv = r.invoice;
  expect(/^SR\/\d{4}-\d{2}\/\d{5}$/.test(inv.number), `number ${inv.number}`);
  eq(inv.status, "paid", "status");
  eq(inv.totalPaise, charge(PRO_MONTHLY), "total");
  eq(inv.subtotalPaise, PRO_MONTHLY, "subtotal");
  eq(inv.igstPaise, 0, "no IGST");
  eq(inv.cgstPaise + inv.sgstPaise, charge(PRO_MONTHLY) - PRO_MONTHLY, "CGST + SGST");
  eq(inv.cgstPaise, inv.sgstPaise, "even split");
  eq(inv.buyer.gstin, GSTIN_TN, "buyer GSTIN");
  ctx.invoice1 = inv;
  const list = ok(await call("GET", sub("/invoices"), undefined, as1(SHOP1)), "invoices");
  expect(list.items.some((i) => i.id === inv.id), "listed");
  const pdf = await call("GET", sub(`/invoices/${inv.id}.pdf`), undefined, { ...as1(SHOP1), binary: true });
  eq(pdf.status, 200, "pdf status");
  expect(pdf.headers.get("content-type")?.includes("application/pdf") && pdf.body.subarray(0, 4).toString() === "%PDF", "a PDF");
  fails(await call("GET", sub(`/invoices/${inv.id}.pdf`), undefined, { as: "owner", tenant: "e2e-bill" }), 404, "not_found", "other shop's invoice");
  return `${inv.number} ₹${(inv.totalPaise / 100).toFixed(2)} (CGST ${inv.cgstPaise}, SGST ${inv.sgstPaise})`;
});

await step("webhooks: wrong signature rejected; a signed event is applied once (dedup by event id)", async () => {
  const body = JSON.stringify({ event: "subscription.activated", payload: { subscription: { entity: { id: ctx.sub1, status: "active" } } } });
  const bad = await call("POST", sub("/webhooks/razorpay"), body, { as: null, tenant: null, headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef" } });
  fails(bad, 400, "invalid_signature", "wrong signature");
  const none = await call("POST", sub("/webhooks/razorpay"), body, { as: null, tenant: null, headers: { "content-type": "application/json" } });
  fails(none, 400, "invalid_signature", "no signature");
  const sig = createHmac("sha256", MOCK_WEBHOOK_SECRET).update(body).digest("hex");
  const eventId = `evt_e2e_${run}`;
  const headers = { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": eventId };
  const first = ok(await call("POST", sub("/webhooks/razorpay"), body, { as: null, tenant: null, headers }), "signed");
  eq(first.duplicate, false, "first delivery");
  const second = ok(await call("POST", sub("/webhooks/razorpay"), body, { as: null, tenant: null, headers }), "redelivery");
  eq(second.duplicate, true, "deduplicated");
});

await step("payment failure → past_due with 7 days' grace; the job expires it after the grace → free plan", async () => {
  const f = ok(await call("POST", sub("/mock/fail"), { subscriptionId: ctx.sub1 }, { as: null, tenant: null }), "fail");
  eq(f.subscription.status, "past_due", "past due");
  const grace = Date.parse(f.subscription.graceEndsAt) - Date.now();
  expect(grace > 6.9 * DAY && grace < 7.1 * DAY, `grace ${grace / DAY} days`);
  const c = ok(await call("GET", sub("/current"), undefined, as1(SHOP1)), "current");
  eq(c.graceDaysLeft, 7, "grace days left");
  // Before the grace ends nothing happens; after it, expired.
  const early = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop1.id, now: later(f.subscription.graceEndsAt, -HOUR) }, { as: "owner", tenant: null }), "job early");
  expect(!early.grace_expired, `early run ${JSON.stringify(early)}`);
  fails(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop1.id }, { as: "su1", tenant: null }), 403, "forbidden", "job is super-admin only");
  const r = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop1.id, now: later(f.subscription.graceEndsAt, HOUR) }, { as: "owner", tenant: null }), "job");
  eq(r.grace_expired, 1, "expired by the job");
  const again = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop1.id, now: later(f.subscription.graceEndsAt, 2 * HOUR) }, { as: "owner", tenant: null }), "job again");
  expect(!again.grace_expired, "idempotent");
  const after = ok(await call("GET", sub("/current"), undefined, as1(SHOP1)), "current after");
  eq(after.subscription.status, "expired", "expired");
  const feats = ok(await call("GET", "/v1/features", undefined, as1(SHOP1)), "features");
  eq(feats.planId, "free", "tenant on the free plan");
  expect(feats.enabled.includes("subscriptions"), "Plan & billing still on (free plan)");
});

await step("after expiry the free plan's limits apply: 402 plan_limit, data kept", async () => {
  const r = fails(await call("GET", "/v1/staff/members", undefined, as1(SHOP1)), 402, "plan_limit", "staff on free");
  eq(r.error.details?.reason, "plan", "reason plan");
  ok(await call("GET", sub("/invoices"), undefined, as1(SHOP1)), "invoices still listed");
  ok(await call("GET", sub("/current"), undefined, as1(SHOP1)), "plan page works on free");
});

await step("one trial per owner: the owner's second shop starts on the free plan", async () => {
  const r = ok(
    await call("POST", "/v1/signup", signupBody({ slug: SHOP3, shopName: `E2E Signup Three ${RUN}`, planId: "pro" }), { as: "su1", tenant: null }),
    "second shop",
  );
  eq(r.trial, false, "no trial");
  eq(r.tenant.planId, "free", "free plan");
  ctx.shop3 = r.tenant;
  const ch = ok(await call("POST", sub("/change"), { planId: "starter", interval: "monthly" }, as1(SHOP3)), "change on free");
  eq(ch.requiresCheckout, true, "payment needed");
  eq(ch.applied, "none", "not applied");
});

await step("sign-up in Karnataka (EC, pro) → pay → inter-state invoice with IGST only", async () => {
  const r = ok(
    await call(
      "POST",
      "/v1/signup",
      { shopName: `E2E Signup Two ${RUN}`, slug: SHOP2, appId: "EC", planId: "pro", interval: "monthly", state: "29", phone: testPhone(5) },
      { as: "su2", tenant: null },
    ),
    "signup 2",
  );
  eq(r.trial, true, "trial");
  ctx.shop2 = r.tenant;
  const co = ok(await call("POST", sub("/checkout"), { planId: "pro", interval: "monthly" }, as2(SHOP2)), "checkout");
  ctx.sub2 = co.providerSubscriptionId;
  ok(await call("POST", sub("/mock/authorize"), { subscriptionId: ctx.sub2 }, { as: null, tenant: null }), "authorize");
  const c = ok(await call("POST", sub("/mock/charge"), { subscriptionId: ctx.sub2 }, { as: null, tenant: null }), "charge");
  eq(c.invoice.igstPaise, charge(PRO_MONTHLY) - PRO_MONTHLY, "IGST");
  eq(c.invoice.cgstPaise + c.invoice.sgstPaise, 0, "no CGST/SGST");
  eq(c.invoice.placeOfSupply, "29", "place of supply");
  eq(c.subscription.status, "active", "active");
  ctx.periodEnd2 = c.subscription.currentPeriodEnd;
  const n1 = Number(ctx.invoice1.number.split("/")[2]);
  const n2 = Number(c.invoice.number.split("/")[2]);
  expect(n2 > n1, `series continues ${ctx.invoice1.number} → ${c.invoice.number}`);
  return c.invoice.number;
});

await step("downgrade pro → starter is pending until the period end, then applied by the job", async () => {
  const r = ok(await call("POST", sub("/change"), { planId: "starter", interval: "monthly" }, as2(SHOP2)), "downgrade");
  eq(r.applied, "period_end", "at period end");
  eq(r.subscription.pendingPlanId, "starter", "pending");
  eq(r.subscription.planId, "pro", "still pro");
  const early = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop2.id, now: later(ctx.periodEnd2, -HOUR) }, { as: "owner", tenant: null }), "early");
  expect(!early.apply_pending, "not yet");
  const j = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop2.id, now: later(ctx.periodEnd2, HOUR) }, { as: "owner", tenant: null }), "job");
  eq(j.apply_pending, 1, "applied");
  const c = ok(await call("GET", sub("/current"), undefined, as2(SHOP2)), "current");
  eq(c.subscription.planId, "starter", "starter now");
  eq(c.subscription.pendingPlanId, null, "pending cleared");
  eq(c.subscription.status, "active", "active");
  const f = ok(await call("GET", "/v1/features", undefined, as2(SHOP2)), "features");
  eq(f.planId, "starter", "tenant plan");
  ctx.periodEnd2b = c.subscription.currentPeriodEnd;
  expect(Date.parse(ctx.periodEnd2b) > Date.parse(ctx.periodEnd2), "next period");
});

await step("cancel → resume (new mandate) → cancel → cancelled at the period end → free", async () => {
  const c1 = ok(await call("POST", sub("/cancel"), {}, as2(SHOP2)), "cancel");
  eq(c1.subscription.cancelAtPeriodEnd, true, "cancel at period end");
  eq(c1.subscription.status, "active", "still active");
  const r = ok(await call("POST", sub("/resume"), {}, as2(SHOP2)), "resume");
  eq(r.subscription.cancelAtPeriodEnd, false, "resumed");
  expect(typeof r.authUrl === "string" && r.authUrl.includes("mockAuth="), "new mandate URL");
  fails(await call("POST", sub("/resume"), {}, as2(SHOP2)), 400, "bad_request", "nothing to resume");
  ok(await call("POST", sub("/cancel"), {}, as2(SHOP2)), "cancel again");
  const j = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop2.id, now: later(ctx.periodEnd2b, HOUR) }, { as: "owner", tenant: null }), "job");
  eq(j.period_end_cancel, 1, "cancelled by the job");
  const c = ok(await call("GET", sub("/current"), undefined, as2(SHOP2)), "current");
  eq(c.subscription.status, "cancelled", "cancelled");
  const f = ok(await call("GET", "/v1/features", undefined, as2(SHOP2)), "features");
  eq(f.planId, "free", "free plan");
  fails(await call("POST", sub("/cancel"), {}, as2(SHOP2)), 400, "bad_request", "nothing to cancel");
});

await step("trial reminders (3 days, 1 day) and trial end without a mandate → expired", async () => {
  // Owner 2's second shop has no trial; use a comp-free path instead: re-open a trial on shop 3 by super-admin.
  ok(await call("POST", sub(`/admin/${ctx.shop3.id}/comp`), { planId: "starter", until: null }, { as: "owner", tenant: null }), "comp starter");
  const ext = ok(await call("POST", sub(`/admin/${ctx.shop3.id}/extend-trial`), { days: 5 }, { as: "owner", tenant: null }), "trial re-opened");
  eq(ext.subscription.status, "trialing", "trialing");
  const end = ext.subscription.trialEndsAt;
  const d3 = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop3.id, now: later(end, -2.5 * DAY) }, { as: "owner", tenant: null }), "3-day");
  eq(d3.remind, 1, "3-day reminder");
  const d3b = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop3.id, now: later(end, -2.4 * DAY) }, { as: "owner", tenant: null }), "3-day again");
  expect(!d3b.remind, "sent once");
  const d1 = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop3.id, now: later(end, -0.5 * DAY) }, { as: "owner", tenant: null }), "1-day");
  eq(d1.remind, 1, "1-day reminder");
  const t = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop3.id, now: later(end, HOUR) }, { as: "owner", tenant: null }), "end");
  eq(t.trial_end, 1, "trial ended");
  const c = ok(await call("GET", sub("/current"), undefined, as1(SHOP3)), "current");
  eq(c.subscription.status, "expired", "expired");
});

// ---------------------------------------------------------------- upgrades wait for payment; proration credit
await step("paid starter (no trial left) → upgrade preview: credit for the unused days, GST on the net, applies after payment", async () => {
  const r = ok(
    await call("POST", "/v1/signup", { shopName: `E2E Signup Four ${RUN}`, slug: SHOP4, appId: "BL", planId: "starter", interval: "monthly", state: "33", phone: testPhone(5) }, { as: "su2", tenant: null }),
    "signup 4",
  );
  eq(r.trial, false, "no second trial");
  ctx.shop4 = r.tenant;
  const ch = ok(await call("POST", sub("/change"), { planId: "starter", interval: "monthly" }, as2(SHOP4)), "change on free");
  eq(ch.requiresCheckout, true, "free → paid still needs checkout");
  const pv0 = ok(await call("POST", sub("/change/preview"), { planId: "starter", interval: "monthly" }, as2(SHOP4)), "preview from free");
  eq(pv0.applies, "after_payment", "free → paid: after payment");
  eq(pv0.chargeTodayPaise, charge(STARTER_MONTHLY), "full price due");
  const co = ok(await call("POST", sub("/checkout"), { planId: "starter", interval: "monthly" }, as2(SHOP4)), "checkout");
  ok(await call("POST", sub("/mock/authorize"), { subscriptionId: co.providerSubscriptionId }, { as: null, tenant: null }), "authorize");
  const c = ok(await call("POST", sub("/mock/charge"), { subscriptionId: co.providerSubscriptionId }, { as: null, tenant: null }), "charge");
  eq(c.invoice.subtotalPaise, STARTER_MONTHLY, "starter paid");
  ctx.sub4 = co.providerSubscriptionId;

  // Same IST day as the period start: every day of it is unused, so the whole taxable value paid is credited.
  const pv = ok(await call("POST", sub("/change/preview"), { planId: "pro", interval: "monthly" }, as2(SHOP4)), "preview");
  eq(pv.kind, "upgrade", "kind");
  eq(pv.applies, "after_payment", "applies after payment");
  eq(pv.creditPaise, STARTER_MONTHLY, "credit = unused days / period days × paid");
  eq(pv.unusedDays, pv.periodDays, "all days unused");
  eq(pv.taxablePaise, PRO_MONTHLY - STARTER_MONTHLY, "credit reduces the taxable value");
  eq(pv.chargeTodayPaise, charge(PRO_MONTHLY - STARTER_MONTHLY), "GST on the net");
  eq(pv.gst.igstPaise, 0, "intra-state");
  eq(pv.gst.cgstPaise + pv.gst.sgstPaise, pv.chargeTodayPaise - pv.taxablePaise, "CGST + SGST");
  expect(Date.parse(pv.nextChargeAt) > Date.now() + 27 * DAY, `next charge ${pv.nextChargeAt}`);
  const dn = ok(await call("POST", sub("/change/preview"), { planId: "free", interval: "monthly" }, as2(SHOP4)), "preview downgrade");
  eq(dn.applies, "period_end", "downgrade at the period end");
  eq(dn.chargeTodayPaise, 0, "nothing due");
  ctx.preview4 = pv;
  return `credit ₹${(pv.creditPaise / 100).toFixed(2)}, due now ₹${(pv.chargeTodayPaise / 100).toFixed(2)}`;
});

await step("upgrade starter → pro is pending until paid: the plan stays starter; authorise applies it with a credit line", async () => {
  const r = ok(await call("POST", sub("/change"), { planId: "pro", interval: "monthly" }, as2(SHOP4)), "upgrade");
  eq(r.applied, "after_payment", "applied after payment");
  expect(r.authUrl?.includes("mockAuth="), `authUrl ${r.authUrl}`);
  eq(r.subscription.planId, "starter", "still starter");
  eq(r.subscription.pendingPlanId, "pro", "pending plan");
  eq(r.subscription.pendingReason, "awaiting_payment", "awaiting payment");
  eq(r.subscription.pendingChargePaise, ctx.preview4.chargeTodayPaise, "due now matches the preview");
  eq(r.subscription.providerSubscriptionId, ctx.sub4, "old mandate kept");
  const exp = Date.parse(r.subscription.pendingExpiresAt) - Date.parse(r.subscription.pendingSince);
  eq(exp, 48 * HOUR, "expires after 48 h");
  const f = ok(await call("GET", "/v1/features", undefined, as2(SHOP4)), "features");
  eq(f.planId, "starter", "tenant plan unchanged before payment");
  const cur = ok(await call("GET", sub("/current"), undefined, as2(SHOP4)), "current");
  eq(cur.pendingPlan?.id, "pro", "pendingPlan");

  const a = ok(await call("POST", sub("/mock/authorize"), { subscriptionId: r.subscription.pendingProviderSubscriptionId }, { as: null, tenant: null }), "authorize upgrade");
  eq(a.subscription.planId, "pro", "pro now");
  eq(a.subscription.pendingPlanId, null, "pending cleared");
  eq(a.subscription.providerSubscriptionId, r.subscription.pendingProviderSubscriptionId, "new mandate current");
  const inv = a.invoice;
  eq(inv.totalPaise, ctx.preview4.chargeTodayPaise, "invoice total = amount paid");
  eq(inv.subtotalPaise, PRO_MONTHLY - STARTER_MONTHLY, "taxable after credit");
  eq(inv.creditPaise, STARTER_MONTHLY, "credit");
  eq(inv.lines.length, 2, "plan + credit lines");
  eq(inv.lines[0].kind, "plan", "plan line");
  eq(inv.lines[0].taxablePaise, PRO_MONTHLY, "plan line at full value");
  eq(inv.lines[1].kind, "credit", "credit line");
  eq(inv.lines[1].taxablePaise, -STARTER_MONTHLY, "credit line negative");
  eq(inv.lines[0].totalPaise + inv.lines[1].totalPaise, inv.totalPaise, "lines add up");
  eq(inv.cgstPaise + inv.sgstPaise + inv.subtotalPaise, inv.totalPaise, "CGST + SGST on the net");
  const f2 = ok(await call("GET", "/v1/features", undefined, as2(SHOP4)), "features after");
  eq(f2.planId, "pro", "tenant plan follows once paid");
  const pdf = await call("GET", sub(`/invoices/${inv.id}.pdf`), undefined, { ...as2(SHOP4), binary: true });
  eq(pdf.status, 200, "pdf with the credit line");
  const again = ok(await call("POST", sub("/mock/authorize"), { subscriptionId: r.subscription.pendingProviderSubscriptionId }, { as: null, tenant: null }), "authorize again");
  eq(again.outcome, "ignored: already active", "idempotent");
  ctx.sub4 = r.subscription.pendingProviderSubscriptionId;
  return `${inv.number}: ₹${(inv.totalPaise / 100).toFixed(2)} (credit ₹${(inv.creditPaise / 100).toFixed(2)})`;
});

await step("an unpaid upgrade lapses after 48 h (job) and its mandate is cancelled; cancel upgrade drops one at once", async () => {
  const r = ok(await call("POST", sub("/change"), { planId: "pro", interval: "yearly" }, as2(SHOP4)), "upgrade to yearly");
  eq(r.applied, "after_payment", "pending");
  const since = r.subscription.pendingSince;
  const early = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop4.id, now: later(since, 47 * HOUR) }, { as: "owner", tenant: null }), "job early");
  expect(!early.pending_expired, `early ${JSON.stringify(early)}`);
  const j = ok(await call("POST", sub("/mock/lifecycle"), { tenantId: ctx.shop4.id, now: later(since, 49 * HOUR) }, { as: "owner", tenant: null }), "job");
  eq(j.pending_expired, 1, "lapsed");
  const c = ok(await call("GET", sub("/current"), undefined, as2(SHOP4)), "current");
  eq(c.subscription.planId, "pro", "plan unchanged");
  eq(c.subscription.interval, "monthly", "interval unchanged");
  eq(c.subscription.pendingPlanId, null, "pending cleared");
  // Its mandate is gone: a late authorisation finds nothing.
  fails(await call("POST", sub("/mock/authorize"), { subscriptionId: r.subscription.pendingProviderSubscriptionId }, { as: null, tenant: null }), 404, "not_found", "late authorise");

  ok(await call("POST", sub("/change"), { planId: "pro", interval: "yearly" }, as2(SHOP4)), "upgrade again");
  const cx = ok(await call("POST", sub("/change/cancel"), {}, as2(SHOP4)), "cancel upgrade");
  eq(cx.subscription.pendingPlanId, null, "dropped");
  eq(cx.subscription.planId, "pro", "still pro monthly");
  fails(await call("POST", sub("/change/cancel"), {}, as2(SHOP4)), 400, "bad_request", "nothing to cancel");
});

await step("webhook ordering: charged before activated applies the upgrade once; the late activation is ignored", async () => {
  const r = ok(await call("POST", sub("/change"), { planId: "pro", interval: "yearly" }, as2(SHOP4)), "upgrade to yearly");
  const id = r.subscription.pendingProviderSubscriptionId;
  expect(r.subscription.pendingCreditPaise > 0, `credit ${r.subscription.pendingCreditPaise}`);
  const ch = ok(await call("POST", sub("/mock/charge"), { subscriptionId: id }, { as: null, tenant: null }), "charged first");
  expect(ch.outcome.startsWith("applied: upgraded"), `outcome ${ch.outcome}`);
  eq(ch.subscription.interval, "yearly", "yearly now");
  eq(ch.invoice.totalPaise, r.subscription.pendingChargePaise, "invoice = upfront");
  eq(ch.invoice.creditPaise, r.subscription.pendingCreditPaise, "credit line");
  const body = JSON.stringify({ event: "subscription.activated", payload: { subscription: { entity: { id, status: "active" } } } });
  const sig = createHmac("sha256", MOCK_WEBHOOK_SECRET).update(body).digest("hex");
  const late = ok(
    await call("POST", sub("/webhooks/razorpay"), body, { as: null, tenant: null, headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": `evt_e2e_late_${run}` } }),
    "late activation",
  );
  eq(late.outcome, "ignored: already active", "ignored");
  const list = ok(await call("GET", sub("/invoices"), undefined, as2(SHOP4)), "invoices");
  eq(list.items.filter((i) => i.creditPaise > 0).length, 2, "one invoice per upgrade");
  return `${ch.invoice.number}: ₹${(ch.invoice.totalPaise / 100).toFixed(2)} (credit ₹${(ch.invoice.creditPaise / 100).toFixed(2)})`;
});

await step("trial plan switches stay instant (no payment)", async () => {
  // Shop 3's trial ended above; re-open one (super-admin) and switch its plan.
  const ext = ok(await call("POST", sub(`/admin/${ctx.shop3.id}/extend-trial`), { days: 3 }, { as: "owner", tenant: null }), "trial re-opened");
  eq(ext.subscription.status, "trialing", "trialing");
  const tp = ok(await call("POST", sub("/change/preview"), { planId: "pro", interval: "monthly" }, as1(SHOP3)), "preview in trial");
  eq(tp.applies, "now", "now");
  eq(tp.chargeTodayPaise, 0, "no charge");
  const ch = ok(await call("POST", sub("/change"), { planId: "pro", interval: "monthly" }, as1(SHOP3)), "switch");
  eq(ch.applied, "now", "instant");
  eq(ch.subscription.planId, "pro", "pro trial");
  eq(ch.subscription.pendingPlanId, null, "nothing pending");
});

await step("super-admin: stats, list with search, comp, invoices, void; shop owners are refused", async () => {
  const s = ok(await call("GET", sub("/admin/stats"), undefined, { as: "owner", tenant: null }), "stats");
  for (const k of ["mrrPaise", "arrPaise", "active", "trialing", "pastDue", "churned30d"]) expect(typeof s[k] === "number", `stats.${k}`);
  expect(s.arrPaise === s.mrrPaise * 12, "ARR = 12 × MRR");
  expect(s.trialConversion === null || (s.trialConversion >= 0 && s.trialConversion <= 1), "conversion rate");
  const list = ok(await call("GET", sub(`/admin/subscriptions?q=${encodeURIComponent(`e2e-su-${run}`)}`), undefined, { as: "owner", tenant: null }), "list");
  const row = list.items.find((i) => i.tenantId === ctx.shop1.id);
  expect(row && row.tenant?.slug === SHOP1 && typeof row.mrrPaise === "number", `row ${JSON.stringify(row)?.slice(0, 200)}`);
  const expired = ok(await call("GET", sub("/admin/subscriptions?status=expired&limit=200"), undefined, { as: "owner", tenant: null }), "status filter");
  expect(expired.items.every((i) => i.status === "expired"), "filtered");
  const comp = ok(
    await call("POST", sub(`/admin/${ctx.shop3.id}/comp`), { planId: "pro", until: new Date(Date.now() + 30 * DAY).toISOString() }, { as: "owner", tenant: null }),
    "comp",
  );
  eq(comp.subscription.provider, "manual", "manual");
  eq(comp.subscription.planId, "pro", "comp plan");
  const f = ok(await call("GET", "/v1/features", undefined, as1(SHOP3)), "features");
  eq(f.planId, "pro", "comped plan applies");
  const invs = ok(await call("GET", sub(`/admin/invoices?tenantId=${ctx.shop1.id}`), undefined, { as: "owner", tenant: null }), "invoices");
  expect(invs.items.some((i) => i.id === ctx.invoice1.id && i.tenant?.slug === SHOP1), "admin invoice list");
  const pdf = await call("GET", sub(`/admin/invoices/${ctx.invoice1.id}.pdf`), undefined, { as: "owner", tenant: null, binary: true });
  eq(pdf.status, 200, "admin pdf");
  const v = ok(await call("POST", sub(`/admin/invoices/${ctx.invoice1.id}/void`), { reason: "E2E test" }, { as: "owner", tenant: null }), "void");
  eq(v.status, "void", "voided");
  fails(await call("GET", sub("/admin/stats"), undefined, { as: "su1", tenant: null }), 403, "forbidden", "owner not super-admin");
  return `MRR ₹${(s.mrrPaise / 100).toFixed(2)}, active ${s.active}, trialing ${s.trialing}, past due ${s.pastDue}, churn 30d ${s.churned30d}`;
});

console.log(`\nbatch 5 e2e run ${RUN}\n`);
for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `\n      ${String(d).replace(/\n/g, "\n      ")}` : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
