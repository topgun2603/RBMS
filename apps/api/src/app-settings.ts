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
