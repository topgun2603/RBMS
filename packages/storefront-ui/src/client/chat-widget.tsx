"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { MessageCircleIcon, XIcon } from "lucide-react";
import { toast } from "@rbms/ui/components/sonner";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { featureOn, STORE_FEATURES } from "../lib/features";
import type { ChatOrderContext } from "../types";
import { CHAT_OPEN_EVENT, type ChatOpenDetail } from "./chat-bus";
import { useChatSession } from "./chat-session";
import { useStore } from "./store-context";

const ChatPanel = React.lazy(() => import("./chat-panel").then((m) => ({ default: m.ChatPanel })));

/**
 * Floating chat launcher (bottom-right stack, above WhatsApp / back-to-top). Shown only when the shop has `chat` on.
 * Holds the live session (so the unread badge updates while the panel is closed); the panel's code loads on first open.
 * Any page opens it with `openChat({ order })` (chat-bus).
 */
export function ChatLauncher({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const { t, shell, auth } = useStore();
  const on = featureOn(shell.features, STORE_FEATURES.chat);
  const reduced = useReducedMotionSafe();
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [order, setOrder] = React.useState<ChatOrderContext | null>(null);
  const [bump, setBump] = React.useState(0);
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  const session = useChatSession({
    enabled: on && auth.ready && !!auth.token,
    open,
    userId: auth.user?.id ?? null,
    onIncoming: (m) => {
      setBump((b) => b + 1);
      if (!openRef.current) {
        toast(t("chat.newMessage", { shop: shell.name }), {
          description: m.body.length > 90 ? `${m.body.slice(0, 89)}…` : m.body || t("chat.attachment"),
          action: { label: t("chat.open"), onClick: () => setOpen(true) },
        });
      }
    },
  });

  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  React.useEffect(() => {
    if (!on) return;
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ChatOpenDetail>).detail ?? {};
      setOrder(d.order ?? null);
      setLoaded(true);
      setOpen(true);
      const s = sessionRef.current;
      if (d.order?.id || !s.active) void s.focus(d.order ?? null);
    };
    window.addEventListener(CHAT_OPEN_EVENT, handler);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, handler);
  }, [on]);

  // Once conversations arrive, open the latest one (unless the shopper is choosing from the list).
  const { listLoaded, active, focus } = session;
  React.useEffect(() => {
    if (open && listLoaded && !active) void focus(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listLoaded]);

  if (!on) return null;
  const unread = session.unreadTotal;
  return (
    <>
      <motion.button
        type="button"
        onClick={() => {
          setLoaded(true);
          setOpen((o) => !o);
        }}
        aria-label={unread ? `${t("chat.open")} (${t("chat.unread", { count: unread })})` : open ? t("chat.close") : t("chat.open")}
        aria-expanded={open}
        aria-haspopup="dialog"
        initial={reduced ? false : { scale: 0, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 20, delay: 0.6 }}
        whileHover={reduced ? undefined : { scale: 1.07 }}
        whileTap={{ scale: 0.92 }}
        className="pointer-events-auto relative flex size-12 items-center justify-center rounded-full bg-[image:var(--sf-gradient)] text-primary-foreground shadow-lg shadow-primary/30 focus-ring sm:size-14"
        data-testid="chat-launcher"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={open ? "x" : "chat"} initial={{ rotate: -60, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 60, opacity: 0, scale: 0.6 }} transition={{ duration: 0.18 }}>
            {open ? <XIcon className="size-6" /> : <MessageCircleIcon className="size-6 sm:size-7" />}
          </motion.span>
        </AnimatePresence>
        <AnimatePresence>
          {unread > 0 && !open && (
            <motion.span
              key={`badge-${bump}`}
              initial={{ scale: 0 }}
              animate={{ scale: [1.35, 1] }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 16 }}
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white ring-2 ring-background tabular-nums"
              data-testid="chat-unread"
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      {loaded &&
        typeof document !== "undefined" &&
        createPortal(
          <React.Suspense fallback={null}>
            <ChatPanel open={open} onClose={() => setOpen(false)} session={session} order={order} onClearOrder={() => setOrder(null)} />
          </React.Suspense>,
          document.body,
        )}
    </>
  );
}
