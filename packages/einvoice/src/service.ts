import { AppError, badRequest, conflict, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createSecretBox, type SecretBox } from "./crypto";
import { decodeSignedQr, MockDriver, type QrPayload } from "./drivers/mock";
import { GspDriver, memoryTokenCache, type GspEndpoints, type TokenCache } from "./drivers/gsp";
import { EINVOICE_PROVIDERS, EInvoiceError, type EInvoiceDriver, type EInvoiceErrorKind, type EInvoiceProvider, type IrnResult } from "./drivers/types";
import {
  buildCancelEwb,
  buildCancelIrn,
  buildEwbByIrn,
  buildStandaloneEwb,
  TRANS_MODES,
  validateEwbInput,
  validateStandaloneEwb,
  withinHours,
  type EwbInput,
} from "./ewb";
import { isValidGstin, normalizeGstin, parseNicDateTime, todayIST } from "./gst";
import { buildGstr1, periodRange, type Gstr1Result } from "./gstr1";
import { DEFAULT_MAX_AGE_DAYS, prepareEInvoice, type EInvoicePayload, type ValidationIssue } from "./nic";
import { noopLogger, type EInvoiceSource, type InvoiceDataPort, type LoggerPort } from "./ports";
import {
  einvoiceAccounts,
  einvoiceRecords,
  type AccountOptions,
  type EInvoiceAccountRow,
  type EInvoiceRecordRow,
  type EwbStatus,
  type RecordError,
  type RecordStatus,
} from "./schema";

/** Platform-level GSP settings (one GSP contract for the platform; credentials are per shop). */
export interface GspPlatformConfig {
  baseUrl: string;
  endpoints?: Partial<GspEndpoints>;
  headers?: Record<string, string>;
  /** ASP / GSP client credentials used when a shop's account has none. */
  clientId?: string;
  clientSecret?: string;
  errorKinds?: Record<string, EInvoiceErrorKind>;
  timeoutMs?: number;
}

export interface EInvoiceConfig {
  /** Any length; a 32-byte AES key is derived with sha256. */
  encryptionKey: string;
  /** Development: allow the mock provider (and use it for shops without an account). */
  allowMock: boolean;
  gsp?: { sandbox?: GspPlatformConfig; production?: GspPlatformConfig };
  /** Default 30; null = no age limit. Shops can override on their account. */
  maxAgeDays?: number | null;
  /** Default 4. */
  minHsnDigits?: 4 | 6 | 8;
  /** IRN / e-way bill cancellation window. Default 24. */
  cancelWindowHours?: number;
}

export interface EInvoiceDeps {
  db: Db;
  config: EInvoiceConfig;
  invoices: InvoiceDataPort;
  log?: LoggerPort;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  now?: () => Date;
  tokenCache?: TokenCache;
  /** Tests: fixed driver instances per provider. */
  drivers?: Partial<Record<EInvoiceProvider, EInvoiceDriver>>;
}

// ------------------------------------------------------------------ input schemas

const gstinSchema = z
  .string()
  .trim()
  .transform(normalizeGstin)
  .refine(isValidGstin, "Enter a valid GSTIN");

export const accountInputSchema = z
  .object({
    provider: z.enum(EINVOICE_PROVIDERS),
    gstin: gstinSchema,
    username: z.string().trim().max(100).default(""),
    password: z.string().min(1).max(200).optional(),
    clientId: z.string().trim().max(200).nullish(),
    clientSecret: z.string().max(500).nullish(),
    sandbox: z.boolean().default(true),
    enabled: z.boolean().default(true),
    maxAgeDays: z.number().int().min(1).max(3650).nullable().optional(),
    minHsnDigits: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.provider === "gsp" && !a.username) ctx.addIssue({ code: "custom", path: ["username"], message: "Enter the API user name" });
  });
export type AccountInput = z.input<typeof accountInputSchema>;

const reasonSchema = z.coerce.number().int().min(1).max(4) as unknown as z.ZodType<1 | 2 | 3 | 4>;
export const cancelInputSchema = z.object({
  reason: reasonSchema,
  remark: z.string().trim().max(100).nullish(),
});
export type CancelInput = z.input<typeof cancelInputSchema>;

