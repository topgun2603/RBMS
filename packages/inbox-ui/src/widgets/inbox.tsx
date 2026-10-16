"use client";

import * as React from "react";
import { LifeBuoyIcon, MessageCircleIcon, MessageSquareTextIcon, OctagonAlertIcon } from "lucide-react";
import { AttentionItem, useFeature, useI18n } from "@srirealtime/web";
import { FEATURES, PERMS, useMe } from "../lib/access";
import { useChatUnread, useTicketSummary, useWaUnread } from "../lib/queries";

/** Which inbox sources the signed-in member can see (feature + permission). */
export function useInboxSources() {
  const me = useMe();
  const chat = useFeature(FEATURES.chat);
  const wa = useFeature(FEATURES.whatsapp) && me.can(PERMS.whatsapp);
  const support = useFeature(FEATURES.support) && me.can(PERMS.support);
  return { chat, wa, support };
}

/** Needs-attention rows: unread chats and unread WhatsApp conversations (each only when that source is on). */
export function UnreadAttentionWidget() {
  const { t } = useI18n();
  const s = useInboxSources();
  const chat = useChatUnread(s.chat);
  const wa = useWaUnread(s.wa);
  return (
    <>
      {s.chat && (
        <AttentionItem label={t("inbox.widget.attnChat")} count={chat.data} tone="info" icon={MessageCircleIcon} to="chat" loading={chat.isPending} error={chat.isError} />
      )}
      {s.wa && (
        <AttentionItem
          label={t("inbox.widget.attnWhatsApp")}
          count={wa.data}
          tone="info"
          icon={MessageSquareTextIcon}
          to="whatsapp?filter=unread"
          loading={wa.isPending}
          error={wa.isError}
        />
      )}
    </>
  );
}

/** Needs-attention rows: tickets past their reply time (urgent) and tickets waiting for a reply. */
export function TicketsAttentionWidget() {
  const { t } = useI18n();
  const s = useTicketSummary();
  const d = s.data;
  const common = { loading: s.isPending, error: s.isError };
  return (
    <>
      <AttentionItem label={t("inbox.widget.attnOverdue")} count={d?.overdue} tone="danger" icon={OctagonAlertIcon} to="support?status=open&overdue=1" {...common} />
      <AttentionItem label={t("inbox.widget.attnTickets")} count={d?.counts.open} tone="warning" icon={LifeBuoyIcon} to="support?status=open" {...common} />
    </>
  );
}
