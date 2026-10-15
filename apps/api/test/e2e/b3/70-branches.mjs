// B3 branches on e2e-bill (BL pro: multi-branch, inventory.locations): main branch, a second branch with its own
// GSTIN/address/prefix/location, per-branch bill series and stock, staff branch access, summary and list filter.
// The second branch (code E2EB2) is created once and reused on re-runs; the staff member uses a fixed test phone.
import { call, ok, fails, eq, expect, step, signIn, today, RUN, rs } from "./lib.mjs";

const CODE = "E2EB2";
const PREFIX = "B2";
const STAFF_PHONE = "+919999060071";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + CHARS[(36 - (sum % 36)) % 36];
}
/** Same PAN as the shop (33AABFR1234K1ZI), registered in Karnataka. */
const BRANCH_GSTIN = gstin("29AABFR1234K1Z");

const seqOf = (n) => Number(/(\d+)$/.exec(n ?? "")?.[1] ?? NaN);
const qtyAt = async (itemId, locationId) => ok(await call("GET", `/v1/inventory/stock/${itemId}?locationId=${locationId}`), "stock at location").qty;

/** All bills of the shop dated today with a number (newest first as the API lists them). */
async function billsToday(extra = "") {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const page = ok(await call("GET", `/v1/invoices?from=${today()}&to=${today()}&limit=200&offset=${offset}${extra}`), "list bills");
    out.push(...page.items);
    if (page.items.length < 200) break;
  }
  return out;
}

