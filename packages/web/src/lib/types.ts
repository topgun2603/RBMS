/** API shapes the kit itself needs (auth, tenancy, branding, features). Module packages keep their own types. */

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
}

export interface MeResponse {
  user: User;
  tenantRoles: string[];
  /** Permission patterns in this shop (`*` for owners/admins; a staff role's keys otherwise). Absent on older APIs. */
  permissions?: string[];
}

export interface OtpRequestResponse {
  /** Masked for display ("+91******3210"). Never send it back to /otp/verify. */
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

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  appId: string | null;
  status: "active" | "suspended";
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
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  tokens?: BrandTokens;
  css: string;
}

/** Why a feature is off: first failing level, in the order app → plan → dependency → shop (docs/features.md). */
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
  /** app + plan + dependencies allow it (the shop switch aside). */
  available: boolean;
  /** The owner's switch (null = never touched, uses the default). */
  shopEnabled: boolean | null;
}

export interface FeaturesResponse {
  appId: string | null;
  planId: string | null;
  features: FeatureState[];
  enabled: string[];
}