const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish();
export const ewbInputSchema = z.object({
  distance: z.coerce.number().int().min(0).max(4000),
  transMode: opt(z.coerce.number().int().refine((n) => (TRANS_MODES as readonly number[]).includes(n), "Mode must be 1–4")),
  transporterId: opt(z.string().trim().max(15)),
  transporterName: opt(z.string().trim().max(100)),
  transDocNo: opt(z.string().trim().max(15)),
  transDocDate: opt(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")),
  vehicleNo: opt(z.string().trim().max(20)),
  vehicleType: opt(z.enum(["R", "O"])),
  /** Generate without an IRN (B2C / non-e-invoice bills). */
  standalone: z.boolean().optional(),
});
export type EwbRequestInput = z.input<typeof ewbInputSchema>;

// ------------------------------------------------------------------ views

export interface AccountView {
  configured: boolean;
  provider: EInvoiceProvider | null;
  gstin: string | null;
  username: string | null;
  passwordSet: boolean;
  clientCredentialsSet: boolean;
  sandbox: boolean;
  enabled: boolean;
  options: AccountOptions;
  /** True when no account is saved and the mock provider will be used (development). */
  usingMock: boolean;
}

export interface RecordView {
  id: string;
  invoiceId: string;
  provider: EInvoiceProvider;
  mock: boolean;
  docType: string;
  docNo: string;
  docDate: string;
  status: RecordStatus;
  irn: string | null;
  ackNo: string | null;
  ackDate: Date | null;
  signedQrCode: string | null;
  qr: QrPayload | null;
  /** Until when the IRN may be cancelled (null when not active). */
  cancellableUntil: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancelRemark: string | null;
  error: RecordError | null;
  ewbNo: string | null;
  ewbDate: Date | null;
  ewbValidTill: Date | null;
  ewbStatus: EwbStatus | null;
  ewbCancelledAt: Date | null;
  createdAt: Date;
}

export interface InvoiceEInvoiceView {
  invoiceId: string;
  /** Active IRN (status generated), if any. */
  einvoice: RecordView | null;
  /** The active e-way bill (from the IRN record or a standalone one). */
  ewb: { ewbNo: string; ewbDate: Date | null; validTill: Date | null; recordId: string } | null;
  /** Last 10 records, newest first. */
  history: RecordView[];
}

/** What documents print on the bill PDF. */
export interface IrnInfo {
  irn: string;
  ackNo: string | null;
  ackDate: Date | null;
  signedQrCode: string | null;
  ewbNo: string | null;
  ewbDate: Date | null;
  ewbValidTill: Date | null;
  /** True when generated by the mock provider (print "TEST" on the bill). */
  mock: boolean;
}

export interface GenerateResult {
  record: RecordView;
  /** True when the invoice already had an active IRN (nothing was sent). */
  alreadyGenerated: boolean;
  /** Non-blocking validation notes. */
  warnings: ValidationIssue[];
}

interface Credentials {
  password: string;
  clientId: string | null;
  clientSecret: string | null;
}

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const STANDALONE: RecordStatus = "ewb_only";

export class EInvoiceService {
  private readonly db: Db;
  private readonly config: EInvoiceConfig;
  private readonly invoices: InvoiceDataPort;
  private readonly log: LoggerPort;
  private readonly box: SecretBox;
  private readonly now: () => Date;
  private readonly fetchFn?: typeof fetch;
  private readonly tokenCache: TokenCache;
  private readonly mock: MockDriver;
  private readonly fixedDrivers: Partial<Record<EInvoiceProvider, EInvoiceDriver>>;

  constructor(deps: EInvoiceDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.invoices = deps.invoices;
    this.log = deps.log ?? noopLogger;
    this.box = createSecretBox(deps.config.encryptionKey);
    this.now = deps.now ?? (() => new Date());
    this.fetchFn = deps.fetch;
    this.tokenCache = deps.tokenCache ?? memoryTokenCache();
    this.mock = new MockDriver(this.now);
    this.fixedDrivers = deps.drivers ?? {};
  }

  get allowMock() {
    return this.config.allowMock;
  }

  private get windowHours() {
    return this.config.cancelWindowHours ?? 24;
  }

  // ================================================================ account

  async getAccount(tenantId: string): Promise<AccountView> {
    const row = await this.accountRow(tenantId);
    return this.accountView(row, row ? this.credentials(row) : null);
  }

  async putAccount(tenantId: string, input: AccountInput): Promise<AccountView> {
    const data = accountInputSchema.parse(input);
    if (data.provider === "mock" && !this.config.allowMock) throw badRequest("The test (mock) provider is not available here");
    const existing = await this.accountRow(tenantId);
    const prev = existing ? this.credentials(existing) : null;
    const loginChanged =
      !existing || existing.provider !== data.provider || existing.gstin !== data.gstin || existing.username !== data.username || existing.sandbox !== data.sandbox;

    let creds: Credentials | null = null;
    if (data.provider === "gsp") {
      const password = data.password ?? prev?.password;
      if (!password) throw badRequest("Enter the API password");
      creds = {
        password,
        clientId: data.clientId === undefined ? (prev?.clientId ?? null) : (data.clientId || null),
        clientSecret: data.clientSecret === undefined ? (prev?.clientSecret ?? null) : (data.clientSecret || null),
      };
      if (loginChanged || data.password || data.clientId !== undefined || data.clientSecret !== undefined) {
        const driver = this.gspDriver({ gstin: data.gstin, username: data.username, sandbox: data.sandbox }, creds);
        try {
          await driver.authenticate();
        } catch (err) {
          if (err instanceof EInvoiceError && err.kind === "auth")
            throw new AppError(400, "invalid_credentials", "The e-invoice portal rejected this user name / password", { code: err.code });
          throw this.mapError(err);
        }
      }
    }

    const options: AccountOptions = { ...(existing?.options ?? {}) };
    if (data.maxAgeDays !== undefined) options.maxAgeDays = data.maxAgeDays;
    if (data.minHsnDigits !== undefined) options.minHsnDigits = data.minHsnDigits;
    const values = {
      provider: data.provider,
      gstin: data.gstin,
      username: data.username,
      passwordEnc: creds ? this.box.encrypt(creds.password) : null,
      clientCredentialsEnc:
        creds && (creds.clientId || creds.clientSecret)
          ? this.box.encrypt(JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret }))
          : null,
      sandbox: data.sandbox,
      enabled: data.enabled,
      options,
    };
    const [row] = await this.db
      .insert(einvoiceAccounts)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: einvoiceAccounts.tenantId, set: { ...values, updatedAt: this.now() } })
      .returning();
    this.log.info({ tenantId, provider: data.provider, sandbox: data.sandbox }, "einvoice: account saved");
    return this.accountView(row ?? null, creds);
  }

  async deleteAccount(tenantId: string): Promise<void> {
    await this.db.delete(einvoiceAccounts).where(eq(einvoiceAccounts.tenantId, tenantId));
  }

  private async accountRow(tenantId: string): Promise<EInvoiceAccountRow | null> {
    const [row] = await this.db.select().from(einvoiceAccounts).where(eq(einvoiceAccounts.tenantId, tenantId)).limit(1);
    return row ?? null;
  }

  private credentials(row: EInvoiceAccountRow): Credentials | null {
    if (!row.passwordEnc) return null;
    try {
      const password = this.box.decrypt(row.passwordEnc);
      let clientId: string | null = null;
      let clientSecret: string | null = null;
      if (row.clientCredentialsEnc) {
        const c = JSON.parse(this.box.decrypt(row.clientCredentialsEnc)) as { clientId?: string | null; clientSecret?: string | null };
        clientId = c.clientId ?? null;
        clientSecret = c.clientSecret ?? null;
      }
      return { password, clientId, clientSecret };
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId }, "einvoice: cannot decrypt account credentials");
      return null;
    }
  }

  private accountView(row: EInvoiceAccountRow | null, creds: Credentials | null): AccountView {
    return {
      configured: Boolean(row),
      provider: row?.provider ?? null,
      gstin: row?.gstin ?? null,
      username: row?.username || null,
      passwordSet: Boolean(creds?.password),
      clientCredentialsSet: Boolean(creds?.clientId || creds?.clientSecret),
      sandbox: row?.sandbox ?? true,
      enabled: row?.enabled ?? false,
      options: row?.options ?? {},
      usingMock: !row && this.config.allowMock,
    };
  }

  // ================================================================ drivers

  private gspDriver(a: { gstin: string; username: string; sandbox: boolean }, creds: Credentials): EInvoiceDriver {
    const fixed = this.fixedDrivers.gsp;
    if (fixed) return fixed;
    const platform = this.config.gsp?.[a.sandbox ? "sandbox" : "production"];
    if (!platform) throw new AppError(503, "einvoice_not_configured", `No ${a.sandbox ? "sandbox" : "production"} GSP is configured on this platform`);
    return new GspDriver({
      baseUrl: platform.baseUrl,
      endpoints: platform.endpoints,
      headers: platform.headers,
      errorKinds: platform.errorKinds,
      timeoutMs: platform.timeoutMs,
      credentials: {
        gstin: a.gstin,
        username: a.username,
        password: creds.password,
        clientId: creds.clientId ?? platform.clientId ?? null,
        clientSecret: creds.clientSecret ?? platform.clientSecret ?? null,
      },
      fetch: this.fetchFn,
      tokenCache: this.tokenCache,
      now: this.now,
    });
  }

  private driverFor(provider: EInvoiceProvider, account: EInvoiceAccountRow | null): EInvoiceDriver {
    if (provider === "mock") {
      if (!this.config.allowMock) throw badRequest("The test (mock) provider is not available here");
      return this.fixedDrivers.mock ?? this.mock;
    }
    if (!account || account.provider !== "gsp") throw new AppError(400, "einvoice_not_set_up", "Set up the e-invoice account first");
    const creds = this.credentials(account);
    if (!creds) throw new AppError(400, "einvoice_not_set_up", "Re-enter the e-invoice API password");
    return this.gspDriver(account, creds);
  }

  /** The account (null = implicit mock in development) and its active provider. */
  private async context(tenantId: string): Promise<{ account: EInvoiceAccountRow | null; provider: EInvoiceProvider }> {
    const account = await this.accountRow(tenantId);
    if (!account) {
      if (this.config.allowMock) return { account: null, provider: "mock" };
      throw new AppError(400, "einvoice_not_set_up", "Set up the e-invoice account first");
    }
    if (!account.enabled) throw new AppError(400, "einvoice_disabled", "E-invoicing is switched off in the account settings");
    return { account, provider: account.provider };
  }

  private validateOptions(account: EInvoiceAccountRow | null) {
    const o = account?.options ?? {};
    return {
      today: todayIST(this.now()),
      maxAgeDays: o.maxAgeDays !== undefined ? o.maxAgeDays : this.config.maxAgeDays === undefined ? DEFAULT_MAX_AGE_DAYS : this.config.maxAgeDays,
      minHsnDigits: o.minHsnDigits ?? this.config.minHsnDigits ?? 4,
    };
  }

  /** Maps provider errors to HTTP errors; anything else passes through. */
  mapError(err: unknown): unknown {
    if (!(err instanceof EInvoiceError)) return err;
    const details = { kind: err.kind, code: err.code, errors: err.opts.errors ?? [] };
    switch (err.kind) {
      case "auth":
        return new AppError(400, "einvoice_auth", "The e-invoice portal rejected the login; check the account settings", details);
      case "duplicate_irn":
        return new AppError(409, "duplicate_irn", "An IRN already exists for this bill number", details);
      case "cancel_window":
        return new AppError(409, "cancel_window", "The 24-hour cancellation window has passed; issue a credit note instead", details);
      case "not_active":
        return new AppError(409, "not_active", "This IRN / e-way bill is not active (already cancelled?)", details);
      case "invalid_gstin":
      case "validation":
        return new AppError(400, "einvoice_rejected", `The e-invoice portal rejected the bill: ${err.message}`, details);
      case "network":
        return new AppError(502, "provider_unreachable", "Could not reach the e-invoice portal, try again", details);
      default:
        return new AppError(502, "provider_error", `E-invoice portal error: ${err.message}`, details);
    }
  }

  private recordError(err: unknown): RecordError {
    if (err instanceof EInvoiceError) return { kind: err.kind, code: err.code, message: err.message, errors: err.opts.errors };
    return { kind: "internal", code: null, message: (err as Error)?.message ?? "Unknown error" };
  }

  // ================================================================ records

  private async activeRecord(tenantId: string, invoiceId: string): Promise<EInvoiceRecordRow | null> {
    const [row] = await this.db
      .select()
      .from(einvoiceRecords)
      .where(and(eq(einvoiceRecords.tenantId, tenantId), eq(einvoiceRecords.invoiceId, invoiceId), eq(einvoiceRecords.status, "generated")))
      .limit(1);
    return row ?? null;
  }

  private async history(tenantId: string, invoiceId: string, limit = 10): Promise<EInvoiceRecordRow[]> {
    return this.db
      .select()
      .from(einvoiceRecords)
      .where(and(eq(einvoiceRecords.tenantId, tenantId), eq(einvoiceRecords.invoiceId, invoiceId)))
      .orderBy(desc(einvoiceRecords.createdAt))
      .limit(limit);
  }

  private view(r: EInvoiceRecordRow): RecordView {
    const active = r.status === "generated" && r.ackDate;
    return {
      id: r.id,
      invoiceId: r.invoiceId,
      provider: r.provider,
      mock: r.provider === "mock",
      docType: r.docType,
      docNo: r.docNo,
      docDate: r.docDate,
      status: r.status,
      irn: r.irn,
      ackNo: r.ackNo,
      ackDate: r.ackDate,
      signedQrCode: r.signedQr,
      qr: decodeSignedQr(r.signedQr),
      cancellableUntil: active ? new Date(r.ackDate!.getTime() + this.windowHours * 3_600_000) : null,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      cancelRemark: r.cancelRemark,
      error: r.error ?? null,
      ewbNo: r.ewbNo,
      ewbDate: r.ewbDate,
      ewbValidTill: r.ewbValidTill,
      ewbStatus: r.ewbStatus,
      ewbCancelledAt: r.ewbCancelledAt,
      createdAt: r.createdAt,
    };
  }

  private async loadInvoice(tenantId: string, invoiceId: string): Promise<EInvoiceSource> {
    const src = await this.invoices.getInvoice(tenantId, invoiceId);
    if (!src) throw notFound("Invoice");
    return src;
  }

  // ================================================================ IRN

  async status(tenantId: string, invoiceId: string): Promise<InvoiceEInvoiceView> {
    const rows = await this.history(tenantId, invoiceId);
    const active = rows.find((r) => r.status === "generated") ?? null;
    const ewbRow = rows.find((r) => r.ewbNo && r.ewbStatus === "active") ?? null;
    return {
      invoiceId,
      einvoice: active ? this.view(active) : null,
      ewb: ewbRow ? { ewbNo: ewbRow.ewbNo!, ewbDate: ewbRow.ewbDate, validTill: ewbRow.ewbValidTill, recordId: ewbRow.id } : null,
      history: rows.map((r) => this.view(r)),
    };
  }

  /** The NIC JSON that would be sent, with validation issues (nothing is sent). */
  async preview(tenantId: string, invoiceId: string): Promise<{ payload: EInvoicePayload; ok: boolean; issues: ValidationIssue[] }> {
    const src = await this.loadInvoice(tenantId, invoiceId);
    const account = await this.accountRow(tenantId);
    const prep = prepareEInvoice(src, this.validateOptions(account));
    const issues = [...prep.issues, ...this.gstinMismatch(account, prep.payload)];
    return { payload: prep.payload, ok: !issues.some((i) => i.severity === "error"), issues };
  }

  private gstinMismatch(account: EInvoiceAccountRow | null, payload: EInvoicePayload): ValidationIssue[] {
    if (account && payload.SellerDtls.Gstin && account.gstin !== payload.SellerDtls.Gstin)
      return [
        {
          path: "SellerDtls.Gstin",
          code: "account_gstin_mismatch",
          message: `The bill's seller GSTIN (${payload.SellerDtls.Gstin}) is not the e-invoice account's GSTIN (${account.gstin})`,
          severity: "error",
        },
      ];
    return [];
  }

  /** Generates the IRN for a bill. Idempotent: an invoice with an active IRN returns it without calling NIC. */
  async generateIrn(tenantId: string, invoiceId: string): Promise<GenerateResult> {
    const active = await this.activeRecord(tenantId, invoiceId);
    if (active) return { record: this.view(active), alreadyGenerated: true, warnings: [] };

    const src = await this.loadInvoice(tenantId, invoiceId);
    const { account, provider } = await this.context(tenantId);
    const prep = prepareEInvoice(src, this.validateOptions(account));
    const issues = [...prep.issues, ...this.gstinMismatch(account, prep.payload)];
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length) throw new AppError(400, "einvoice_invalid", errors[0]!.message, { issues });
    const payload = prep.payload;

    const past = await this.history(tenantId, invoiceId, 50);
    if (past.some((r) => r.status === "cancelled" && r.docNo === payload.DocDtls.No && r.docType === payload.DocDtls.Typ))
      throw conflict("The IRN for this bill number was cancelled; NIC does not allow the same number again — issue a new bill");

    const driver = this.driverFor(provider, account);
    let res: IrnResult;
    try {
      res = await driver.generateIrn(payload);
    } catch (err) {
      if (err instanceof EInvoiceError && err.kind === "duplicate_irn") {
        res = await this.recoverDuplicate(driver, err, payload);
      } else {
        await this.saveFailure(tenantId, invoiceId, provider, payload, err);
        throw this.mapError(err);
      }
    }
    if (res.status === "CNL") throw conflict("NIC reports the IRN for this bill number as cancelled; issue a new bill");

    const values = {
      tenantId,
      invoiceId,
      provider,
      docType: payload.DocDtls.Typ,
      docNo: payload.DocDtls.No,
      docDate: src.date,
      irn: res.irn,
      ackNo: res.ackNo || null,
      ackDate: parseNicDateTime(res.ackDate) ?? this.now(),
      signedQr: res.signedQrCode,
      signedInvoice: res.signedInvoice,
      status: "generated" as const,
      payload,
      ewbNo: res.ewbNo ?? null,
      ewbDate: parseNicDateTime(res.ewbDate),
      ewbValidTill: parseNicDateTime(res.ewbValidTill),
      ewbStatus: res.ewbNo ? ("active" as const) : null,
    };
    try {
      const [row] = await this.db.insert(einvoiceRecords).values(values).returning();
      this.log.info({ tenantId, invoiceId, irn: res.irn, provider }, "einvoice: IRN generated");
      return { record: this.view(row!), alreadyGenerated: false, warnings: issues.filter((i) => i.severity === "warning") };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A parallel request saved it first.
      const again = await this.activeRecord(tenantId, invoiceId);
      if (!again) throw err;
      return { record: this.view(again), alreadyGenerated: true, warnings: [] };
    }
  }

  /** NIC 2150: fetch the existing IRN (by IRN from InfoDtls, else by document) so the shop gets its QR. */
  private async recoverDuplicate(driver: EInvoiceDriver, err: EInvoiceError, payload: EInvoicePayload): Promise<IrnResult> {
    const existing = err.opts.existing ?? null;
    let full: IrnResult | null = null;
    try {
      if (existing?.irn) full = await driver.getByIrn(existing.irn);
      if (!full && driver.getByDocument) full = await driver.getByDocument(payload.DocDtls.Typ, payload.DocDtls.No, payload.DocDtls.Dt);
    } catch (e) {
      this.log.warn({ err: e, irn: existing?.irn }, "einvoice: could not fetch the existing IRN after 2150");
    }
    if (full) return full;
    if (existing?.irn)
      return { irn: existing.irn, ackNo: existing.ackNo ?? "", ackDate: existing.ackDate ?? "", signedInvoice: null, signedQrCode: null, status: "ACT" };
    throw this.mapError(err);
  }

  private async saveFailure(tenantId: string, invoiceId: string, provider: EInvoiceProvider, payload: EInvoicePayload, err: unknown) {
    try {
      await this.db.insert(einvoiceRecords).values({
        tenantId,
        invoiceId,
        provider,
        docType: payload.DocDtls.Typ,
        docNo: payload.DocDtls.No,
        docDate: payload.DocDtls.Dt.split("/").reverse().join("-"),
        status: "failed",
        error: this.recordError(err),
        payload,
      });
    } catch (e) {
      this.log.warn({ err: e, tenantId, invoiceId }, "einvoice: could not save the failed attempt");
    }
    this.log.warn({ tenantId, invoiceId, err: this.recordError(err) }, "einvoice: IRN generation failed");
  }

  /** Cancels the active IRN within 24 h of acknowledgement. Reasons: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 others. */
  async cancelIrn(tenantId: string, invoiceId: string, input: CancelInput): Promise<RecordView> {
    const data = cancelInputSchema.parse(input);
    const rec = await this.activeRecord(tenantId, invoiceId);
    if (!rec || !rec.irn) throw notFound("Active e-invoice");
    if (rec.ewbNo && rec.ewbStatus === "active") throw conflict("Cancel the e-way bill first; NIC does not cancel an IRN with an active e-way bill");
    const now = this.now();
    if (rec.ackDate && !withinHours(rec.ackDate, now, this.windowHours))
      throw new AppError(409, "cancel_window", `An IRN can only be cancelled within ${this.windowHours} hours; issue a credit note instead`);
    const { account } = await this.contextForRecord(tenantId, rec);
    const driver = this.driverFor(rec.provider, account);
    let cancelledAt = now;
    try {
      const res = await driver.cancelIrn(buildCancelIrn(rec.irn, data.reason, data.remark));
      cancelledAt = parseNicDateTime(res.cancelDate) ?? now;
    } catch (err) {
      // NIC says it is not active any more: it was cancelled elsewhere (portal / GSP), so mirror that.
      if (!(err instanceof EInvoiceError && err.kind === "not_active")) throw this.mapError(err);
      this.log.warn({ tenantId, invoiceId, irn: rec.irn }, "einvoice: IRN already inactive at NIC; marking cancelled");
    }
    const [row] = await this.db
      .update(einvoiceRecords)
      .set({ status: "cancelled", cancelledAt, cancelReason: String(data.reason), cancelRemark: data.remark ?? null, updatedAt: now })
      .where(and(eq(einvoiceRecords.tenantId, tenantId), eq(einvoiceRecords.id, rec.id)))
      .returning();
    this.log.info({ tenantId, invoiceId, irn: rec.irn }, "einvoice: IRN cancelled");
    return this.view(row ?? { ...rec, status: "cancelled", cancelledAt });
  }

  /** Account for an existing record: its provider may differ from today's account (e.g. mock in development). */
  private async contextForRecord(tenantId: string, rec: EInvoiceRecordRow): Promise<{ account: EInvoiceAccountRow | null }> {
    const account = await this.accountRow(tenantId);
    if (rec.provider === "gsp" && !account) throw new AppError(400, "einvoice_not_set_up", "Set up the e-invoice account first");
    return { account };
  }

  // ================================================================ e-way bill

  /**
   * E-way bill for a bill: from its IRN, or standalone (`standalone: true`) for bills without one. Idempotent: an
   * active e-way bill is returned as-is.
   */
  async generateEwb(tenantId: string, invoiceId: string, input: EwbRequestInput): Promise<{ record: RecordView; alreadyGenerated: boolean }> {
    const data = ewbInputSchema.parse(input);
    const ewbInput: EwbInput = {
      distance: data.distance,
      transMode: (data.transMode ?? null) as EwbInput["transMode"],
      transporterId: data.transporterId ?? null,
      transporterName: data.transporterName ?? null,
      transDocNo: data.transDocNo ?? null,
      transDocDate: data.transDocDate ?? null,
      vehicleNo: data.vehicleNo ?? null,
      vehicleType: data.vehicleType ?? null,
    };
    const today = todayIST(this.now());
    const rows = await this.history(tenantId, invoiceId, 50);
    const activeEwb = rows.find((r) => r.ewbNo && r.ewbStatus === "active");
    if (activeEwb) return { record: this.view(activeEwb), alreadyGenerated: true };
    const irnRec = rows.find((r) => r.status === "generated" && r.irn);

    if (irnRec) {
      const check = validateEwbInput(ewbInput, { docDate: irnRec.docDate, today });
      if (!check.ok) throw new AppError(400, "ewb_invalid", check.issues[0]!.message, { issues: check.issues });
      const { account } = await this.contextForRecord(tenantId, irnRec);
      const driver = this.driverFor(irnRec.provider, account);
      const payload = buildEwbByIrn(irnRec.irn!, ewbInput);
      let res;
      try {
        res = await driver.generateEwb({ kind: "irn", payload });
      } catch (err) {
        throw this.mapError(err);
      }
      const [row] = await this.db
        .update(einvoiceRecords)
        .set({
          ewbNo: res.ewbNo,
          ewbDate: parseNicDateTime(res.ewbDate) ?? this.now(),
          ewbValidTill: parseNicDateTime(res.ewbValidTill),
          ewbStatus: "active",
          ewbCancelledAt: null,
          ewbPayload: payload,
          updatedAt: this.now(),
        })
        .where(and(eq(einvoiceRecords.tenantId, tenantId), eq(einvoiceRecords.id, irnRec.id)))
        .returning();
      this.log.info({ tenantId, invoiceId, ewbNo: res.ewbNo }, "einvoice: e-way bill generated from IRN");
      return { record: this.view(row!), alreadyGenerated: false };
    }

    if (!data.standalone) throw conflict("Generate the e-invoice (IRN) first, or create a standalone e-way bill");
    const src = await this.loadInvoice(tenantId, invoiceId);
    if (src.status === "draft" || src.status === "cancelled" || !src.number) throw badRequest("Issue the bill before creating an e-way bill");
    const { account, provider } = await this.context(tenantId);
    const payload = buildStandaloneEwb(src, ewbInput);
    const issues = [...validateStandaloneEwb(payload).issues, ...validateEwbInput(ewbInput, { docDate: src.date, today }).issues];
    if (account && payload.fromGstin !== account.gstin)
      issues.push({ path: "fromGstin", code: "account_gstin_mismatch", message: "The bill's seller GSTIN is not the account's GSTIN", severity: "error" });
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length) throw new AppError(400, "ewb_invalid", errors[0]!.message, { issues });
    const driver = this.driverFor(provider, account);
    let res;
    try {
      res = await driver.generateEwb({ kind: "standalone", payload });
    } catch (err) {
      throw this.mapError(err);
    }
    const [row] = await this.db
      .insert(einvoiceRecords)
      .values({
        tenantId,
        invoiceId,
        provider,
        docType: "INV",
        docNo: payload.docNo,
        docDate: src.date,
        status: STANDALONE,
        ewbNo: res.ewbNo,
        ewbDate: parseNicDateTime(res.ewbDate) ?? this.now(),
        ewbValidTill: parseNicDateTime(res.ewbValidTill),
        ewbStatus: "active",
        ewbPayload: payload,
      })
      .returning();
    this.log.info({ tenantId, invoiceId, ewbNo: res.ewbNo }, "einvoice: standalone e-way bill generated");
    return { record: this.view(row!), alreadyGenerated: false };
  }

  /** Cancels the active e-way bill within 24 h. Reasons: 1 duplicate, 2 order cancelled, 3 data entry mistake, 4 others. */
  async cancelEwb(tenantId: string, invoiceId: string, input: CancelInput): Promise<RecordView> {
    const data = cancelInputSchema.parse(input);
    const rows = await this.history(tenantId, invoiceId, 50);
    const rec = rows.find((r) => r.ewbNo && r.ewbStatus === "active");
    if (!rec) throw notFound("Active e-way bill");
    const now = this.now();
    if (rec.ewbDate && !withinHours(rec.ewbDate, now, this.windowHours))
      throw new AppError(409, "cancel_window", `An e-way bill can only be cancelled within ${this.windowHours} hours`);
    const { account } = await this.contextForRecord(tenantId, rec);
    const driver = this.driverFor(rec.provider, account);
    let cancelledAt = now;
    try {
      const res = await driver.cancelEwb(buildCancelEwb(rec.ewbNo!, data.reason, data.remark));
      cancelledAt = parseNicDateTime(res.cancelDate) ?? now;
    } catch (err) {
      if (!(err instanceof EInvoiceError && err.kind === "not_active")) throw this.mapError(err);
    }
    const [row] = await this.db
      .update(einvoiceRecords)
      .set({ ewbStatus: "cancelled", ewbCancelledAt: cancelledAt, updatedAt: now })
      .where(and(eq(einvoiceRecords.tenantId, tenantId), eq(einvoiceRecords.id, rec.id)))
      .returning();
    this.log.info({ tenantId, invoiceId, ewbNo: rec.ewbNo }, "einvoice: e-way bill cancelled");
    return this.view(row ?? { ...rec, ewbStatus: "cancelled", ewbCancelledAt: cancelledAt });
  }

  // ================================================================ documents + GSTR-1

  /** For documents: the active IRN of a bill (IRN, Ack no / date, signed QR, e-way bill), or null. */
  async irnFor(tenantId: string, invoiceId: string): Promise<IrnInfo | null> {
    const rows = await this.history(tenantId, invoiceId, 20);
    const r = rows.find((x) => x.status === "generated" && x.irn);
    if (!r) return null;
    const ewb = r.ewbStatus === "active" ? r : rows.find((x) => x.ewbStatus === "active");
    return {
      irn: r.irn!,
      ackNo: r.ackNo,
      ackDate: r.ackDate,
      signedQrCode: r.signedQr,
      ewbNo: ewb?.ewbNo ?? null,
      ewbDate: ewb?.ewbDate ?? null,
      ewbValidTill: ewb?.ewbValidTill ?? null,
      mock: r.provider === "mock",
    };
  }

  /**
   * GSTR-1 JSON for a return period ("MMYYYY"). GSTR-1 is filed per GSTIN: a shop whose branches have their own
   * GSTINs (another state) files one return per GSTIN, so only bills whose seller GSTIN is the chosen one are exported.
   * The GSTIN is `opts.gstin`, else the e-invoice account's, else the GSTIN on most of the period's bills.
   */
  async gstr1(tenantId: string, period: string, opts: { gstin?: string | null; range?: { from: string; to: string } } = {}): Promise<Gstr1Result & { filename: string }> {
    const monthRange = periodRange(period);
    if (!monthRange) throw badRequest("Use the return period as MMYYYY, e.g. 102026");
    const range = opts.range ?? monthRange;
    const [account, all] = await Promise.all([this.accountRow(tenantId), this.invoices.listForPeriod(tenantId, range)]);
    if (opts.gstin && !isValidGstin(opts.gstin)) throw badRequest("Invalid GSTIN");
    const counts = new Map<string, number>();
    for (const i of all) if (i.seller.gstin && isValidGstin(i.seller.gstin)) counts.set(normalizeGstin(i.seller.gstin), (counts.get(normalizeGstin(i.seller.gstin)) ?? 0) + 1);
    const mostUsed = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const gstin = opts.gstin ?? account?.gstin ?? mostUsed;
    if (!gstin) throw badRequest("Add the shop's GSTIN (billing settings or e-invoice account) to export GSTR-1");
    const own = normalizeGstin(gstin);
    // Bills without a seller GSTIN (issued before the profile had one) count for the shop's main GSTIN.
    const invoices = all.filter((i) => (i.seller.gstin ? normalizeGstin(i.seller.gstin) === own : !opts.gstin));
    const res = buildGstr1(invoices, { gstin, period, ...(opts.range ? { range: opts.range } : {}) });
    return { ...res, filename: `GSTR1_${normalizeGstin(gstin)}_${period}.json` };
  }
}
