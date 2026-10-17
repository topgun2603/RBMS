/**
 * API shapes the workspace UI reads: `/v1/staff`, `/v1/audit`, `/v1/import` + `/v1/export` and `/v1/onboarding`
 * (packages/staff, audit, importexport, onboarding). Dates arrive as ISO strings.
 */

export interface Paged<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------- staff

/** Base level of a membership. Owners are managed through tenancy; the staff API assigns admin/staff/member. */
export type Level = "owner" | "admin" | "staff" | "member";
export const ASSIGNABLE_LEVELS = ["admin", "staff"] as const;
export type AssignableLevel = (typeof ASSIGNABLE_LEVELS)[number];

export interface StaffMember {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  level: Level | null;
  roles: string[];
  roleKeys: string[];
  active: boolean;
  lastActive: string | null;
  joinedAt: string;
}

export interface InviteInput {
  /** Phone (+91…) or email. */
  target: string;
  roleKeys: string[];
  level?: AssignableLevel;
}

export interface MemberPatch {
  roleKeys?: string[];
  level?: AssignableLevel;
  active?: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  /** Permission patterns: "invoices.create", "orders.*", "*.view". */
  permissions: string[];
  builtin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoleInput {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
}

export interface PermissionDef {
  key: string;
  module: string;
  label: string;
  description: string;
}

export interface PermissionGroup {
  module: string;
  permissions: PermissionDef[];
}

// ---------------------------------------------------------------- audit

export interface AuditEvent {
  id: string;
  /** Null only for platform events (super-admin listing); a shop's own log never contains them. */
  tenantId: string | null;
  actorUserId: string | null;
  /** "invoice.cancel" or the derived "invoices.post /:id/cancel". */
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Extra field of the `GET /audit` list: the count stops at 10,000 (`total` is then 10,000). */
export interface AuditListExtras {
  totalCapped?: boolean;
}

// ---------------------------------------------------------------- import / export

export interface ImporterColumn {
  key: string;
  label: string;
  required: boolean;
  example: string | null;
  help: string | null;
}

export interface Importer {
  key: string;
  label: string;
  feature: string | null;
  columns: ImporterColumn[];
}

export interface Exporter {
  key: string;
  label: string;
  feature: string | null;
}

/** Importer column key → index of the file column it reads (null = not imported). */
export type Mapping = Record<string, number | null>;

export interface DetectedColumn {
  index: number;
  header: string;
  mappedTo: string | null;
}

export interface PreviewRow {
  /** File row number (header = 1, first data row = 2). */
  row: number;
  data: Record<string, unknown>;
  errors: string[];
  raw: string[];
}

export interface PreviewResult {
  jobId: string;
  key: string;
  fileName: string | null;
  columns: DetectedColumn[];
  mapping: Mapping;
  /** Labels of required columns the file doesn't have. */
  missing: string[];
  rows: PreviewRow[];
  totals: { rows: number; valid: number; invalid: number };
}

export type ImportJobStatus = "preview" | "queued" | "running" | "done" | "failed";

export interface ImportJob {
  jobId: string;
  key: string;
  status: ImportJobStatus;
  fileName: string | null;
  total: number;
  valid: number;
  invalid: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: { row: number; message: string }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------- onboarding

export interface OnboardingStep {
  key: string;
  label: string;
  description: string;
  /** UI route hint relative to the app root, e.g. "settings/business". */
  href: string;
  done: boolean;
  skipped: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  /** Done or skipped. */
  completed: number;
  total: number;
  dismissed: boolean;
}
