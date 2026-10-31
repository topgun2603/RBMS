// Batch 10 end-to-end (docs/market-plan.md "Batch 10") against the running API (http://localhost:4000) and the real
// database.   node test/e2e/batch10.mjs        (test:e2e:all seeds and runs every script)
// Needs the API in development with the test OTP on (TEST_OTP_CODE; TEST_OTP_TARGETS covering e2e-*@example.com) and
// the e2e shops from seed:e2e. Job cards run in a throwaway services shop (`e2e-b10-<run>`, the "car_service" pack,
// owned by `e2e-b10-<run>@example.com`; `pnpm --filter @rbms/api cleanup:e2e-data` deletes it). Area units and the
// customer message settings run in e2e-bill (BL, pro). Items made there are named "E2E … <run>" so seed:e2e archives them.
import { call, eq, expect, fails, ok, OWNER, results, RUN, signIn, step, testPhone, today, waitForApi } from "./b3/lib.mjs";

await waitForApi();
await signIn("owner", OWNER);

const SHOP = `e2e-b10-${RUN.toLowerCase()}`;
await signIn("b10", `${SHOP}@example.com`, null, "E2E Garage Owner");
/** Calls in the throwaway services shop. */
const jc = (method, path, body) => call(method, path, body, { as: "b10", tenant: SHOP });

const cards = {};

await step("sign-up: a services shop on the car_service pack starts on vehicle job cards and keeps bookings", async () => {
  const r = ok(
    await call("POST", "/v1/signup", { shopName: `E2E Garage ${RUN}`, slug: SHOP, appId: "SV", planId: "sv-starter", interval: "monthly", businessType: "car_service", state: "33", phone: testPhone(7) }, { as: "b10", tenant: null }),
    "signup",
  );
  eq(r.tenant.appId, "SV", "app");
  const store = ok(await jc("GET", "/v1/store/config"), "store config");
  eq(store.shop.businessType, "car_service", "business type");
  return `${r.tenant.slug}: ${store.shop.businessType}`;
});

// ---------------------------------------------------------------- job card templates
await step("job cards: a vehicle card keeps the registration, km, fuel and the service reminder terms", async () => {
  cards.vehicle = ok(
    await jc("POST", "/v1/jobcards", {
      template: "vehicle",
      customerName: `E2E Vehicle ${RUN}`,
      customerPhone: "+919999000010",
      fields: { regNo: "tn 09-ab 1234", make: "Honda", model: "Activa", km: 12450, fuel: "half", serviceType: "general_service", remindAfterMonths: 6, remindAfterKm: 3000 },
    }),
    "vehicle card",
  );
  eq(cards.vehicle.template, "vehicle", "template");
  expect(cards.vehicle.fields.regNo === "TN09AB1234", `regNo ${cards.vehicle.fields.regNo}`);
  expect(cards.vehicle.fields.km === 12450 && cards.vehicle.fields.remindAfterMonths === 6 && cards.vehicle.fields.remindAfterKm === 3000, `fields ${JSON.stringify(cards.vehicle.fields)}`);
  fails(await jc("POST", "/v1/jobcards", { template: "vehicle", customerName: "x", fields: { regNo: "x", km: 1, serviceType: "repair" } }), 400, null, "bad registration");
  fails(await jc("POST", "/v1/jobcards", { template: "vehicle", customerName: "x", fields: { regNo: "TN09AB1234", km: -5, serviceType: "repair" } }), 400, null, "negative km");
  return `${cards.vehicle.label} ${cards.vehicle.fields.regNo}`;
});

await step("job cards: a laundry card counts pieces by type, keeps tag numbers and asks for an address for pickup", async () => {
  cards.laundry = ok(
    await jc("POST", "/v1/jobcards", {
      template: "laundry",
      customerName: `E2E Laundry ${RUN}`,
      customerPhone: "+919999000011",
      fields: { service: "dry_clean", garments: { shirt: 4, saree: 1 }, tagNumbers: ["A12", "A13"], pickup: true, drop: true, address: "12, Gandhi Road, Madurai", slot: "10:00-12:00" },
    }),
    "laundry card",
  );
  expect(cards.laundry.fields.garments.shirt === 4 && cards.laundry.fields.tagNumbers.length === 2, `fields ${JSON.stringify(cards.laundry.fields)}`);
  fails(await jc("POST", "/v1/jobcards", { template: "laundry", customerName: "x", fields: { garments: {} } }), 400, null, "no pieces");
  fails(await jc("POST", "/v1/jobcards", { template: "laundry", customerName: "x", fields: { garments: { shirt: 1 }, pickup: true } }), 400, null, "pickup without address");
  fails(await jc("POST", "/v1/jobcards", { template: "laundry", customerName: "x", fields: { garments: { shirt: 1 }, tagNumbers: ["A1", "A1"] } }), 400, null, "repeated tag");
  return cards.laundry.label;
});

await step("job cards: an appliance card keeps the site visit address, slot and the AMC number", async () => {
  cards.appliance = ok(
    await jc("POST", "/v1/jobcards", {
      template: "appliance",
      customerName: `E2E AC ${RUN}`,
      customerPhone: "+919999000012",
      fields: { kind: "ac", brand: "Voltas", model: "1.5T", issue: "Not cooling", visit: { address: "5, Anna Nagar, Chennai", date: today(), slot: "14:00-16:00" }, amcNumber: "AMC-2026-0044" },
    }),
    "appliance card",
  );
  expect(cards.appliance.fields.visit.slot === "14:00-16:00" && cards.appliance.fields.amcNumber === "AMC-2026-0044", `fields ${JSON.stringify(cards.appliance.fields)}`);
  fails(await jc("POST", "/v1/jobcards", { template: "appliance", customerName: "x", fields: { kind: "ac", issue: "x", visit: { address: "x" } } }), 400, null, "short address");
  return cards.appliance.label;
});

