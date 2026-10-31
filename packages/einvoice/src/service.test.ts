import { AppError } from "@rbms/core";
import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import { createSecretBox } from "./crypto";
import { MockDriver } from "./drivers/mock";
import { EInvoiceError, type EInvoiceDriver } from "./drivers/types";
import type { EInvoiceSource, InvoiceDataPort } from "./ports";
import type { EInvoiceAccountRow, EInvoiceRecordRow } from "./schema";
import { EInvoiceService, type EInvoiceConfig, type EInvoiceDeps } from "./service";
import { gstin, invoice, SELLER_GSTIN } from "./test-fixtures";

type Op = { m: string; args: unknown[] };
type Result = unknown[] | ((ops: Op[]) => unknown[]) | Error;

/**
 * Chainable fake for drizzle: each awaited query resolves to the next queued result (an array, a function of the
 * query's builder calls, or an Error to reject with). `ops` records every awaited query's builder calls.
 */
function fakeDb(results: Result[]) {
  const ops: Op[][] = [];
  let current: Op[] = [];
  const settle = () => {
    const q = current;
    ops.push(q);
    current = [];
    const r = results.shift() ?? [];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(typeof r === "function" ? r(q) : r);
  };
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
        if (prop === "catch") return (rej: (e: unknown) => unknown) => settle().catch(rej);
        return (...args: unknown[]) => {
          current.push({ m: String(prop), args });
          return chain;
        };
      },
    },
  );
  const arg = (i: number, method: string) => ops[i]?.find((o) => o.m === method)?.args[0] as Record<string, unknown>;
  return { db: chain as Db, ops, arg };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-15T06:30:00Z");
const ENC = "test-key";
const box = createSecretBox(ENC);

/** Echoes inserted values back as the row (what `.returning()` gives). */
const echoInsert = (ops: Op[]) => {
  const v = ops.find((o) => o.m === "values")!.args[0] as Record<string, unknown>;
  return [{ id: "rec-new", createdAt: NOW, updatedAt: NOW, error: null, cancelledAt: null, cancelReason: null, cancelRemark: null, ewbNo: null, ewbDate: null, ewbValidTill: null, ewbStatus: null, ewbCancelledAt: null, signedInvoice: null, signedQr: null, ackNo: null, ackDate: null, irn: null, ...v }];
};

