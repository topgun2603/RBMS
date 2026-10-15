import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const SUBJECT_TYPES = ["vendor", "shop", "user"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const SUBJECT_STATUSES = ["none", "pending", "verified", "failed", "manual_review"] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];

export const CHECK_TYPES = ["pan", "gstin", "bank_account", "upi", "digilocker_aadhaar", "selfie"] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

/** `failed` also covers a manual rejection (see `reviewDecision`). */
export const CHECK_STATUSES = ["pending", "verified", "failed", "manual_review"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const DOCUMENT_KINDS = [
  "pan_card",
  "gst_certificate",
  "cancelled_cheque",
  "bank_statement",
  "aadhaar_masked",
  "address_proof",
  "shop_photo",
  "selfie",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const emptyTextArray = sql`'{}'::text[]`;

/**
 * One verification subject per (tenant, type, id): a marketplace vendor, the shop itself (subject id = tenant id) or a
 * user. `status`, `verifiedName` and `badges` are derived from the checks by `aggregateSubject` — never set by hand.
 */
export const kycSubjects = pgTable(
  "kyc_subjects",
  {
    id: pk(),
    tenantId: tenantId(),
    subjectType: text("subject_type").$type<SubjectType>().notNull(),
    subjectId: uuid("subject_id").notNull(),
    status: text("status").$type<SubjectStatus>().notNull().default("none"),
    verifiedName: text("verified_name"),
    badges: text("badges").array().notNull().default(emptyTextArray),
    ...timestamps(),
  },
  (t) => [uniqueIndex("kyc_subjects_subject_uq").on(t.tenantId, t.subjectType, t.subjectId), index("kyc_subjects_status_idx").on(t.status)],
);

/**
 * One verification attempt. `inputMasked` and `result` never hold a full Aadhaar or bank account number (masked to the
 * last 4); `inputFingerprint` is a keyed HMAC of the normalised identifier so re-use can be detected without storing it.
 */
export const kycChecks = pgTable(
  "kyc_checks",
  {
    id: pk(),
    /** Denormalised from the subject so every query can filter by tenant. */
    tenantId: tenantId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => kycSubjects.id, { onDelete: "cascade" }),
    type: text("type").$type<CheckType>().notNull(),
    status: text("status").$type<CheckStatus>().notNull(),
    provider: text("provider").notNull(),
    /** Provider's request / client id (async flows like DigiLocker). */
    providerRef: text("provider_ref"),
    inputMasked: jsonb("input_masked").$type<Record<string, unknown>>().notNull().default({}),
    inputFingerprint: text("input_fingerprint"),
    /** Masked, whitelisted provider result (name, category, bank name, …). */
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    /** Name returned by the provider for this check (PAN holder, account holder, legal name …). */
    nameOnRecord: text("name_on_record"),
    nameMatchScore: integer("name_match_score"),
    /** Machine-readable error code, e.g. `invalid_pan`, `name_mismatch`, `provider_error`. */
    error: text("error"),
    createdBy: uuid("created_by"),
    reviewDecision: text("review_decision").$type<"approved" | "rejected">(),
    reviewReason: text("review_reason"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("kyc_checks_subject_idx").on(t.tenantId, t.subjectId, t.createdAt),
    index("kyc_checks_status_idx").on(t.status, t.createdAt),
    index("kyc_checks_fingerprint_idx").on(t.tenantId, t.inputFingerprint),
  ],
);

/** Supporting files (URLs from the uploads module). */
export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: pk(),
    tenantId: tenantId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => kycSubjects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<DocumentKind>().notNull(),
    fileUrl: text("file_url").notNull(),
    uploadedBy: uuid("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kyc_documents_subject_idx").on(t.tenantId, t.subjectId)],
);

export type KycSubjectRow = typeof kycSubjects.$inferSelect;
export type KycCheckRow = typeof kycChecks.$inferSelect;
export type KycDocumentRow = typeof kycDocuments.$inferSelect;
