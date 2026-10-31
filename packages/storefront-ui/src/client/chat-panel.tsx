"use client";

import * as React from "react";
import { AlertCircleIcon, ArrowLeftIcon, CheckCheckIcon, CheckIcon, ClockIcon, Loader2Icon, PackageIcon, RefreshCwIcon, SendHorizontalIcon, SparklesIcon, WifiOffIcon, XIcon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { Textarea } from "@rbms/ui/components/textarea";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { dayKey, isSeen, orderNumberOf, senderName } from "../lib/chat";
import { formatDate, imageUrl, money } from "../lib/format";
import type { ChatConversation, ChatMessage, ChatOrderContext } from "../types";
import { StatusChip, StoreImage } from "../components/bits";
import type { ChatSession } from "./chat-session";
import { AiChatPane, useAiChatAvailable } from "./chat-ai";
import { OtpSignIn } from "./sign-in";
import { useStore } from "./store-context";

const STARTERS = ["chat.starter.delivery", "chat.starter.size", "chat.starter.return"] as const;

/**
 * The chat panel: full screen on phones, a floating card above the launcher from `sm` up. Signed-out shoppers sign in
 * with the OTP form here; signed-in shoppers see their conversation with the shop (live over SSE), with day separators,
 * read ticks, typing dots, an order card when opened about an order, and reconnect / offline banners.
 */
export function ChatPanel({ open, onClose, session, order, onClearOrder }: { open: boolean; onClose(): void; session: ChatSession; order: ChatOrderContext | null; onClearOrder(): void }) {
  const { t, shell, auth } = useStore();
  const reduced = useReducedMotionSafe();
  const [showList, setShowList] = React.useState(false);
  // AI mode (AI Phase 4 part B): offered when the shop switched it on and is under its daily cap; otherwise this is the plain human chat.
  const aiAvail = useAiChatAvailable(open, true);
  const [mode, setMode] = React.useState<"ai" | "human">("ai");
  const [aiDown, setAiDown] = React.useState(false);
  const aiOn = aiAvail === true && !aiDown;
  const showAi = aiOn && mode === "ai";

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const signedIn = auth.ready && !!auth.token;
  const multi = session.conversations.length > 1;
  const listMode = signedIn && multi && (showList || (!session.active && session.listLoaded && !order));
  const orderCard = order ?? (session.active?.type === "order" ? { number: orderNumberOf(session.active.title), id: session.active.subjectId ?? undefined } : null);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="chat-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="chat-title"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          style={{ transformOrigin: "bottom right" }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:inset-auto sm:right-6 sm:bottom-24 sm:h-[min(620px,calc(100dvh-8rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:pt-0 sm:pb-0 sm:shadow-[var(--elevation-3,0_24px_60px_-12px_rgb(0_0_0/0.35))]"
          data-testid="chat-panel"
        >
          {/* header */}
          <div className="relative flex items-center gap-3 bg-[image:var(--sf-gradient)] px-4 py-3 text-primary-foreground">
            {listMode || !multi || !signedIn ? null : (
              <Button variant="ghost" size="icon-sm" className="-ms-1 rounded-full text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" onClick={() => setShowList(true)} aria-label={t("account.back")}>
                <ArrowLeftIcon />
              </Button>
            )}
            <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20 font-display text-lg font-semibold ring-2 ring-white/30">
              {shell.logoUrl ? <img src={imageUrl(shell.logoUrl) ?? ""} alt="" className="size-full object-cover" /> : shell.name.charAt(0).toUpperCase()}
              <StatusDot status={session.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p id="chat-title" className="truncate font-display text-base font-semibold">
                {t("chat.title", { shop: shell.name })}
              </p>
              <p className="truncate text-xs text-primary-foreground/80">{showAi ? t("aichat.subtitle") : session.active?.type === "order" && session.active.title ? t("chat.aboutOrder", { number: orderNumberOf(session.active.title) }) : t("chat.subtitle")}</p>
            </div>
            <Button variant="ghost" size="icon-sm" className="rounded-full text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" onClick={onClose} aria-label={t("chat.close")} data-testid="chat-close">
              <XIcon />
            </Button>
          </div>
          <ConnectionBanner status={signedIn && !showAi ? session.status : "idle"} />
          {aiOn && (
            <div role="tablist" aria-label={t("aichat.tabs")} className="flex gap-1 border-b bg-muted/30 p-1.5" data-testid="chat-modes">
              {(["ai", "human"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-ring", mode === m ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:bg-accent")}
                  data-testid={`chat-mode-${m}`}
                >
                  {m === "ai" && <SparklesIcon className="size-3.5" aria-hidden />}
                  {t(m === "ai" ? "aichat.tab.ai" : "aichat.tab.shop")}
                </button>
              ))}
            </div>
          )}

          {showAi ? (
            <AiChatPane onHandoff={() => setMode("human")} onUnavailable={() => setAiDown(true)} />
          ) : !auth.ready ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : !signedIn ? (
            <div className="flex-1 overflow-y-auto px-5 py-6">
              <div className="mb-5 text-center">
                <p className="font-display text-xl font-semibold">{t("chat.signInTitle")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("chat.signInBody")}</p>
              </div>
              <OtpSignIn compact />
            </div>
          ) : listMode ? (
            <ConversationList
              items={session.conversations}
              onPick={(id) => {
                session.setActive(id);
                setShowList(false);
                onClearOrder();
              }}
            />
          ) : (
            <Thread session={session} order={orderCard} onDismissOrder={order ? onClearOrder : undefined} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatusDot({ status }: { status: ChatSession["status"] }) {
  const tone = status === "live" ? "bg-success" : status === "connecting" || status === "reconnecting" ? "bg-warning" : status === "offline" ? "bg-destructive" : "bg-white/50";
  return <span aria-hidden className={cn("absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-[color-mix(in_srgb,var(--primary)_80%,black)]", tone, status === "live" && "motion-safe:animate-pulse")} />;
}

function ConnectionBanner({ status }: { status: ChatSession["status"] }) {
  const { t } = useStore();
  const show = status === "reconnecting" || status === "offline";
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div key={status} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden" role="status">
          <p className={cn("flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium", status === "offline" ? "bg-destructive/10 text-danger-ink" : "bg-warning/15 text-warning-ink")}>
            {status === "offline" ? <WifiOffIcon className="size-3.5" /> : <RefreshCwIcon className="size-3.5 animate-spin" />}
            {status === "offline" ? t("chat.offline") : t("chat.reconnecting")}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ConversationList({ items, onPick }: { items: ChatConversation[]; onPick(id: string): void }) {
  const { t, locale, shell } = useStore();
  return (
    <ul className="flex-1 divide-y overflow-y-auto">
      {items.map((c, i) => (
        <motion.li key={c.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}>
          <button type="button" onClick={() => onPick(c.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-start hover:bg-accent focus-ring">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{c.type === "order" ? <PackageIcon className="size-5" /> : <ChatGlyph />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{c.type === "order" && c.title ? t("chat.aboutOrder", { number: orderNumberOf(c.title) }) : t("chat.title", { shop: shell.name })}</span>
              <span className="block truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? ""}</span>
            </span>
            <span className="flex flex-col items-end gap-1">
              {c.lastMessageAt && <span className="text-[11px] text-muted-foreground">{formatDate(c.lastMessageAt, locale, { day: "numeric", month: "short" })}</span>}
              {c.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{c.unread}</span>}
            </span>
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function OrderCard({ order, onDismiss }: { order: ChatOrderContext; onDismiss?: () => void }) {
  const { t } = useStore();
  if (!order.number) return null;
  return (
    <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border bg-card p-2.5 shadow-xs" data-testid="chat-order-card">
      <span className="size-11 shrink-0 overflow-hidden rounded-xl bg-muted">{order.image ? <StoreImage src={order.image} alt={order.number} /> : <span className="flex size-full items-center justify-center bg-primary/10 text-primary"><PackageIcon className="size-5" /></span>}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{t("chat.orderCard", { number: order.number })}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {order.status && <StatusChip status={order.status} label={t(`order.status.${order.status}`)} className="px-2 py-0 text-[11px]" />}
          {order.total !== undefined && <span className="tabular-nums">{money(order.total)}</span>}
          {order.itemCount !== undefined && <span>{t("cart.items", { count: order.itemCount })}</span>}
        </span>
      </span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent" aria-label={t("common.cancel")}>
          <XIcon className="size-4" />
        </button>
      )}
    </motion.div>
  );
}

function Thread({ session, order, onDismissOrder }: { session: ChatSession; order: ChatOrderContext | null; onDismissOrder?: () => void }) {
  const { t, locale } = useStore();
  const reduced = useReducedMotionSafe();
  const scroller = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const atBottom = React.useRef(true);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [olderBusy, setOlderBusy] = React.useState(false);
  const prefilled = React.useRef<string | null>(null);
  const me = session.me ?? "";
  const participants = session.active?.participants ?? [];

  // "About order …" prefill for a support chat opened from an order page (no order id → no order conversation).
  React.useEffect(() => {
    if (order && !order.id && order.number && prefilled.current !== order.number && !draft) {
      prefilled.current = order.number;
      setDraft(t("chat.orderPrefill", { number: order.number }));
    }
  }, [order, draft, t]);

  React.useEffect(() => {
    const id = setTimeout(() => input.current?.focus({ preventScroll: true }), 250);
    return () => clearTimeout(id);
  }, [session.active?.id]);

  // Stick to the bottom while the shopper is there; mark as read when the thread is visible.
  const last = session.messages[session.messages.length - 1];
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, session.typing.length, session.messagesLoading]);
  React.useEffect(() => {
    if (session.active && session.active.unread > 0) session.markRead();
  }, [session.active, session.active?.unread, last?.id, session]);

  const submit = async (text = draft) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    atBottom.current = true;
    try {
      await session.send(body, order);
    } catch {
      /* the message stays with a retry button */
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  const older = async () => {
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    setOlderBusy(true);
    try {
      await session.loadOlder();
    } finally {
      setOlderBusy(false);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    }
  };

  const typingName = session.typing[0] ? senderName(participants, session.typing[0], t("chat.shop")) : null;
  let prevDay = "";
  let prevSender = "";

  return (
    <>
      {order && <OrderCard order={order} onDismiss={onDismissOrder} />}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        aria-live="polite"
        data-testid="chat-thread"
      >
        {session.hasOlder && (
          <div className="mb-3 flex justify-center">
            <Button variant="outline" size="sm" className="rounded-full" onClick={older} disabled={olderBusy}>
              {olderBusy && <Loader2Icon className="animate-spin" />}
              {t("chat.loadOlder")}
            </Button>
          </div>
        )}
        {session.messagesLoading && !session.messages.length ? (
          <ThreadSkeleton />
        ) : session.messagesError && !session.messages.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <AlertCircleIcon className="size-8 text-danger-ink" />
            <p className="text-sm text-muted-foreground">{t("chat.error")}</p>
            <Button variant="outline" size="sm" className="rounded-full" onClick={session.reload}>
              {t("chat.retry")}
            </Button>
          </div>
        ) : !session.messages.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
            <motion.span initial={reduced ? false : { scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ChatGlyph />
            </motion.span>
            <p className="max-w-xs text-sm text-muted-foreground">{t("chat.empty")}</p>
            <div className="flex flex-wrap justify-center gap-2" aria-label={t("chat.starters")}>
              {STARTERS.map((k, i) => (
                <motion.button
                  key={k}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.1 + i * 0.06 } }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void submit(t(k))}
                  className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary focus-ring"
                >
                  {t(k)}
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="grid gap-1">
            <AnimatePresence initial={false}>
              {session.messages.map((m) => {
                const day = dayKey(m.createdAt);
                const showDay = day !== prevDay;
                const first = showDay || m.senderId !== prevSender;
                prevDay = day;
                prevSender = m.senderId;
                return (
                  <React.Fragment key={m.id}>
                    {showDay && (
                      <li className="my-2 flex justify-center" aria-hidden>
                        <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {day === "today" ? t("chat.today") : day === "yesterday" ? t("chat.yesterday") : formatDate(m.createdAt, locale, { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </li>
                    )}
                    <Bubble m={m} mine={m.senderId === me || m.senderId === "me"} first={first} name={senderName(participants, m.senderId, t("chat.shop"))} seen={!!me && isSeen(m, participants, me)} onRetry={() => void session.retry(m.id)} />
                  </React.Fragment>
                );
              })}
            </AnimatePresence>
            <AnimatePresence>
              {typingName && (
                <motion.li key="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 flex items-center gap-2" aria-label={t("chat.typing", { name: typingName })}>
                  <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3 py-2.5">
                    {[0, 1, 2].map((i) => (
                      <motion.span key={i} className="size-1.5 rounded-full bg-muted-foreground" animate={reduced ? undefined : { y: [0, -3, 0] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }} />
                    ))}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{t("chat.typing", { name: typingName })}</span>
                </motion.li>
              )}
            </AnimatePresence>
          </ol>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t bg-background p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Textarea
          ref={input}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) session.notifyTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
          className="max-h-32 min-h-11 resize-none rounded-2xl bg-muted/40 py-2.5"
          data-testid="chat-input"
        />
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button type="submit" size="icon-lg" className="rounded-full" disabled={!draft.trim() || sending} aria-label={t("chat.send")} data-testid="chat-send">
            {sending ? <Loader2Icon className="animate-spin" /> : <SendHorizontalIcon />}
          </Button>
        </motion.div>
      </form>
    </>
  );
}

const Bubble = React.forwardRef<HTMLLIElement, { m: ChatMessage; mine: boolean; first: boolean; name: string; seen: boolean; onRetry(): void }>(function Bubble({ m, mine, first, name, seen, onRetry }, ref) {
  const { t, locale } = useStore();
  const reduced = useReducedMotionSafe();
  const time = formatDate(m.createdAt, locale, { hour: "numeric", minute: "2-digit" });
  const images = m.attachments.filter((a) => a.type === "image");
  const files = m.attachments.filter((a) => a.type !== "image");
  return (
    <motion.li
      ref={ref}
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      className={cn("flex flex-col", mine ? "items-end" : "items-start", first && "mt-2")}
      data-testid={mine ? "chat-bubble-mine" : "chat-bubble-theirs"}
    >
      {!mine && first && <span className="mb-0.5 px-2 text-[11px] font-semibold text-muted-foreground">{name}</span>}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-xs",
          mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
          m.pending === "failed" && "bg-destructive/15 text-foreground",
          m.deletedAt && "italic opacity-70",
        )}
      >
        {m.deletedAt ? (
          t("chat.deleted")
        ) : (
          <>
            {images.length > 0 && (
              <span className="mb-1.5 grid grid-cols-2 gap-1">
                {images.map((a, i) => (
                  <a key={i} href={imageUrl(a.url) ?? "#"} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl">
                    <img src={imageUrl(a.url) ?? ""} alt={a.name ?? t("chat.photo")} className="aspect-square w-full object-cover" loading="lazy" />
                  </a>
                ))}
              </span>
            )}
            {m.body}
            {files.map((a, i) => (
              <a key={i} href={imageUrl(a.url) ?? "#"} target="_blank" rel="noopener noreferrer" className="mt-1 block underline">
                {a.name ?? t("chat.attachment")}
              </a>
            ))}
          </>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
        {m.editedAt && !m.deletedAt && <span>{t("chat.edited")} ·</span>}
        <time dateTime={m.createdAt}>{time}</time>
        {mine &&
          (m.pending === "sending" ? (
            <ClockIcon className="size-3" aria-label={t("chat.sending")} />
          ) : m.pending === "failed" ? null : seen ? (
            <CheckCheckIcon className="size-3.5 text-primary" aria-label={t("chat.seen")} data-testid="tick-seen" />
          ) : (
            <CheckIcon className="size-3.5" aria-label={t("chat.sent")} data-testid="tick-sent" />
          ))}
      </span>
      {m.pending === "failed" && (
        <button type="button" onClick={onRetry} className="mt-0.5 flex items-center gap-1 px-1 text-[11px] font-semibold text-danger-ink hover:underline">
          <RefreshCwIcon className="size-3" />
          {t("chat.failed")}
        </button>
      )}
    </motion.li>
  );
});

function ThreadSkeleton() {
  return (
    <div className="grid gap-3" aria-busy>
      {[60, 40, 70, 30].map((w, i) => (
        <div key={i} className={cn("sf-shimmer h-10 rounded-2xl", i % 2 ? "ms-auto" : "")} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
