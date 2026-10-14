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
