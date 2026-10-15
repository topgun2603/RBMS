import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const WHATSAPP_MODULE = "whatsapp";

export const WHATSAPP_FEATURE_KEYS = {
  /** Two-way inbox, account settings, templates, webhooks. */
  base: "whatsapp",
  /** Template campaigns (broadcasts) to an audience. */
  campaigns: "whatsapp.campaigns",
} as const;

export const WHATSAPP_FEATURES: FeatureDef[] = [
  {
    key: WHATSAPP_FEATURE_KEYS.base,
    module: WHATSAPP_MODULE,
    label: "WhatsApp inbox",
    description: "Connect the shop's WhatsApp Business number: chat with customers, send approved templates, opt-outs.",
    shopToggle: true,
  },
  {
    key: WHATSAPP_FEATURE_KEYS.campaigns,
    module: WHATSAPP_MODULE,
    label: "WhatsApp campaigns",
    description: "Send an approved template to many customers at once (offers, dues reminders), throttled and scheduled.",
    dependsOn: [WHATSAPP_FEATURE_KEYS.base],
    shopToggle: true,
  },
];

export const WHATSAPP_PERMISSION_KEYS = { manage: "whatsapp.manage" } as const;

export const WHATSAPP_PERMISSIONS: PermissionDef[] = [
  {
    key: WHATSAPP_PERMISSION_KEYS.manage,
    module: WHATSAPP_MODULE,
    label: "Manage WhatsApp",
    description: "Reply to WhatsApp customers, assign and tag chats, sync templates and send campaigns.",
  },
];
