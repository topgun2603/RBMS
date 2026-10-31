import {
  badRequest,
  conflict,
  forbidden,
  hasPermission,
  isSuperAdmin,
  notFound,
  requireUser,
  tooMany,
  type AuditPort,
  type ListPage,
  type RequestContext,
} from "@rbms/core";
import { REVIEW_SORT, reviewFilter, reviewListQuerySchema, type ReviewListQuery } from "./list";
import type { Db } from "@rbms/db";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { aggregateSubject, referenceName, type CheckFacts, type SubjectSummary } from "./aggregate";
import { HttpKycDriver, type HttpProviderConfig } from "./drivers/http";
import { MockKycDriver } from "./drivers/mock";
import { KycProviderError, type DriverOutcome, type KycDriver } from "./drivers/types";
import { KYC_MANAGE } from "./features";
import { last4, maskAccountNumber, maskPan, maskVpa, scrubPii } from "./mask";
import { NAME_MATCH_THRESHOLD, nameMatchScore } from "./names";
import { noopLogger, type KycStatus, type KycStatusListener, type LoggerPort, type VendorAccessPort } from "./ports";
import {
  CHECK_TYPES,
  DOCUMENT_KINDS,
  SUBJECT_TYPES,
  type CheckStatus,
  type CheckType,
  type DocumentKind,
  type KycCheckRow,
  type KycDocumentRow,
  type KycSubjectRow,
  type SubjectType,
} from "./schema";
import { DrizzleKycStore, type KycStore, type NewCheck, type ReviewPage } from "./store";
import {
  isValidAccountNumber,
  isValidIfsc,
  isValidVpa,
  normalizeAccountNumber,
  normalizeIfsc,
  normalizeVpa,
  validateGstin,
  validatePan,
  type PanOptions,
} from "./validators";

export interface KycConfig {
  /** Which driver to build when `deps.driver` isn't given. Default `mock`. */
  provider?: "mock" | "http";
  /** Platform-wide provider settings (base URL + token), required for `provider: "http"`. */
  http?: Omit<HttpProviderConfig, "fetch">;
  /** The mock driver is refused unless this is true (set false in production). */
  allowMock: boolean;
  /** Keys the input fingerprints (HMAC-SHA256). Use the app secret. */
  secret: string;
  /** Bank / UPI vs PAN name, and expected-name checks. Default 80. */
  nameMatchThreshold?: number;
  /** Selfie confidence below this goes to manual review. Default 80. */
  selfieMinScore?: number;
  /** Checks per subject per type in 24 h (provider calls cost money). Default 10. */
  maxChecksPerDay?: number;
  /** Document / selfie URLs must start with one of these (e.g. the uploads public base URL). Unset = any https URL or `/` path. */
  fileUrlPrefixes?: string[];
  /** Default DigiLocker return URL when the caller doesn't send one. */
  digilockerRedirectUrl?: string;
  /**
   * Reject PANs (also inside GSTINs) whose 4th letter is not a known holder type. Default: on when the mock is off
   * (production), off when the mock is allowed so the sample PAN `ABCDE1234F` (4th letter D) works in development.
   */
  strictPanEntityType?: boolean;
}

export interface KycDeps {
  /** Needed unless `store` is given. */
  db?: Db;
  store?: KycStore;
  config: KycConfig;
  /** Overrides the driver built from `config.provider`. */
  driver?: KycDriver;
  vendors?: VendorAccessPort;
  onStatusChange?: KycStatusListener;
  /** Records super-admin review decisions (`kyc.review.approve|reject`) under the check's shop. */
  audit?: AuditPort;
  log?: LoggerPort;
  fetch?: typeof fetch;
  now?: () => Date;
}

// ---------------------------------------------------------------- inputs

/** Where a review decision came from (for the audit entry). */
export interface ReviewMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const name = z.string().trim().min(1).max(200).optional();
const fileUrl = z.string().trim().min(1).max(2000);

