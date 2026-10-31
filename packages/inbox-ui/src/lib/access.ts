"use client";

import * as React from "react";
import { useOptionalSession } from "@rbms/web";

/** Feature keys the inbox uses (declared by @rbms/chat, whatsapp and support; docs/features.md). */
export const FEATURES = {
  chat: "chat",
  whatsapp: "whatsapp",
  campaigns: "whatsapp.campaigns",
  support: "support",
  faq: "support.faq",
  /** Other modules' features used for links and context cards. */
  orders: "orders",
  invoices: "invoices",
} as const;

/** Permission keys (the API's route config). */
export const PERMS = {
  chatManage: "chat.manage",
  whatsapp: "whatsapp.manage",
  support: "support.manage",
  /** GET /v1/staff/members, used for assignee pickers and names. */
  staff: "staff.manage",
} as const;

/** The signed-in member: id, `can()`, owner/admin. */
export function useMe() {
  const session = useOptionalSession();
  return React.useMemo(
    () => ({
      userId: session?.me.user.id ?? null,
      name: session?.me.user.name ?? null,
      isManager: !!session?.canManage,
      can: (req: string | readonly string[]) => (session ? session.can(req) : false),
    }),
    [session],
  );
}
