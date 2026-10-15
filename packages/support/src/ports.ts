import type { FeatureGatePort } from "@srirealtime/core";
import type { SupportSettings } from "./sla";
import type { Ticket } from "./logic";

export type { FeatureGatePort };

/**
 * Guest identity. A guest proves their phone with an OTP elsewhere (e.g. auth's OTP flow or a storefront "verify phone"
 * step) and receives a short-lived token; support only asks this port whether the token is valid for the shop.
 * Send it as the `x-guest-token` header on `/public/tickets*`. Return the verified phone (any format; it is normalised
 * to +91 E.164) or null when the token is unknown, expired or for another shop. Without this port guests can't
 * raise tickets (signed-in users still can).
 */
export interface GuestVerifierPort {
  verify(tenantId: string, token: string): Promise<{ phone: string; name?: string | null } | null>;
}

export interface NotifierSendInput {
  tenantId: string;
  channel: "whatsapp" | "sms" | "email";
  /** E.164 phone or email address. */
  to: string;
  /** Notify template key, e.g. "support.reply". */
  template: string;
  vars: Record<string, string>;
  locale?: string;
}

/** Implemented by the notify module (same shape as orders' NotifierPort). */
export interface NotifierPort {
  send(input: NotifierSendInput): Promise<{ logId: string }>;
}

export interface StaffContact {
  userId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Staff members of the shop (tenancy/staff). */
export interface StaffDirectoryPort {
  /** Contact details of one member, null when not a member. */
  contact(tenantId: string, userId: string): Promise<StaffContact | null>;
  /** Members who handle support (e.g. holders of `support.manage`), told about new unassigned tickets. */
  team?(tenantId: string): Promise<StaffContact[]>;
}

/** Name/phone/email of a signed-in requester (auth user / store customer), used when the ticket body omits them. */
export interface RequesterProfilePort {
  profile(tenantId: string, userId: string): Promise<{ name?: string | null; phone?: string | null; email?: string | null } | null>;
}

/** Settings namespace `support` (apps/api). May return a partial object; defaults fill the rest. */
export interface SupportSettingsPort {
  get(tenantId: string): Promise<Partial<SupportSettings> | null | undefined>;
}

/** Links for messages: the requester's ticket page on the store, the staff ticket screen. Optional. */
export interface SupportLinksPort {
  requester?(tenantId: string, ticket: Ticket): Promise<string> | string;
  staff?(tenantId: string, ticket: Ticket): Promise<string> | string;
  /** Shop display name for `{{shop}}`. */
  shopName?(tenantId: string): Promise<string> | string;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/** Notify template keys this module sends. Variables: shop, number, subject, message, link, status, priority, customer. */
export const SUPPORT_TEMPLATES = {
  /** To the requester when their ticket is raised. */
  created: "support.created",
  /** To the requester when staff reply (never for notes). */
  reply: "support.reply",
  /** To the assignee (or the support team when unassigned) for a new ticket. */
  new: "support.new",
  /** To the new assignee. */
  assigned: "support.assigned",
  /** To the assignee when the requester replies. */
  customerReply: "support.customer_reply",
  /** To the assignee (or the team) when the first-response SLA is missed. */
  overdue: "support.overdue",
} as const;
export type SupportTemplate = (typeof SUPPORT_TEMPLATES)[keyof typeof SUPPORT_TEMPLATES];