/** Per-type input. `.strict()` so nobody can sneak an Aadhaar number (or anything else) into a stored payload. */
export const CHECK_INPUTS = {
  pan: z.object({ pan: z.string().max(20), name, dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  gstin: z.object({ gstin: z.string().max(20), name }).strict(),
  bank_account: z.object({ accountNumber: z.string().max(30), ifsc: z.string().max(15), name }).strict(),
  upi: z.object({ vpa: z.string().max(300), name }).strict(),
  digilocker_aadhaar: z.object({ redirectUrl: z.string().url().max(2000).optional(), name }).strict(),
  selfie: z.object({ selfieUrl: fileUrl, referenceUrl: fileUrl.optional() }).strict(),
} satisfies Record<CheckType, z.ZodTypeAny>;

export const submitCheckSchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  type: z.enum(CHECK_TYPES),
  input: z.record(z.unknown()).default({}),
});
export type SubmitCheckInput = z.input<typeof submitCheckSchema>;

export const documentSchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  fileUrl,
});
export type DocumentInput = z.input<typeof documentSchema>;

/** A normalised, locally validated check request: what goes to the driver, what is stored, and the fingerprint source. */
interface Prepared {
  type: CheckType;
  driverInput: Record<string, string | null | undefined>;
  masked: Record<string, unknown>;
  /** Normalised identifier to fingerprint (null for selfie / DigiLocker). */
  identifier: string | null;
  expectedName: string | null;
}

// ---------------------------------------------------------------- DTOs