await step("job cards: the board lists the new templates and the card can go through to delivered", async () => {
  const list = ok(await jc("GET", "/v1/jobcards?template=vehicle,laundry,appliance&limit=100"), "list");
  for (const c of Object.values(cards)) expect(list.items.some((j) => j.id === c.id), `${c.label} not on the board`);
  const done = ok(await jc("POST", `/v1/jobcards/${cards.vehicle.id}/status`, { status: "delivered" }), "deliver vehicle");
  eq(done.status, "delivered", "status");
  return `${list.total} cards`;
});

// ---------------------------------------------------------------- area units
let tile;
await step("area units: a tile sold per sq ft with a box of 15.5 sq ft", async () => {
  const prod = ok(
    await call("POST", "/v1/catalog/products", {
      name: `E2E Vitrified tile ${RUN}`,
      hsn: "6907",
      gstRate: 18,
      taxInclusive: false,
      unit: "sqft",
      variants: [{ sku: `E2E${RUN}-TILE`, price: 9_000, mrp: 10_000, cost: 6_000, weightGrams: 400 }],
    }),
    "tile",
  );
  tile = prod.variants[0];
  const set = ok(await call("PUT", `/v1/catalog/variants/${tile.id}/units`, { units: [{ unit: "box", factor: 15.5 }, { unit: "sqm", factor: 10.76391 }] }), "units");
  const box = set.units.find((u) => u.unit === "box");
  expect(box && box.factor === 15.5 && box.price === 139_500, `box ${JSON.stringify(box)}`);
  fails(await call("PUT", `/v1/catalog/variants/${tile.id}/units`, { units: [{ unit: "sqm", factor: 10 }] }), 400, null, "wrong sqm factor");
  return `${tile.sku}: box = 15.5 sqft = ${box.price / 100} rupees`;
});

await step("area units: a 120 sq ft room with 10% wastage needs 9 boxes; a sq m room works too", async () => {
  const q = ok(await call("POST", `/v1/catalog/variants/${tile.id}/area-quote`, { area: 120, wastagePct: 10 }), "quote");
  expect(q.mode === "box" && q.boxes === 9 && q.line.unit === "box" && q.line.qty === 9, `quote ${JSON.stringify(q)}`);
  expect(q.covered === 139.5 && q.needed === 132 && q.total === 9 * 139_500, `quote ${JSON.stringify(q)}`);
  const plain = ok(await call("POST", `/v1/catalog/variants/${tile.id}/area-quote`, { area: 120 }), "no wastage");
  eq(plain.boxes, 8, "boxes without wastage");
  const sqm = ok(await call("POST", `/v1/catalog/variants/${tile.id}/area-quote`, { area: 10, areaUnit: "sqm" }), "sq m room");
  eq(sqm.boxes, 7, "boxes for 10 sq m");
  fails(await call("POST", `/v1/catalog/variants/${tile.id}/area-quote`, { area: 0 }), 400, null, "zero area");
  return `${q.boxes} boxes, ${plain.boxes} without wastage, ${sqm.boxes} for 10 sq m`;
});

await step("area units: an item that is not sold by area has no quote", async () => {
  const prod = ok(await call("POST", "/v1/catalog/products", { name: `E2E Plain item ${RUN}`, hsn: "6205", gstRate: 5, unit: "pcs", variants: [{ sku: `E2E${RUN}-PCS`, price: 10_000 }] }), "plain");
  fails(await call("POST", `/v1/catalog/variants/${prod.variants[0].id}/area-quote`, { area: 10 }), 400, null, "pcs item");
});

await step("area units: stock moves by box — 10 boxes bought, 2 sold in a bill, 124 sq ft left", async () => {
  ok(await call("POST", `/v1/inventory/stock/${tile.id}/adjust`, { mode: "set", qty: 155, note: "opening 10 boxes" }), "opening 10 boxes = 155 sq ft");
  const bill = ok(
    await call("POST", "/v1/invoices", {
      customer: { name: `E2E Tile buyer ${RUN}` },
      date: today(),
      issue: true,
      lines: [{ itemId: tile.id, description: "Vitrified tile", hsn: "6907", qty: 2, unit: "box", rate: 139_500, gstRate: 18 }],
    }),
    "bill in boxes",
  );
  const line = bill.lines[0];
  expect(line.unitFactor === 15.5 && line.baseUnit === "sqft", `line ${JSON.stringify(line).slice(0, 300)}`);
  const level = ok(await call("GET", `/v1/inventory/stock/${tile.id}`), "stock");
  eq(Number(level.qty), 124, "sq ft left");
  return `${bill.number}: 2 boxes out, ${level.qty} sq ft left`;
});

// ---------------------------------------------------------------- notifications
await step("notifications: the service-due reminder is a customer message event the shop can switch and test", async () => {
  const s = ok(await call("GET", "/v1/messages/settings"), "settings");
  expect(JSON.stringify(s).includes("job.service_due"), "job.service_due is listed in the shop's message events");
  for (const ev of ["booking.confirmed", "job.ready", "membership.renewal_due"]) expect(JSON.stringify(s).includes(ev), `${ev} listed`);
  ok(await call("PUT", "/v1/messages/settings", { events: { "job.service_due": { on: true, channel: "both" } } }), "switch on");
  const t = ok(await call("POST", "/v1/messages/test", { event: "job.service_due", channel: "sms" }), "send test");
  expect(Array.isArray(t.results), `test ${JSON.stringify(t).slice(0, 200)}`);
  return "job.service_due on, test sent";
});

console.log(`\nbatch 10 e2e run ${RUN}\n`);
for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `\n      ${String(d).replace(/\n/g, "\n      ")}` : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
