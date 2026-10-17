"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveStream } from "./live";
import { applyWaConversation, applyWaStatus, qk, upsertWaMessage } from "./queries";
import type { LiveStatus } from "./sse";
import type { Campaign, WaMessage, WaStreamEvent } from "./types";

/**
 * Live WhatsApp updates (`/v1/whatsapp/stream`, events `wa.message|status|conversation|campaign`) applied to the query
 * cache. There's no replay, so every reconnect reloads the WhatsApp queries. When the API has no stream route the
 * status is "polling" and callers set `refetchInterval` (POLL_MS) instead.
 */
export function useWhatsAppLive(opts: { enabled?: boolean; onInbound?: (m: WaMessage) => void } = {}): LiveStatus {
  const qc = useQueryClient();
  const timer = React.useRef<number | null>(null);
  const onInbound = React.useRef(opts.onInbound);
  onInbound.current = opts.onInbound;

  const refreshLists = React.useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void qc.invalidateQueries({ queryKey: qk.waLists });
      void qc.invalidateQueries({ queryKey: qk.waUnread });
    }, 800);
  }, [qc]);

  return useLiveStream(
    "whatsapp",
    {
      onEvent: (e) => {
        const d = e.data as WaStreamEvent;
        if (!d || typeof d !== "object") return;
        switch (d.type) {
          case "message":
            upsertWaMessage(qc, d.message);
            refreshLists();
            if (d.message.direction === "in") onInbound.current?.(d.message);
            break;
          case "status":
            applyWaStatus(qc, d.contactId, d.messageId, d.status, d.error);
            break;
          case "conversation":
            applyWaConversation(qc, d.conversation);
            refreshLists();
            break;
          case "campaign":
            qc.setQueryData<Campaign>(qk.campaign(d.campaignId), (c) => (c ? { ...c, status: d.status, counts: d.counts } : c));
            void qc.invalidateQueries({ queryKey: qk.campaignTable });
            void qc.invalidateQueries({ queryKey: [...qk.campaigns, "recipients", d.campaignId] });
            break;
        }
      },
      onReady: ({ reconnected }) => {
        if (reconnected) void qc.invalidateQueries({ queryKey: qk.wa });
      },
    },
    opts.enabled ?? true,
  );
}