export interface CheckDto {
  id: string;
  subjectId: string;
  type: CheckType;
  status: CheckStatus;
  provider: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  nameOnRecord: string | null;
  nameMatchScore: number | null;
  error: string | null;
  review: { decision: "approved" | "rejected"; reason: string | null; by: string | null; at: Date | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toCheckDto = (c: KycCheckRow): CheckDto => ({
  id: c.id,
  subjectId: c.subjectId,
  type: c.type,
  status: c.status,
  provider: c.provider,
  input: c.inputMasked,
  result: c.result,
  nameOnRecord: c.nameOnRecord,
  nameMatchScore: c.nameMatchScore,
  error: c.error,
  review: c.reviewDecision ? { decision: c.reviewDecision, reason: c.reviewReason, by: c.reviewedBy, at: c.reviewedAt } : null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export interface DocumentDto {
  id: string;
  kind: DocumentKind;
  fileUrl: string;
  createdAt: Date;
}
const toDocumentDto = (d: KycDocumentRow): DocumentDto => ({ id: d.id, kind: d.kind, fileUrl: d.fileUrl, createdAt: d.createdAt });

export interface SubjectDto extends KycStatus {
  checks: CheckDto[];
  documents: DocumentDto[];
}

export interface ReviewItem {
  check: CheckDto;
  subject: { id: string; tenantId: string; subjectType: SubjectType; subjectId: string; status: KycSubjectRow["status"]; verifiedName: string | null };
  /** The name the check was compared with (verified PAN name or the expected name), when known. */
  comparedWith: string | null;
}

const toFacts = (c: KycCheckRow): CheckFacts => ({
  type: c.type,
  status: c.status,
  createdAt: c.createdAt,
  nameOnRecord: c.nameOnRecord,
  nameMatchScore: c.nameMatchScore,
  approved: c.reviewDecision === "approved",
});
/** Store lists are newest first; the status rules want oldest first so equal timestamps resolve to the newer row. */
const factsOf = (rows: readonly KycCheckRow[]) => [...rows].reverse().map(toFacts);

const DAY_MS = 86_400_000;

/**
 * KYC checks, subject status and the review queue. Raw identifiers live only for the duration of `submitCheck`: the
 * driver gets them, the database gets masked values + a keyed fingerprint, logs get neither.
 */
export class KycService {
  readonly store: KycStore;
  readonly driver: KycDriver;
  private readonly config: KycConfig;
  private readonly vendors?: VendorAccessPort;
  private readonly onStatusChange?: KycStatusListener;
  private readonly audit?: AuditPort;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  readonly threshold: number;

  constructor(deps: KycDeps) {
    if (!deps.config.secret) throw new Error("kyc: config.secret is required");
    if (!deps.store && !deps.db) throw new Error("kyc: db or store is required");
    this.config = deps.config;
    this.store = deps.store ?? new DrizzleKycStore(deps.db!);
    this.vendors = deps.vendors;
    this.onStatusChange = deps.onStatusChange;
    this.audit = deps.audit;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.threshold = deps.config.nameMatchThreshold ?? NAME_MATCH_THRESHOLD;
    this.panOptions = { strictEntity: deps.config.strictPanEntityType ?? !deps.config.allowMock };
    this.driver = deps.driver ?? this.buildDriver(deps.fetch);
  }
  private readonly panOptions: PanOptions;

  private buildDriver(fetchFn?: typeof fetch): KycDriver {
    if (this.config.provider === "http") {
      if (!this.config.http) throw new Error("kyc: config.http is required for provider http");
      return new HttpKycDriver({ ...this.config.http, fetch: fetchFn });
    }
    if (!this.config.allowMock) throw new Error("kyc: the mock provider is disabled (set provider: http)");
    return new MockKycDriver();
  }

  // ------------------------------------------------------------ access

  /**
   * May the signed-in user act on (and see) this subject? Super-admins and holders of `kyc.manage` (owners/admins always)
   * for any subject of the tenant; a vendor's owner for that vendor; a user for themselves. Throws 401/403/400.
   */
  async assertAccess(ctx: RequestContext, subjectType: SubjectType, subjectId: string): Promise<string> {
    const user = requireUser(ctx);
    const tenantId = ctx.tenant?.id;
    if (!tenantId) throw forbidden("This action needs a tenant");
    if (subjectType === "shop" && subjectId !== tenantId) throw badRequest("For shop KYC the subject id is the shop's own id");
    if (subjectType === "vendor" && this.vendors?.vendorExists && !(await this.vendors.vendorExists(tenantId, subjectId))) throw notFound("Vendor");
    if (isSuperAdmin(ctx) || hasPermission(ctx, KYC_MANAGE)) return tenantId;
    // Your own user KYC, but only in a shop you belong to: a resolved shop alone is not access to it.
    if (subjectType === "user" && subjectId === user.id && user.tenantRoles.length > 0) return tenantId;
    if (subjectType === "vendor" && this.vendors && (await this.vendors.isVendorOwner(tenantId, subjectId, user.id))) return tenantId;
    throw forbidden();
  }

  // ------------------------------------------------------------ checks

  /** Validates locally, calls the provider, stores the masked result and recomputes the subject. */
  async submitCheck(tenantId: string, actorUserId: string | null, raw: SubmitCheckInput): Promise<{ check: CheckDto; subject: KycStatus }> {
    const req = submitCheckSchema.parse(raw);
    if (req.subjectType === "shop" && req.subjectId !== tenantId) throw badRequest("For shop KYC the subject id is the shop's own id");
    const prepared = this.prepare(req.type, req.input);

    const subject = await this.store.ensureSubject(tenantId, req.subjectType, req.subjectId);
    const recent = await this.store.countChecksSince(tenantId, subject.id, req.type, new Date(this.now().getTime() - DAY_MS));
    if (recent >= (this.config.maxChecksPerDay ?? 10)) throw tooMany("Too many verification attempts for this check today");

    const prior = factsOf(await this.store.listChecks(tenantId, subject.id));
    const outcome = await this.runDriver(tenantId, prepared);

    const compareWith = req.type === "bank_account" || req.type === "upi" ? referenceName(prior, prepared.expectedName) : prepared.expectedName;
    const values: NewCheck = {
      tenantId,
      subjectId: subject.id,
      type: req.type,
      provider: this.driver.provider,
      inputMasked: prepared.masked,
      inputFingerprint: prepared.identifier ? this.fingerprint(req.type, prepared.identifier) : null,
      createdBy: actorUserId,
      ...this.evaluate(req.type, outcome, compareWith),
    };
    const check = await this.store.insertCheck(values);
    const status = await this.recompute(tenantId, subject);
    this.log.info({ tenantId, checkId: check.id, type: check.type, status: check.status, provider: check.provider }, "kyc check");
    return { check: toCheckDto(check), subject: status };
  }

  /** Polls a pending DigiLocker check. Other checks are returned unchanged. */
  async refreshCheck(tenantId: string, checkId: string): Promise<{ check: CheckDto; subject: KycStatus }> {
    const check = await this.store.checkById(tenantId, checkId);
    if (!check) throw notFound("Check");
    const subject = await this.store.subjectById(tenantId, check.subjectId);
    if (!subject) throw notFound("Subject");
    if (check.status !== "pending" || check.type !== "digilocker_aadhaar" || !check.providerRef) {
      return { check: toCheckDto(check), subject: await this.statusOf(tenantId, subject) };
    }
    let outcome: DriverOutcome;
    try {
      outcome = await this.driver.fetchDigilocker(check.providerRef);
    } catch (err) {
      if (!(err instanceof KycProviderError)) throw err;
      this.log.warn({ tenantId, checkId, provider: err.provider, status: err.status, code: err.code }, "kyc provider error");
      return { check: toCheckDto(check), subject: await this.statusOf(tenantId, subject) };
    }
    const expected = typeof check.inputMasked.name === "string" ? check.inputMasked.name : null;
    const { providerRef: _ignored, ...patch } = this.evaluate("digilocker_aadhaar", outcome, expected);
    const updated = await this.store.updateCheck(tenantId, check.id, patch);
    const status = await this.recompute(tenantId, subject);
    return { check: toCheckDto(updated), subject: status };
  }

  /** Format checks + normalisation + masking for one check type. Throws 400 (no provider call) on bad input. */
  prepare(type: CheckType, input: Record<string, unknown>): Prepared {
    const parsed = CHECK_INPUTS[type].safeParse(input);
    if (!parsed.success) {
      const keys = parsed.error.issues.map((i) => i.path.join(".") || i.message);
      throw badRequest(`Invalid ${type} input`, { fields: keys });
    }
    const v = parsed.data as Record<string, string | undefined>;
    const expectedName = v.name?.trim() || null;
    switch (type) {
      case "pan": {
        const r = validatePan(v.pan, this.panOptions);
        if (!r.ok) throw badRequest(r.reason, { field: "pan" });
        return {
          type,
          driverInput: { pan: r.pan, name: expectedName, dob: v.dob ?? null },
          masked: { pan: maskPan(r.pan), entityType: r.entityType, ...(expectedName ? { name: expectedName } : {}) },
          identifier: r.pan,
          expectedName,
        };
      }
      case "gstin": {
        const r = validateGstin(v.gstin, this.panOptions);
        if (!r.ok) throw badRequest(r.reason, { field: "gstin" });
        // GSTINs are public registry data; kept in full (needed on invoices anyway). The embedded PAN is masked.
        return {
          type,
          driverInput: { gstin: r.gstin },
          masked: { gstin: r.gstin, stateCode: r.stateCode, pan: maskPan(r.pan), ...(expectedName ? { name: expectedName } : {}) },
          identifier: r.gstin,
          expectedName,
        };
      }
      case "bank_account": {
        if (!isValidAccountNumber(v.accountNumber)) throw badRequest("Account number must be 9 to 18 digits", { field: "accountNumber" });
        if (!isValidIfsc(v.ifsc)) throw badRequest("IFSC must look like SBIN0001234", { field: "ifsc" });
        const acc = normalizeAccountNumber(v.accountNumber!);
        const ifsc = normalizeIfsc(v.ifsc!);
        return {
          type,
          driverInput: { accountNumber: acc, ifsc, name: expectedName },
          masked: { accountNumber: maskAccountNumber(acc), accountLast4: last4(acc), ifsc, ...(expectedName ? { name: expectedName } : {}) },
          identifier: `${ifsc}:${acc}`,
          expectedName,
        };
      }
      case "upi": {
        if (!isValidVpa(v.vpa)) throw badRequest("UPI ID must look like name@bank", { field: "vpa" });
        const vpa = normalizeVpa(v.vpa!);
        return {
          type,
          driverInput: { vpa, name: expectedName },
          masked: { vpa: maskVpa(vpa), ...(expectedName ? { name: expectedName } : {}) },
          identifier: vpa,
          expectedName,
        };
      }
      case "digilocker_aadhaar": {
        const redirectUrl = v.redirectUrl ?? this.config.digilockerRedirectUrl ?? null;
        return { type, driverInput: { redirectUrl, name: expectedName }, masked: expectedName ? { name: expectedName } : {}, identifier: null, expectedName };
      }
      case "selfie": {
        this.assertFileUrl(v.selfieUrl!, "selfieUrl");
        if (v.referenceUrl) this.assertFileUrl(v.referenceUrl, "referenceUrl");
        return {
          type,
          driverInput: { selfieUrl: v.selfieUrl, referenceUrl: v.referenceUrl ?? null },
          masked: { selfieUrl: v.selfieUrl, ...(v.referenceUrl ? { referenceUrl: v.referenceUrl } : {}) },
          identifier: null,
          expectedName: null,
        };
      }
    }
  }

  private async runDriver(tenantId: string, p: Prepared): Promise<DriverOutcome> {
    const i = p.driverInput;
    try {
      switch (p.type) {
        case "pan":
          return await this.driver.verifyPan({ pan: i.pan!, name: i.name, dob: i.dob });
        case "gstin":
          return await this.driver.verifyGstin({ gstin: i.gstin! });
        case "bank_account":
          return await this.driver.verifyBankAccount({ accountNumber: i.accountNumber!, ifsc: i.ifsc!, name: i.name });
        case "upi":
          return await this.driver.verifyUpi({ vpa: i.vpa!, name: i.name });
        case "digilocker_aadhaar":
          return await this.driver.startDigilocker({ redirectUrl: i.redirectUrl, name: i.name });
        case "selfie":
          return await this.driver.matchSelfie({ selfieUrl: i.selfieUrl!, referenceUrl: i.referenceUrl });
      }
    } catch (err) {
      if (!(err instanceof KycProviderError)) throw err;
      // Never log the input: only what identifies the failure.
      this.log.warn({ tenantId, type: p.type, provider: err.provider, status: err.status, code: err.code }, "kyc provider error");
      return { status: "failed", name: null, details: {}, error: `provider_${err.code}` };
    }
  }

  /** Driver outcome → stored check fields: scrubbed result, name-match score, and the review rules. */
  evaluate(type: CheckType, outcome: DriverOutcome, compareWith: string | null) {
    const result = scrubPii({ ...outcome.details, ...(outcome.actionUrl ? { actionUrl: outcome.actionUrl } : {}) }) as Record<string, unknown>;
    if (outcome.score != null) result.score = outcome.score;
    const nameOnRecord = outcome.name?.trim() ? outcome.name.trim().toUpperCase() : null;
    const score = nameOnRecord && compareWith && type !== "selfie" ? nameMatchScore(compareWith, nameOnRecord) : null;
    let status: CheckStatus = outcome.status;
    let error = outcome.status === "failed" ? (outcome.error ?? "verification_failed") : null;
    if (status === "verified" && score != null && score < this.threshold) {
      status = "manual_review";
      error = "name_mismatch";
    }
    if (status === "verified" && type === "selfie" && (outcome.score ?? 0) < (this.config.selfieMinScore ?? 80)) {
      status = "manual_review";
      error = "low_confidence";
    }
    return { status, result, nameOnRecord, nameMatchScore: score, error, providerRef: outcome.providerRef ?? null };
  }

  private fingerprint(type: CheckType, identifier: string) {
    return createHmac("sha256", this.config.secret).update(`kyc:${type}:${identifier}`).digest("hex");
  }

  private assertFileUrl(url: string, field: string) {
    const prefixes = this.config.fileUrlPrefixes;
    const ok = prefixes?.length ? prefixes.some((p) => url.startsWith(p)) : /^https:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//"));
    if (!ok) throw badRequest("File must be uploaded through the uploads module", { field });
  }

  // ------------------------------------------------------------ subjects

  private async statusOf(tenantId: string, subject: KycSubjectRow, checks?: KycCheckRow[]): Promise<KycStatus> {
    const rows = checks ?? (await this.store.listChecks(tenantId, subject.id));
    const s = aggregateSubject(subject.subjectType, factsOf(rows), { nameMatchThreshold: this.threshold });
    return toStatus(subject.subjectType, subject.subjectId, s, subject.updatedAt);
  }

  /** Re-derives the subject from its checks, stores it when it changed and tells the listener. */
  private async recompute(tenantId: string, subject: KycSubjectRow): Promise<KycStatus> {
    const checks = await this.store.listChecks(tenantId, subject.id);
    const s = aggregateSubject(subject.subjectType, factsOf(checks), { nameMatchThreshold: this.threshold });
    const previous = subject.status;
    const changed = previous !== s.status || subject.verifiedName !== s.verifiedName || subject.badges.join(",") !== s.badges.join(",");
    const row = changed ? await this.store.updateSubject(tenantId, subject.id, { status: s.status, verifiedName: s.verifiedName, badges: s.badges }) : subject;
    const status = toStatus(row.subjectType, row.subjectId, s, row.updatedAt);
    if (previous !== s.status && this.onStatusChange) {
      try {
        await this.onStatusChange(tenantId, status, previous);
      } catch (err) {
        this.log.error({ tenantId, subjectType: row.subjectType, subjectId: row.subjectId, err: (err as Error)?.message }, "kyc status listener failed");
      }
    }
    return status;
  }

  /** `KycStatusPort`: the subject's derived status (`none` when it has no checks). */
  async status(tenantId: string, subjectType: SubjectType, subjectId: string): Promise<KycStatus> {
    const subject = await this.store.findSubject(tenantId, subjectType, subjectId);
    if (!subject) return toStatus(subjectType, subjectId, aggregateSubject(subjectType, []), null);
    return this.statusOf(tenantId, subject);
  }

  /** Status + every check (newest first) + documents. */
  async getSubject(tenantId: string, subjectType: SubjectType, subjectId: string): Promise<SubjectDto> {
    const subject = await this.store.findSubject(tenantId, subjectType, subjectId);
    if (!subject) return { ...toStatus(subjectType, subjectId, aggregateSubject(subjectType, []), null), checks: [], documents: [] };
    const checks = await this.store.listChecks(tenantId, subject.id);
    const documents = await this.store.listDocuments(tenantId, subject.id);
    return { ...(await this.statusOf(tenantId, subject, checks)), checks: checks.map(toCheckDto), documents: documents.map(toDocumentDto) };
  }

  // ------------------------------------------------------------ documents

  async addDocument(tenantId: string, actorUserId: string | null, raw: DocumentInput): Promise<DocumentDto> {
    const d = documentSchema.parse(raw);
    if (d.subjectType === "shop" && d.subjectId !== tenantId) throw badRequest("For shop KYC the subject id is the shop's own id");
    this.assertFileUrl(d.fileUrl, "fileUrl");
    const subject = await this.store.ensureSubject(tenantId, d.subjectType, d.subjectId);
    const row = await this.store.insertDocument({ tenantId, subjectId: subject.id, kind: d.kind, fileUrl: d.fileUrl, uploadedBy: actorUserId });
    return toDocumentDto(row);
  }

  /** The subject a document belongs to (for access checks before `removeDocument`). */
  async documentSubject(tenantId: string, documentId: string): Promise<{ subjectType: SubjectType; subjectId: string }> {
    const doc = await this.store.documentById(tenantId, documentId);
    if (!doc) throw notFound("Document");
    const subject = await this.store.subjectById(tenantId, doc.subjectId);
    if (!subject) throw notFound("Document");
    return { subjectType: subject.subjectType, subjectId: subject.subjectId };
  }

  async removeDocument(tenantId: string, documentId: string): Promise<void> {
    const doc = await this.store.documentById(tenantId, documentId);
    if (!doc) throw notFound("Document");
    await this.store.deleteDocument(tenantId, documentId);
  }

  // ------------------------------------------------------------ review (super-admin)

  /** Checks waiting for a human, oldest first. `tenantId` null = every shop. */
  /**
   * Super-admin review list: by default the queue (checks waiting for review, oldest first); filters status (`all`),
   * check type, shop and a name search; sort submitted / match. See ./list.ts.
   */
  async reviewQueue(query: ReviewListQuery = {}): Promise<ListPage<ReviewItem> & { facets: ReviewPage["facets"] }> {
    const p = reviewListQuerySchema.parse(query);
    const { items, total, facets } = await this.store.listReview({ ...reviewFilter(p), sort: REVIEW_SORT.parse(p.sort), limit: p.limit, offset: p.offset });
    const out: ReviewItem[] = [];
    for (const { check, subject } of items) {
      let comparedWith: string | null = null;
      if (check.type === "bank_account" || check.type === "upi") {
        const others = factsOf((await this.store.listChecks(subject.tenantId, subject.id)).filter((c) => c.id !== check.id));
        comparedWith = referenceName(others, typeof check.inputMasked.name === "string" ? check.inputMasked.name : null);
      } else if (typeof check.inputMasked.name === "string") comparedWith = check.inputMasked.name;
      out.push({
        check: toCheckDto(check),
        subject: { id: subject.id, tenantId: subject.tenantId, subjectType: subject.subjectType, subjectId: subject.subjectId, status: subject.status, verifiedName: subject.verifiedName },
        comparedWith,
      });
    }
    return { items: out, total, limit: p.limit, offset: p.offset, facets };
  }

  approve(checkId: string, reviewerId: string, reason?: string | null, meta: ReviewMeta = {}) {
    return this.decide(checkId, reviewerId, "approved", reason ?? null, meta);
  }

  async reject(checkId: string, reviewerId: string, reason: string, meta: ReviewMeta = {}) {
    if (!reason?.trim()) throw badRequest("A reason is required to reject a check");
    return this.decide(checkId, reviewerId, "rejected", reason, meta);
  }

  private async decide(checkId: string, reviewerId: string, decision: "approved" | "rejected", reason: string | null, meta: ReviewMeta) {
    const check = await this.store.checkById(null, checkId);
    if (!check) throw notFound("Check");
    if (check.status !== "manual_review") throw conflict("Only checks waiting for review can be approved or rejected");
    const tenantId = check.tenantId;
    const subject = await this.store.subjectById(tenantId, check.subjectId);
    if (!subject) throw notFound("Subject");
    const updated = await this.store.updateCheck(tenantId, check.id, {
      status: decision === "approved" ? "verified" : "failed",
      error: decision === "approved" ? null : "rejected",
      reviewDecision: decision,
      reviewReason: reason?.trim().slice(0, 500) || null,
      reviewedBy: reviewerId,
      reviewedAt: this.now(),
    });
    const status = await this.recompute(tenantId, subject);
    this.log.info({ tenantId, checkId, decision, reviewerId }, "kyc review");
    // Type and outcome only: the reason may quote document details, so it stays on the check.
    await this.audit
      ?.record({
        tenantId,
        actorUserId: reviewerId,
        action: decision === "approved" ? "kyc.review.approve" : "kyc.review.reject",
        entityType: "kyc_check",
        entityId: check.id,
        summary: `${subject.subjectType} ${check.type} check ${decision}`,
        before: { status: "manual_review" },
        after: { status: updated.status, decision },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      })
      .catch(() => undefined);
    return { check: toCheckDto(updated), subject: status };
  }
}

const toStatus = (subjectType: SubjectType, subjectId: string, s: SubjectSummary, updatedAt: Date | null): KycStatus => ({
  subjectType,
  subjectId,
  status: s.status,
  verified: s.verified,
  verifiedName: s.verifiedName,
  badges: s.badges,
  missing: s.missing,
  updatedAt,
});