export default async function () {
  let main, b2, silk, lastMainBefore, b2Bill, staffUserId, staffBill;

  await step("branches: last main-series bill number before branch billing", async () => {
    // Highest number of the shop's own series (prefix EB) across all bills, so the main branch must continue it.
    const all = [];
    for (let offset = 0; ; offset += 200) {
      const page = ok(await call("GET", `/v1/invoices?limit=200&offset=${offset}`), "list");
      all.push(...page.items);
      if (page.items.length < 200 || offset > 5000) break;
    }
    const nums = all.map((b) => b.number).filter((n) => n && /^EB\/\d\d-\d\d\/\d+$/.test(n));
    lastMainBefore = nums.sort((a, b) => seqOf(b) - seqOf(a))[0] ?? null;
    return `last EB bill ${lastMainBefore ?? "none"} (of ${all.length} bills)`;
  });

  await step("branches: owner GET /mine creates the main branch lazily", async () => {
    const m = ok(await call("GET", "/v1/branches/mine"), "mine");
    main = m.items.find((b) => b.id === m.defaultBranchId);
    expect(main?.isDefault, `no default branch: ${JSON.stringify(m).slice(0, 300)}`);
    eq(main.invoicePrefix, "EB", "main prefix (from billing settings)");
    expect(main.stockLocationId, "main branch linked to the default stock location");
    eq(main.gstin, "33AABFR1234K1ZI", "main GSTIN from the seller profile");
    return `${main.code} "${main.name}" prefix ${main.invoicePrefix} gstin ${main.gstin}; ${m.total} branch(es)`;
  });

  await step("branches: second branch (own code, prefix, GSTIN, address, new location) — reused on re-runs", async () => {
    const list = ok(await call("GET", "/v1/branches"), "list").items;
    b2 = list.find((b) => b.code === CODE);
    let note = "reused";
    if (!b2) {
      b2 = ok(
        await call("POST", "/v1/branches", {
          name: "E2E Bengaluru branch",
          code: CODE,
          invoicePrefix: PREFIX,
          address: "45, Brigade Road",
          city: "Bengaluru",
          pincode: "560025",
          phone: "+919999060070",
          gstin: BRANCH_GSTIN,
          stateCode: "29",
          createLocation: true,
        }),
        "create branch",
      );
      note = "created";
    }
    if (!b2.active) b2 = ok(await call("PATCH", `/v1/branches/${b2.id}`, { active: true }), "reopen");
    eq(b2.invoicePrefix, PREFIX, "prefix");
    eq(b2.gstin, BRANCH_GSTIN, "gstin");
    eq(b2.stateCode, "29", "state");
    expect(b2.stockLocationId && b2.stockLocationId !== main.stockLocationId, "own stock location");
    fails(await call("POST", "/v1/branches", { name: "Dup", code: CODE, createLocation: false }), 409, null, "duplicate code");
    fails(await call("POST", "/v1/branches", { name: "Dup prefix", code: `X${RUN}`.slice(0, 16), invoicePrefix: PREFIX, createLocation: false }), 409, null, "duplicate prefix");
    const loc = ok(await call("GET", `/v1/inventory/locations/${b2.stockLocationId}`), "branch location");
    return `${note} ${b2.code} prefix ${b2.invoicePrefix} gstin ${b2.gstin}; location ${loc.name ?? loc.id}; duplicate code/prefix → 409`;
  });

  let mainQty0, b2Qty0;
  await step("branches: top up silk stock at the branch location", async () => {
    silk = ok(await call("GET", "/v1/invoices/items"), "items").items.find((i) => i.name === "Silk saree");
    expect(silk, "Silk saree item");
    mainQty0 = await qtyAt(silk.id, main.stockLocationId);
    const before = await qtyAt(silk.id, b2.stockLocationId);
    const j = ok(await call("POST", `/v1/inventory/stock/${silk.id}/adjust`, { mode: "add", qty: 5, unitCost: 520000, locationId: b2.stockLocationId, note: `E2E ${RUN} branch stock` }), "adjust");
    b2Qty0 = await qtyAt(silk.id, b2.stockLocationId);
    eq(b2Qty0, before + 5, "branch qty after +5");
    eq(await qtyAt(silk.id, main.stockLocationId), mainQty0, "main qty unchanged by the branch top-up");
    return `silk at ${CODE}: ${before} → ${b2Qty0} (adjust returned ${j.qty}); main ${mainQty0}`;
  });

  await step("branches: bill with x-branch E2EB2 → B2 number, branchId, branch seller, branch stock", async () => {
    // Other sections bill on this shop concurrently: re-read main stock right before, then compare by our own ids.
    const mainBefore = await qtyAt(silk.id, main.stockLocationId);
    const b2Before = await qtyAt(silk.id, b2.stockLocationId);
    b2Bill = ok(
      await call(
        "POST",
        "/v1/invoices",
        { customer: { name: `E2E Branch buyer ${RUN}` }, date: today(), issue: true, lines: [{ itemId: silk.id, description: silk.name, hsn: silk.hsn, qty: 2, unit: "pcs", rate: silk.rate, gstRate: silk.gstRate }] },
        { headers: { "x-branch": CODE } },
      ),
      "branch bill",
    );
    expect(new RegExp(`^${PREFIX}/\\d\\d-\\d\\d/\\d{4}$`).test(b2Bill.number), `number ${b2Bill.number}`);
    eq(b2Bill.branchId, b2.id, "branchId");
    eq(b2Bill.seller?.gstin, BRANCH_GSTIN, "seller gstin");
    eq(b2Bill.seller?.stateCode, "29", "seller state");
    expect(/Brigade Road/.test(b2Bill.seller?.address ?? ""), `seller address ${b2Bill.seller?.address}`);
    expect(b2Bill.interState === false && b2Bill.totals.cgst > 0, "walk-in at a Karnataka branch is intra-state (29)");
    const b2After = await qtyAt(silk.id, b2.stockLocationId);
    eq(b2After, b2Before - 2, "branch location qty");
    const moves = ok(await call("GET", `/v1/inventory/stock/${silk.id}/movements?locationId=${main.stockLocationId}&limit=50`), "main movements").items;
    expect(!moves.some((m) => m.refId === b2Bill.id || m.refNumber === b2Bill.number), "the branch bill must not move main stock");
    const bMoves = ok(await call("GET", `/v1/inventory/stock/${silk.id}/movements?locationId=${b2.stockLocationId}&limit=50`), "branch movements").items;
    expect(bMoves.some((m) => (m.refId === b2Bill.id || m.refNumber === b2Bill.number) && m.delta === -2), `no sale movement at the branch: ${JSON.stringify(bMoves.slice(0, 3))}`);
    const mainAfter = await qtyAt(silk.id, main.stockLocationId);
    return `${b2Bill.number} ${rs(b2Bill.total)} seller ${b2Bill.seller.gstin} (${b2Bill.seller.stateCode}); silk ${CODE} ${b2Before} → ${b2After}, main ${mainBefore} → ${mainAfter} (no movement for this bill)`;
  });

  await step("branches: staff assigned only to the main branch", async () => {
    let r = await call("POST", "/v1/staff/invites", { target: STAFF_PHONE, roleKeys: [] });
    if (r.status === 409) {
      const m = ok(await call("GET", "/v1/staff/members"), "members").items.find((x) => x.phone === STAFF_PHONE);
      expect(m, `member ${STAFF_PHONE} not listed`);
      r = await call("PATCH", `/v1/staff/members/${m.userId}`, { roleKeys: [], active: true });
    }
    const m = ok(r, "invite staff");
    staffUserId = m.userId ?? m.member?.userId ?? m.user?.id;
    expect(staffUserId, `no userId in ${JSON.stringify(m).slice(0, 200)}`);
    const set = ok(await call("PUT", `/v1/branches/users/${staffUserId}`, { branchIds: [main.id], defaultBranchId: main.id }), "assign");
    expect(set.items.length === 1 && set.items[0].branchId === main.id, JSON.stringify(set));
    const onB2 = ok(await call("GET", `/v1/branches/${b2.id}/users`), "b2 users").items;
    expect(!onB2.some((u) => u.userId === staffUserId), "staff must not be on the second branch");
    await signIn("b3staff", STAFF_PHONE);
    const mine = ok(await call("GET", "/v1/branches/mine", undefined, { as: "b3staff" }), "staff mine");
    expect(mine.items.length === 1 && mine.items[0].id === main.id, `staff mine ${mine.items.map((b) => b.code)}`);
    return `${STAFF_PHONE} (${staffUserId.slice(0, 8)}) → ${main.code} only; /mine ${mine.items.map((b) => b.code).join(",")}`;
  });

  await step("branches: staff gets 403 branch_forbidden on E2EB2 and bills on the main branch", async () => {
    const line = { description: `E2E branch staff sale ${RUN}`, hsn: "5208", qty: 1, rate: 30_000, gstRate: 5 };
    const body = { customer: { name: `E2E Staff walk-in ${RUN}` }, date: today(), issue: true, lines: [line] };
    fails(await call("POST", "/v1/invoices", body, { as: "b3staff", headers: { "x-branch": CODE } }), 403, "branch_forbidden", "staff on E2EB2");
    fails(await call("GET", "/v1/invoices", undefined, { as: "b3staff", headers: { "x-branch": b2.id } }), 403, "branch_forbidden", "staff on E2EB2 by id");
    fails(await call("POST", "/v1/invoices", body, { as: "b3staff", headers: { "x-branch": "NOPE-NOPE" } }), 404, "branch_not_found", "unknown branch");
    staffBill = ok(await call("POST", "/v1/invoices", body, { as: "b3staff" }), "staff bill (home branch)");
    eq(staffBill.branchId, main.id, "staff bill branch");
    const explicit = ok(await call("POST", "/v1/invoices", body, { as: "b3staff", headers: { "x-branch": main.code } }), "staff bill x-branch MAIN");
    eq(explicit.branchId, main.id, "explicit main");
    expect(staffBill.number.startsWith("EB/") && explicit.number.startsWith("EB/"), `numbers ${staffBill.number} ${explicit.number}`);
    eq(staffBill.seller?.gstin, "33AABFR1234K1ZI", "main seller gstin");
    return `x-branch ${CODE} → 403 branch_forbidden; home → ${staffBill.number}, x-branch ${main.code} → ${explicit.number}`;
  });

  await step("branches: main branch continues the shop's existing number series", async () => {
    const seq = seqOf(staffBill.number);
    if (lastMainBefore) {
      expect(staffBill.number.slice(0, -4) === lastMainBefore.slice(0, -4), `series ${staffBill.number} vs ${lastMainBefore}`);
      expect(seq > seqOf(lastMainBefore), `${staffBill.number} does not continue after ${lastMainBefore}`);
    }
    expect(seq > 1 || !lastMainBefore, `main series restarted at ${staffBill.number}`);
    // and the branch series is separate: its numbers never appear in the EB series
    const all = await billsToday();
    const dupes = all.filter((b) => b.number === staffBill.number);
    eq(dupes.length, 1, "unique number");
    return `before ${lastMainBefore ?? "none"} → main bill ${staffBill.number}; branch bill ${b2Bill.number} has its own series`;
  });

  await step("branches: summary per branch (sales, bills, stock value)", async () => {
    const s = ok(await call("GET", `/v1/branches/summary?from=${today()}&to=${today()}`), "summary");
    const rb = s.items.find((x) => x.branchId === b2.id);
    const rm = s.items.find((x) => x.branchId === main.id);
    expect(rb && rm, `rows ${s.items.map((x) => x.code)}`);
    const b2Bills = await billsToday(`&branchId=${b2.id}`);
    const live = b2Bills.filter((b) => b.status !== "cancelled" && b.status !== "draft");
    eq(rb.bills, live.length, "branch bill count");
    eq(rb.sales, live.reduce((a, b) => a + b.total, 0), "branch sales");
    expect(rb.sales >= b2Bill.total, "branch sales include our bill");
    expect(rm.bills >= 2, `main bills ${rm.bills}`);
    expect(typeof rb.stockValue === "number" && rb.stockValue > 0, `branch stock value ${rb.stockValue}`);
    expect(s.consolidated.bills >= rb.bills + rm.bills, "consolidated");
    fails(await call("GET", "/v1/branches/summary", undefined, { as: "b3staff" }), 403, null, "staff cannot see the summary");
    return `${rb.code}: ${rb.bills} bills ${rs(rb.sales)}, stock ${rs(rb.stockValue)}; ${rm.code}: ${rm.bills} bills ${rs(rm.sales)}, stock ${rs(rm.stockValue ?? 0)}; all ${rs(s.consolidated.sales)}`;
  });

  await step("branches: invoices list filter branchId returns only that branch's bills", async () => {
    const onlyB2 = ok(await call("GET", `/v1/invoices?branchId=${b2.id}&limit=200`), "list b2").items;
    expect(onlyB2.some((b) => b.id === b2Bill.id), "branch bill listed");
    expect(onlyB2.every((b) => b.branchId === b2.id), `foreign bills: ${onlyB2.filter((b) => b.branchId !== b2.id).map((b) => b.number)}`);
    expect(onlyB2.every((b) => !b.number || b.number.startsWith(`${PREFIX}/`)), "all B2 numbers");
    expect(!onlyB2.some((b) => b.id === staffBill.id), "main bill not in the branch list");
    const onlyMain = ok(await call("GET", `/v1/invoices?branchId=${main.id}&limit=50`), "list main").items;
    expect(onlyMain.some((b) => b.id === staffBill.id) && !onlyMain.some((b) => b.id === b2Bill.id), "main filter");
    return `${CODE}: ${onlyB2.length} bills (${onlyB2.slice(0, 3).map((b) => b.number).join(", ")}); ${main.code} filter has the staff bill`;
  });
}
