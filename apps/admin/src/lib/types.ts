/** Response shapes of the srikit HTTP API (/v1). Dates arrive as ISO strings. */

export type ISODate = string;

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  locale: string;
  platformRoles: string[];
  status: "active" | "disabled" | "deleted";
  createdAt: ISODate;
  lastLoginAt?: ISODate | null;
}

export interface MeResponse {
  user: User;
  tenantRoles: string[];
}

export interface OtpRequestResponse {
  target: string;
  channel: "sms" | "whatsapp" | "email";
  expiresInSeconds: number;
  resendInSeconds: number;
}

export interface SignInResponse {
  token: string;
  expiresAt: ISODate;
  user: User;
  isNewUser: boolean;
}

export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: ISODate;
  lastSeenAt: ISODate;
  expiresAt: ISODate;
  current?: boolean;
}

export type TenantStatus = "active" | "suspended";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  appId: string | null;
  planId?: string | null;
  status: TenantStatus;
  createdAt?: ISODate;
}

export interface MyTenant {
  tenant: Tenant;
  roles: string[];
}

export interface Member {
  tenantId: string;
  userId: string;
  roles: string[];
  status: "active" | "inactive";
  createdAt?: ISODate;
  /** Present when the API joins user details. */
  user?: Partial<User> | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface BrandTokens {
  colors: { primary: string; secondary?: string; accent?: string; background?: string; foreground?: string };
  radius: number;
  fontSans: string;
  fontHeading?: string;
  mode: "light" | "dark" | "system";
}

export interface Branding {
  appName: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  tokens: BrandTokens;
  css: string;
}

export interface BrandingPreview {
  css: string;
  warnings: string[];
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  modules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
  isPublic: boolean;
  sort?: number;
}

export interface UsageItem {
  key: string;
  used: number;
  /** -1 = unlimited */
  limit: number;
  period?: string;
  remaining?: number | null;
}

/** Normalised /plans/current (see normalizeCurrentPlan). */
export interface CurrentPlan {
  planId: string | null;
  plan: Plan | null;
  modules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
  usage: UsageItem[];
}

export interface SettingsNamespace {
  namespace: string;
  userOverridable?: string[];
  publicKeys?: string[];
}

export interface SettingsValues {
  namespace: string;
  values: Record<string, unknown>;
}

export type Channel = "sms" | "email" | "whatsapp" | "push";

export interface NotifyTemplate {
  id: string;
  tenantId: string | null;
  key: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  body: string;
  createdAt?: ISODate;
  updatedAt?: ISODate;
}

export interface NotifyLogEntry {
  id: string;
  channel: Channel;
  to: string;
  templateKey: string | null;
  status: "queued" | "sent" | "failed";
  error: string | null;
  createdAt: ISODate;
  sentAt: ISODate | null;
}

export interface NotifyPreview {
  subject?: string;
  body: string;
  html?: string;
  source?: string;
}

export interface UploadedFile {
  id: string;
  originalName?: string;
  key?: string;
  url: string;
  thumbUrl: string | null;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  visibility?: "public" | "private";
  purpose?: string | null;
  status?: "pending" | "ready" | "deleted";
  createdAt?: ISODate;
}

export interface UploadSignResponse {
  fileId: string;
  key: string;
  upload: { url: string; method: string; headers: Record<string, string>; expiresIn?: number };
}

export interface ConsentDecision {
  granted: boolean;
  version: string;
  source: string;
  at: ISODate;
}

export type DataRequestStatus = "pending" | "processing" | "completed" | "cancelled" | "failed";

export interface DataRequest {
  id: string;
  userId: string;
  tenantId: string | null;
  type: "export" | "delete";
  status: DataRequestStatus;
  scheduledFor: ISODate;
  completedAt: ISODate | null;
  error: string | null;
  createdAt: ISODate;
}

export interface ConsentMe {
  consents: Record<string, ConsentDecision>;
  requests: DataRequest[];
}

export interface I18nOverride {
  id?: string;
  locale: string;
  key: string;
  value: string;
  appId: string | null;
}

/** A feature a module declares (GET /features/registry). See docs/features.md. */
export interface FeatureDef {
  /** "<moduleId>" for a module's base feature, "<moduleId>.<name>" for optional parts. */
  key: string;
  module: string;
  label: string;
  description: string;
  dependsOn?: string[];
  shopToggle?: boolean;
  defaultOn?: boolean;
}

/** Why a feature is off, first failing level in the order app → plan → dependency → shop. */
export type FeatureReason = "app" | "plan" | "shop" | "dependency";

export interface FeatureState {
  key: string;
  module: string;
  label: string;
  description: string;
  dependsOn: string[];
  shopToggle: boolean;
  enabled: boolean;
  reason: FeatureReason | null;
  /** App + plan + dependencies allow it (the owner's switch aside). */
  available: boolean;
  /** The owner's switch; null = never touched (uses defaultOn). */
  shopEnabled: boolean | null;
}

/** GET /features (current workspace) and GET /features/tenants/:id. */
export interface FeaturesResponse {
  appId: string | null;
  planId: string | null;
  features: FeatureState[];
  enabled: string[];
}

/** An app profile: which features a product (appId) offers. */
export interface AppProfile {
  appId: string;
  name: string;
  features: string[];
  tenantCount: number;
}

export interface Paged<T> {
  items: T[];
  total?: number;
}