const record = (over: Partial<EInvoiceRecordRow> = {}): EInvoiceRecordRow => ({
  id: "rec-1",
  tenantId: TENANT,
  invoiceId: INVOICE_ID,
  provider: "mock",
  docType: "INV",
  docNo: "INV/26-27/0042",
  docDate: "2026-10-14",
  irn: "a".repeat(64),
  ackNo: "112610000012345",
  ackDate: new Date("2026-10-15T05:00:00Z"),
  signedQr: null,
  signedInvoice: null,
  status: "generated",
  error: null,
  payload: null,
  cancelledAt: null,
  cancelReason: null,
  cancelRemark: null,
  ewbNo: null,
  ewbDate: null,
  ewbValidTill: null,
  ewbStatus: null,
  ewbCancelledAt: null,
  ewbPayload: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const account = (over: Partial<EInvoiceAccountRow> = {}): EInvoiceAccountRow => ({
  tenantId: TENANT,
  provider: "gsp",
  gstin: SELLER_GSTIN,
  username: "api_user",
  passwordEnc: box.encrypt("pw"),
  clientCredentialsEnc: null,
  sandbox: true,
  enabled: true,
  options: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

function setup(results: Result[], opts: { src?: EInvoiceSource | null; config?: Partial<EInvoiceConfig>; drivers?: EInvoiceDeps["drivers"] } = {}) {
  const fake = fakeDb(results);
  const src = opts.src === undefined ? invoice() : opts.src;
  const port: InvoiceDataPort = {
    getInvoice: vi.fn(async () => src),
    listForPeriod: vi.fn(async () => (src ? [src] : [])),
  };
  const service = new EInvoiceService({
    db: fake.db,
    config: { encryptionKey: ENC, allowMock: true, gsp: { sandbox: { baseUrl: "https://gsp.test" } }, ...opts.config },
    invoices: port,
    now: () => NOW,
    drivers: opts.drivers,
  });
  return { service, port, ...fake };
}

const appErr = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
};

function stubDriver(over: Partial<EInvoiceDriver> = {}): EInvoiceDriver {
  return {
    provider: "gsp",
    authenticate: vi.fn(async () => {}),
    generateIrn: vi.fn(async () => ({ irn: "f".repeat(64), ackNo: "1", ackDate: "2026-10-15 12:00:00", signedInvoice: "si", signedQrCode: "qr", status: "ACT" as const })),
    cancelIrn: vi.fn(async (p) => ({ irn: p.Irn, cancelDate: "2026-10-15 12:30:00" })),
    getByIrn: vi.fn(async () => null),
    generateEwb: vi.fn(async () => ({ ewbNo: "341001234567", ewbDate: "2026-10-15 12:10:00", ewbValidTill: "2026-10-16 23:59:00" })),
    cancelEwb: vi.fn(async (p) => ({ ewbNo: String(p.ewbNo), cancelDate: "2026-10-15 12:40:00" })),
    ...over,
  };
}

describe("generateIrn", () => {
  it("generates with the mock provider when no account exists (development) and saves the record", async () => {
    const { service, arg, ops } = setup([[], [], [], echoInsert]);
    const res = await service.generateIrn(TENANT, INVOICE_ID);
    expect(res.alreadyGenerated).toBe(false);
    expect(res.record).toMatchObject({ status: "generated", provider: "mock", mock: true, docNo: "INV/26-27/0042", docDate: "2026-10-14" });
    expect(res.record.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(res.record.qr).toMatchObject({ DocNo: "INV/26-27/0042", TotInvVal: 3277, mock: true });
    expect(res.record.ackDate).toEqual(NOW);
    expect(res.record.cancellableUntil).toEqual(new Date(NOW.getTime() + 24 * 3_600_000));
    const v = arg(3, "values");
    expect(v).toMatchObject({ tenantId: TENANT, invoiceId: INVOICE_ID, status: "generated", provider: "mock" });
    expect((v.payload as { Version: string }).Version).toBe("1.1");
    expect(ops).toHaveLength(4);
  });

  it("is idempotent: an active IRN is returned without calling the provider", async () => {
    const driver = stubDriver();
    const { service, port } = setup([[record()]], { drivers: { mock: driver } });
    const res = await service.generateIrn(TENANT, INVOICE_ID);
    expect(res.alreadyGenerated).toBe(true);
    expect(res.record.irn).toBe("a".repeat(64));
    expect(driver.generateIrn).not.toHaveBeenCalled();
    expect(port.getInvoice).not.toHaveBeenCalled();
  });

  it("refuses invalid bills with the validation issues (nothing sent)", async () => {
    const b = invoice();
    const driver = stubDriver();
    const { service } = setup([[], []], { src: { ...b, buyer: { ...b.buyer, gstin: null } }, drivers: { mock: driver } });
    const e = await appErr(service.generateIrn(TENANT, INVOICE_ID));
    expect(e.code).toBe("einvoice_invalid");
    expect((e.details as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain("buyer_gstin_missing");
    expect(driver.generateIrn).not.toHaveBeenCalled();
  });

  it("applies the 30-day limit, overridable on the account", async () => {
    const old = invoice({ date: "2026-09-01" });
    const e = await appErr(setup([[], []], { src: old }).service.generateIrn(TENANT, INVOICE_ID));
    expect((e.details as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain("doc_date_too_old");
    const driver = stubDriver();
    const { service } = setup([[], [account({ options: { maxAgeDays: null } })], [], echoInsert], { src: old, drivers: { gsp: driver } });
    await expect(service.generateIrn(TENANT, INVOICE_ID)).resolves.toMatchObject({ alreadyGenerated: false });
  });

  it("404 for an unknown invoice", async () => {
    const e = await appErr(setup([[]], { src: null }).service.generateIrn(TENANT, INVOICE_ID));
    expect(e.status).toBe(404);
  });

  it("needs an account when the mock is not allowed; checks the account GSTIN and enabled flag", async () => {
    expect((await appErr(setup([[], []], { config: { allowMock: false } }).service.generateIrn(TENANT, INVOICE_ID))).code).toBe("einvoice_not_set_up");
    expect((await appErr(setup([[], [account({ enabled: false })]]).service.generateIrn(TENANT, INVOICE_ID))).code).toBe("einvoice_disabled");
    const other = gstin("33AAACZ9999Q1Z");
    const e = await appErr(setup([[], [account({ gstin: other })]], { drivers: { gsp: stubDriver() } }).service.generateIrn(TENANT, INVOICE_ID));
    expect((e.details as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain("account_gstin_mismatch");
  });

  it("recovers from NIC 2150 (duplicate) by fetching the existing IRN", async () => {
    const existing = { irn: "e".repeat(64), ackNo: "99", ackDate: "2026-10-15 09:00:00", signedInvoice: "si", signedQrCode: "qr", status: "ACT" as const };
    const driver = stubDriver({
      generateIrn: vi.fn(async () => {
        throw new EInvoiceError("duplicate_irn", "Duplicate IRN", { code: "2150", existing: { irn: existing.irn, ackNo: "99", ackDate: existing.ackDate } });
      }),
      getByIrn: vi.fn(async () => existing),
    });
    const { service, arg } = setup([[], [account()], [], echoInsert], { drivers: { gsp: driver } });
    const res = await service.generateIrn(TENANT, INVOICE_ID);
    expect(res.record.irn).toBe(existing.irn);
    expect(arg(3, "values")).toMatchObject({ irn: existing.irn, signedQr: "qr", ackDate: new Date("2026-10-15T03:30:00Z") });
  });

  it("2150 without details falls back to lookup by document", async () => {
    const driver = stubDriver({
      generateIrn: vi.fn(async () => {
        throw new EInvoiceError("duplicate_irn", "Duplicate IRN", { code: "2150" });
      }),
      getByDocument: vi.fn(async () => ({ irn: "d".repeat(64), ackNo: "7", ackDate: "2026-10-15 09:00:00", signedInvoice: null, signedQrCode: "qr", status: "ACT" as const })),
    });
    const { service } = setup([[], [account()], [], echoInsert], { drivers: { gsp: driver } });
    expect((await service.generateIrn(TENANT, INVOICE_ID)).record.irn).toBe("d".repeat(64));
    expect(driver.getByDocument).toHaveBeenCalledWith("INV", "INV/26-27/0042", "14/10/2026");
  });

  it("saves a failed attempt and maps the provider error", async () => {
    const driver = stubDriver({
      generateIrn: vi.fn(async () => {
        throw new EInvoiceError("validation", "Invalid HSN", { code: "2265", errors: [{ code: "2265", message: "Invalid HSN" }] });
      }),
    });
    const { service, arg } = setup([[], [account()], [], []], { drivers: { gsp: driver } });
    const e = await appErr(service.generateIrn(TENANT, INVOICE_ID));
    expect(e).toMatchObject({ status: 400, code: "einvoice_rejected" });
    expect(arg(3, "values")).toMatchObject({ status: "failed", docDate: "2026-10-14", error: { kind: "validation", code: "2265", message: "Invalid HSN" } });
  });

  it("maps network errors to 502", async () => {
    const driver = stubDriver({ generateIrn: vi.fn(async () => { throw new EInvoiceError("network", "down"); }) });
    const e = await appErr(setup([[], [account()], [], []], { drivers: { gsp: driver } }).service.generateIrn(TENANT, INVOICE_ID));
    expect(e).toMatchObject({ status: 502, code: "provider_unreachable" });
  });

  it("refuses a bill number whose IRN was cancelled", async () => {
    const e = await appErr(setup([[], [], [record({ status: "cancelled" })]]).service.generateIrn(TENANT, INVOICE_ID));
    expect(e.status).toBe(409);
  });

  it("a parallel request that saved first wins (unique violation → re-read)", async () => {
    const dup = Object.assign(new Error("duplicate key"), { code: "23505" });
    const { service } = setup([[], [], [], dup, [record()]]);
    const res = await service.generateIrn(TENANT, INVOICE_ID);
    expect(res).toMatchObject({ alreadyGenerated: true, record: { id: "rec-1" } });
  });
});

describe("cancelIrn", () => {
  it("cancels within 24 h with a reason code", async () => {
    const driver = stubDriver();
    const { service, arg } = setup([[record({ provider: "gsp" })], [account()], (ops) => [{ ...record({ provider: "gsp" }), ...(ops.find((o) => o.m === "set")!.args[0] as object) }]], {
      drivers: { gsp: driver },
    });
    const rec = await service.cancelIrn(TENANT, INVOICE_ID, { reason: 2, remark: "Wrong rate" });
    expect(driver.cancelIrn).toHaveBeenCalledWith({ Irn: "a".repeat(64), CnlRsn: "2", CnlRem: "Wrong rate" });
    expect(arg(2, "set")).toMatchObject({ status: "cancelled", cancelReason: "2", cancelRemark: "Wrong rate", cancelledAt: new Date("2026-10-15T07:00:00Z") });
    expect(rec.status).toBe("cancelled");
  });

  it("rejects bad reasons, missing IRN, expired window and active e-way bills", async () => {
    await expect(setup([]).service.cancelIrn(TENANT, INVOICE_ID, { reason: 5 as never })).rejects.toThrow();
    expect((await appErr(setup([[]]).service.cancelIrn(TENANT, INVOICE_ID, { reason: 1 }))).status).toBe(404);
    const old = record({ ackDate: new Date(NOW.getTime() - 25 * 3_600_000) });
    expect((await appErr(setup([[old]]).service.cancelIrn(TENANT, INVOICE_ID, { reason: 1 }))).code).toBe("cancel_window");
    const withEwb = record({ ewbNo: "341001234567", ewbStatus: "active" });
    expect((await appErr(setup([[withEwb]]).service.cancelIrn(TENANT, INVOICE_ID, { reason: 1 }))).status).toBe(409);
  });

  it("mirrors an IRN already cancelled at NIC (9999)", async () => {
    const driver = stubDriver({ cancelIrn: vi.fn(async () => { throw new EInvoiceError("not_active", "Invoice is not active", { code: "9999" }); }) });
    const { service, arg } = setup([[record({ provider: "gsp" })], [account()], []], { drivers: { gsp: driver } });
    const rec = await service.cancelIrn(TENANT, INVOICE_ID, { reason: "4" as never });
    expect(arg(2, "set")).toMatchObject({ status: "cancelled", cancelReason: "4" });
    expect(rec.status).toBe("cancelled");
  });
});

describe("e-way bills", () => {
  it("from the IRN", async () => {
    const driver = stubDriver();
    const { service, arg } = setup([[record({ provider: "gsp" })], [account()], (ops) => [{ ...record({ provider: "gsp" }), ...(ops.find((o) => o.m === "set")!.args[0] as object) }]], {
      drivers: { gsp: driver },
    });
    const res = await service.generateEwb(TENANT, INVOICE_ID, { distance: 120, vehicleNo: "tn 49 ab 1234" });
    expect(driver.generateEwb).toHaveBeenCalledWith({ kind: "irn", payload: { Irn: "a".repeat(64), Distance: 120, TransMode: "1", VehNo: "TN49AB1234", VehType: "R" } });
    expect(arg(2, "set")).toMatchObject({ ewbNo: "341001234567", ewbStatus: "active", ewbValidTill: new Date("2026-10-16T18:29:00Z") });
    expect(res.record.ewbNo).toBe("341001234567");
  });

  it("is idempotent and validates Part-B", async () => {
    const active = record({ ewbNo: "341001234567", ewbStatus: "active", ewbDate: NOW });
    expect(await setup([[active]]).service.generateEwb(TENANT, INVOICE_ID, { distance: 5, vehicleNo: "TN01AB1234" })).toMatchObject({ alreadyGenerated: true });
    const e = await appErr(setup([[record()]]).service.generateEwb(TENANT, INVOICE_ID, { distance: 5, transMode: 2 }));
    expect(e.code).toBe("ewb_invalid");
    await expect(setup([]).service.generateEwb(TENANT, INVOICE_ID, { distance: 5000 })).rejects.toThrow();
  });

  it("without an IRN: 409 unless standalone, which saves an ewb_only record", async () => {
    expect((await appErr(setup([[]]).service.generateEwb(TENANT, INVOICE_ID, { distance: 30, vehicleNo: "TN01AB1234" }))).status).toBe(409);
    const { service, arg } = setup([[], [], echoInsert]);
    const res = await service.generateEwb(TENANT, INVOICE_ID, { distance: 30, vehicleNo: "TN01AB1234", standalone: true });
    expect(arg(2, "values")).toMatchObject({ status: "ewb_only", ewbStatus: "active", docNo: "INV/26-27/0042" });
    expect(res.record.ewbNo).toMatch(/^1\d{11}$/);
    expect(res.record.ewbValidTill).toEqual(new Date("2026-10-16T18:29:59Z"));
  });

  it("cancels within 24 h", async () => {
    const driver = stubDriver();
    const rec = record({ provider: "gsp", ewbNo: "341001234567", ewbStatus: "active", ewbDate: new Date(NOW.getTime() - 3_600_000) });
    const { service, arg } = setup([[rec], [account()], []], { drivers: { gsp: driver } });
    await service.cancelEwb(TENANT, INVOICE_ID, { reason: 2 });
    expect(driver.cancelEwb).toHaveBeenCalledWith({ ewbNo: 341001234567, cancelRsnCode: 2, cancelRmrk: "Order cancelled" });
    expect(arg(2, "set")).toMatchObject({ ewbStatus: "cancelled" });
    const late = record({ ewbNo: "1", ewbStatus: "active", ewbDate: new Date(NOW.getTime() - 25 * 3_600_000) });
    expect((await appErr(setup([[late]]).service.cancelEwb(TENANT, INVOICE_ID, { reason: 1 }))).code).toBe("cancel_window");
  });
});

describe("status / irnFor / preview", () => {
  it("status shows the active IRN, the e-way bill and history", async () => {
    const rows = [record({ ewbNo: "341001234567", ewbStatus: "active", ewbDate: NOW }), record({ id: "rec-0", status: "failed", irn: null })];
    const s = await setup([rows]).service.status(TENANT, INVOICE_ID);
    expect(s.einvoice?.id).toBe("rec-1");
    expect(s.ewb).toMatchObject({ ewbNo: "341001234567", recordId: "rec-1" });
    expect(s.history).toHaveLength(2);
  });

  it("irnFor returns what the PDF prints, or null", async () => {
    expect(await setup([[record({ signedQr: "qr", provider: "gsp" })]]).service.irnFor(TENANT, INVOICE_ID)).toEqual({
      irn: "a".repeat(64),
      ackNo: "112610000012345",
      ackDate: new Date("2026-10-15T05:00:00Z"),
      signedQrCode: "qr",
      ewbNo: null,
      ewbDate: null,
      ewbValidTill: null,
      mock: false,
    });
    expect(await setup([[record({ status: "cancelled" })]]).service.irnFor(TENANT, INVOICE_ID)).toBeNull();
  });

  it("preview returns the payload and issues without sending", async () => {
    const p = await setup([[]]).service.preview(TENANT, INVOICE_ID);
    expect(p.ok).toBe(true);
    expect(p.payload.DocDtls.No).toBe("INV/26-27/0042");
  });
});

describe("account", () => {
  it("saves a GSP account after checking the login; secrets are encrypted and never returned", async () => {
    const driver = stubDriver();
    const { service, arg } = setup([[], echoInsertAccount], { drivers: { gsp: driver } });
    const view = await service.putAccount(TENANT, { provider: "gsp", gstin: SELLER_GSTIN.toLowerCase(), username: "api_user", password: "pw", clientId: "cid", clientSecret: "cs", sandbox: true, maxAgeDays: null });
    expect(driver.authenticate).toHaveBeenCalled();
    const v = arg(1, "values");
    expect(v.gstin).toBe(SELLER_GSTIN);
    expect(box.decrypt(v.passwordEnc as string)).toBe("pw");
    expect(JSON.parse(box.decrypt(v.clientCredentialsEnc as string))).toEqual({ clientId: "cid", clientSecret: "cs" });
    expect(v.options).toEqual({ maxAgeDays: null });
    expect(view).toMatchObject({ configured: true, provider: "gsp", passwordSet: true, clientCredentialsSet: true, sandbox: true });
    expect(JSON.stringify(view)).not.toContain("pw");
  });

  it("rejected logins → 400 invalid_credentials; password required on first save", async () => {
    const driver = stubDriver({ authenticate: vi.fn(async () => { throw new EInvoiceError("auth", "bad", { code: "1004" }); }) });
    expect((await appErr(setup([[]], { drivers: { gsp: driver } }).service.putAccount(TENANT, { provider: "gsp", gstin: SELLER_GSTIN, username: "u", password: "x" }))).code).toBe("invalid_credentials");
    expect((await appErr(setup([[]]).service.putAccount(TENANT, { provider: "gsp", gstin: SELLER_GSTIN, username: "u" }))).status).toBe(400);
    await expect(setup([]).service.putAccount(TENANT, { provider: "gsp", gstin: "33ABC", username: "u", password: "x" })).rejects.toThrow();
  });

  it("mock accounts only when allowed", async () => {
    expect((await appErr(setup([], { config: { allowMock: false } }).service.putAccount(TENANT, { provider: "mock", gstin: SELLER_GSTIN }))).status).toBe(400);
    const { service } = setup([[], echoInsertAccount]);
    expect(await service.putAccount(TENANT, { provider: "mock", gstin: SELLER_GSTIN })).toMatchObject({ provider: "mock", passwordSet: false });
  });

  it("getAccount without a row shows the dev mock", async () => {
    expect(await setup([[]]).service.getAccount(TENANT)).toMatchObject({ configured: false, usingMock: true });
  });

  it("GSP needs a platform config for the chosen environment", async () => {
    const e = await appErr(setup([[]], { config: { gsp: {} } }).service.putAccount(TENANT, { provider: "gsp", gstin: SELLER_GSTIN, username: "u", password: "x", sandbox: false }));
    expect(e).toMatchObject({ status: 503, code: "einvoice_not_configured" });
  });
});

const echoInsertAccount = (ops: Op[]) => [{ createdAt: NOW, updatedAt: NOW, ...(ops.find((o) => o.m === "values")!.args[0] as object) }];

describe("gstr1", () => {
  it("builds the return with the account GSTIN and a file name", async () => {
    const { service, port } = setup([[account()]]);
    const r = await service.gstr1(TENANT, "102026");
    expect(port.listForPeriod).toHaveBeenCalledWith(TENANT, { from: "2026-10-01", to: "2026-10-31" });
    expect(r.filename).toBe(`GSTR1_${SELLER_GSTIN}_102026.json`);
    expect(r.json.b2b).toHaveLength(1);
  });
  it("falls back to the bills' GSTIN; rejects a bad period", async () => {
    expect((await setup([[]]).service.gstr1(TENANT, "102026")).json.gstin).toBe(SELLER_GSTIN);
    expect((await appErr(setup([]).service.gstr1(TENANT, "2026-10"))).status).toBe(400);
  });
});

describe("mock driver end to end through the service", () => {
  it("generate → cancel with the shared mock", async () => {
    const mock = new MockDriver(() => NOW);
    const g = await setup([[], [], [], echoInsert], { drivers: { mock } }).service.generateIrn(TENANT, INVOICE_ID);
    const row = record({ irn: g.record.irn, ackDate: NOW });
    const { service, arg } = setup([[row], [], []], { drivers: { mock } });
    await service.cancelIrn(TENANT, INVOICE_ID, { reason: 1 });
    expect(arg(2, "set")).toMatchObject({ status: "cancelled", cancelledAt: NOW });
  });
});
