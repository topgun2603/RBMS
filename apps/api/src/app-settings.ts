import { LOYALTY_SETTINGS_DEFAULTS, LOYALTY_SETTINGS_SCHEMA } from "@srirealtime/loyalty";
import { MEMBERSHIPS_SETTINGS_DEFAULTS, MEMBERSHIPS_SETTINGS_SCHEMA } from "@srirealtime/memberships";
import { MARKETPLACE_SETTINGS_DEFAULTS, MARKETPLACE_SETTINGS_PUBLIC_KEYS, MARKETPLACE_SETTINGS_SCHEMA } from "@srirealtime/marketplace";
import { REVIEW_SETTINGS_DEFAULTS, REVIEW_SETTINGS_SCHEMA } from "@srirealtime/reviews";
import { SUPPORT_SETTINGS_DEFAULTS, SUPPORT_SETTINGS_SCHEMA } from "@srirealtime/support";
import { WHATSAPP_SETTINGS_DEFAULTS, WHATSAPP_SETTINGS_SCHEMA } from "@srirealtime/whatsapp";
import type { SettingsService } from "@srirealtime/settings";
import { z } from "zod";

/** Settings namespaces every app shares. Feature modules define their own namespaces next to their code. */
export function defineAppSettings(settings: SettingsService) {
  settings.define(
    "general",
    z.object({
      businessName: z.string().max(120),
      supportPhone: z.string().max(20),
      supportEmail: z.string().email().or(z.literal("")),
      defaultLocale: z.enum(["en", "ta"]),
      timezone: z.string(),
      currency: z.literal("INR"),
      gstin: z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN"),
    }),
    {
      businessName: "",
      supportPhone: "",
      supportEmail: "",
      defaultLocale: "en",
      timezone: "Asia/Kolkata",
      currency: "INR",
      gstin: "",
    },
    { publicKeys: ["businessName", "supportPhone", "supportEmail", "defaultLocale"] },
  );

  // Seller profile printed on GST invoices (read by the invoices module through its SellerProfilePort).
  settings.define(
    "billing",
    z.object({
      legalName: z.string().max(120),
      gstin: z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN"),
      address: z.string().max(300),
      city: z.string().max(80),
      pincode: z.string().regex(/^$|^[1-9][0-9]{5}$/, "Invalid PIN code"),
      stateCode: z.string().regex(/^$|^[0-9]{2}$/, "Invalid state code"),
      phone: z.string().max(20),
      email: z.string().email().or(z.literal("")),
      invoicePrefix: z.string().regex(/^[A-Z0-9-]{1,6}$/, "1–6 capital letters, digits or hyphens"),
      terms: z.string().max(1000),
      bankName: z.string().max(80),
      accountNumber: z.string().regex(/^$|^[0-9]{6,20}$/, "Invalid account number"),
      ifsc: z.string().regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC"),
      upiId: z.string().regex(/^$|^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/, "Invalid UPI ID"),
      /** WhatsApp reminders for overdue bills, sent N days after the due date. */
      autoReminders: z.boolean(),
      reminderDays: z.array(z.number().int().min(0).max(365)).max(6),
      /** WhatsApp thank-you when a bill is paid online. */
      sendPaymentReceipts: z.boolean(),
    }),
    {
      legalName: "",
      gstin: "",
      address: "",
      city: "",
      pincode: "",
      stateCode: "33",
      phone: "",
      email: "",
      invoicePrefix: "INV",
      terms: "Goods once sold will not be taken back.",
      bankName: "",
      accountNumber: "",
      ifsc: "",
      upiId: "",
      autoReminders: false,
      reminderDays: [1, 7, 15],
      sendPaymentReceipts: true,
    },
  );

  // Order handling (read by the orders module through its OrderSettingsPort).
  settings.define(
    "orders",
    z.object({
      prefix: z.string().regex(/^[A-Z0-9-]{1,6}$/, "1–6 capital letters, digits or hyphens"),
      /** When the GST invoice for an order is issued. */
      invoiceOn: z.enum(["confirmed", "delivered"]),
      allowBackorder: z.boolean(),
      /** Confirm new orders automatically (online orders once paid). */
      autoConfirm: z.boolean(),
      notifyOwner: z.boolean(),
    }),
    { prefix: "ORD", invoiceOn: "delivered", allowBackorder: false, autoConfirm: false, notifyOwner: true },
  );

  // Online store (read by the storefront through its StoreSettingsPort; docs/commerce-batch2.md §1).
  const url = z.string().trim().max(300).url().or(z.literal(""));
  settings.define(
    "store",
    z.object({
      open: z.boolean(),
      closedMessage: z.string().max(300),
      codEnabled: z.boolean(),
      /** Paise; 0 = no limit. */
      codMaxAmount: z.number().int().min(0).max(100_000_000),
      /** Paise, on goods after discount; 0 = none. */
      minOrderValue: z.number().int().min(0).max(100_000_000),
      contactPhone: z.string().max(20),
      contactEmail: z.string().email().or(z.literal("")),
      social: z.object({ instagram: url.optional(), facebook: url.optional(), youtube: url.optional(), whatsapp: z.string().max(20).optional() }),
      /** Markdown, shown on the store's policy pages. */
      policies: z.object({
        shipping: z.string().max(20_000).optional(),
        returns: z.string().max(20_000).optional(),
        privacy: z.string().max(20_000).optional(),
        terms: z.string().max(20_000).optional(),
      }),
      /** The shop's trade (@srirealtime/verticals pack id): storefront wording, size guide, starter content. "" = the app's default. */
      businessType: z.string().max(40),
    }),
    {
      open: true,
      closedMessage: "",
      codEnabled: true,
      codMaxAmount: 500_000,
      minOrderValue: 0,
      contactPhone: "",
      contactEmail: "",
      social: { instagram: "", facebook: "", youtube: "", whatsapp: "" },
      policies: { shipping: "", returns: "", privacy: "", terms: "" },
      businessType: "",
    },
    { publicKeys: ["open", "closedMessage", "codEnabled", "codMaxAmount", "minOrderValue", "contactPhone", "contactEmail", "social", "policies", "businessType"] },
  );

  // Product review moderation (read by the reviews module).
  settings.define("reviews", REVIEW_SETTINGS_SCHEMA, REVIEW_SETTINGS_DEFAULTS);

  // Batch 3 (docs/batch3.md): sellers and payouts, help desk SLAs, loyalty points rules, WhatsApp inbox/campaigns.
  // Sellers read the payout minimum, return window and auto-approve flag (their dashboard and product editor).
  settings.define("marketplace", MARKETPLACE_SETTINGS_SCHEMA, MARKETPLACE_SETTINGS_DEFAULTS, { publicKeys: MARKETPLACE_SETTINGS_PUBLIC_KEYS });
  settings.define("support", SUPPORT_SETTINGS_SCHEMA, SUPPORT_SETTINGS_DEFAULTS);
  settings.define("loyalty", LOYALTY_SETTINGS_SCHEMA, LOYALTY_SETTINGS_DEFAULTS);
  settings.define("memberships", MEMBERSHIPS_SETTINGS_SCHEMA, MEMBERSHIPS_SETTINGS_DEFAULTS);
  settings.define("whatsapp", WHATSAPP_SETTINGS_SCHEMA, WHATSAPP_SETTINGS_DEFAULTS);

  settings.define(
    "notifications",
    z.object({
      smsEnabled: z.boolean(),
      whatsappEnabled: z.boolean(),
      emailEnabled: z.boolean(),
      pushEnabled: z.boolean(),
      quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
      quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    {
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: true,
      pushEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    },
    { userOverridable: ["smsEnabled", "whatsappEnabled", "emailEnabled", "pushEnabled"] },
  );
}
