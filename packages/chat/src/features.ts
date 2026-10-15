import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const CHAT_MODULE = "chat";

export const CHAT_FEATURE_KEYS = { base: "chat" } as const;

export const CHAT_FEATURES: FeatureDef[] = [
  {
    key: CHAT_FEATURE_KEYS.base,
    module: CHAT_MODULE,
    label: "Chat",
    description: "Real-time messages between shoppers and the shop, about orders, and between staff.",
    shopToggle: true,
  },
];

export const CHAT_PERMISSION_KEYS = { manage: "chat.manage" } as const;

export const CHAT_PERMISSIONS: PermissionDef[] = [
  {
    key: CHAT_PERMISSION_KEYS.manage,
    module: CHAT_MODULE,
    label: "Answer customer chats",
    description: "See and reply to every shopper support and order conversation of the shop, and remove messages in them.",
  },
];
