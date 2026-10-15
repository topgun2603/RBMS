"use client";

import type { ChatOrderContext } from "../types";

/** Window event any page uses to open the chat widget, optionally about an order. */
export const CHAT_OPEN_EVENT = "sr:chat-open";

export interface ChatOpenDetail {
  order?: ChatOrderContext;
}

/** Opens the floating chat (no-op when the chat feature is off: nothing listens). */
export function openChat(detail: ChatOpenDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatOpenDetail>(CHAT_OPEN_EVENT, { detail }));
}
