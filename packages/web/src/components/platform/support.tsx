"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, LifeBuoyIcon, Loader2Icon, MegaphoneIcon, PlusIcon, SendIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Input, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea, toast } from "@rbms/ui";
import { useOptionalSession } from "../../app/session";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { DEMO_PLATFORM_ROLE } from "../demo-banner";

/**
 * Contacting RBMS support and "What's new" (Phase 7 part B), for every app that mounts the shared shell. The shop's side of
 * /v1/platform: its own tickets and replies (never the team's notes, triage or AI draft), and the notes for its app and trade.
 * Nothing here is sent by WhatsApp, SMS or e-mail: replies show in this panel and as a badge on the account menu.
 */

interface ShopTicket {
  id: string;
  number: string;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed";
  unread: boolean;
  createdAt: string;
  lastMessageAt: string;
  messages?: { id: string; from: "you" | "rbms"; authorName: string | null; body: string; createdAt: string }[];
}
interface Note {
  id: string;
  titleEn: string;
  titleTa: string;
  publishedAt: string | null;
  items: { id: string; en: string; ta: string }[];
}

const BADGES = ["platform", "badges"] as const;

/** Opens the support panel from anywhere (the help assistant passes the question and the screen). */
export interface OpenSupport {
  question?: string | null;
  screen?: string | null;
}
const OPEN_SUPPORT = "rbms:open-support";
const OPEN_NEWS = "rbms:open-whats-new";
export function openSupport(detail: OpenSupport = {}) {
  window.dispatchEvent(new CustomEvent<OpenSupport>(OPEN_SUPPORT, { detail }));
}
export function openWhatsNew() {
  window.dispatchEvent(new CustomEvent(OPEN_NEWS));
}

/** Unread RBMS replies and unseen What's new notes, for the account menu badge. */
export function usePlatformBadges() {
  const session = useOptionalSession();
  return useQuery({
    queryKey: BADGES,
    queryFn: () => api.get<{ support: number; whatsNew: number }>("/platform/badges"),
    enabled: !!session,
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });
}

export function useIsDemo() {
  const session = useOptionalSession();
  return !!session?.me.user.platformRoles.includes(DEMO_PLATFORM_ROLE);
}

/** The two sheets, mounted once in the app frame and opened by events. */
export function PlatformHost() {
  const [support, setSupport] = React.useState<OpenSupport | null>(null);
  const [news, setNews] = React.useState(false);
  React.useEffect(() => {
    const s = (e: Event) => setSupport((e as CustomEvent<OpenSupport>).detail ?? {});
    const n = () => setNews(true);
    window.addEventListener(OPEN_SUPPORT, s);
    window.addEventListener(OPEN_NEWS, n);
    return () => {
      window.removeEventListener(OPEN_SUPPORT, s);
      window.removeEventListener(OPEN_NEWS, n);
    };
  }, []);
  return (
    <>
      <SupportSheet open={support !== null} prefill={support} onOpenChange={(o) => !o && setSupport(null)} />
      <WhatsNewSheet open={news} onOpenChange={setNews} />
    </>
  );
}

function SupportSheet({ open, prefill, onOpenChange }: { open: boolean; prefill: OpenSupport | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const demo = useIsDemo();
  const [view, setView] = React.useState<"list" | "new" | string>("list");
  React.useEffect(() => {
    if (open) setView(prefill?.question ? "new" : "list");
  }, [open, prefill]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md" closeLabel={t("web.common.close")}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LifeBuoyIcon className="size-5" /> {t("web.platform.support.title")}
          </SheetTitle>
          <SheetDescription>{t("web.platform.support.intro")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-4">
          {demo && (
            <Alert>
              <AlertDescription>{t("web.platform.support.demo")}</AlertDescription>
            </Alert>
          )}
          {view === "list" ? (
            <TicketList onOpen={setView} onNew={() => setView("new")} canWrite={!demo} />
          ) : view === "new" ? (
            <NewTicket prefill={prefill} onBack={() => setView("list")} onSent={(id) => setView(id)} disabled={demo} />
          ) : (
            <TicketThread id={view} onBack={() => setView("list")} canWrite={!demo} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatusBadge({ status }: { status: ShopTicket["status"] }) {
  const { t } = useI18n();
  const variant = status === "pending" ? "default" : status === "resolved" ? "success" : status === "closed" ? "muted" : "warning";
  return <Badge variant={variant}>{t(`web.platform.support.status.${status}`)}</Badge>;
}

function TicketList({ onOpen, onNew, canWrite }: { onOpen: (id: string) => void; onNew: () => void; canWrite: boolean }) {
  const { t, formatDate } = useI18n();
  const q = useQuery({ queryKey: ["platform", "tickets"], queryFn: () => api.get<{ items: ShopTicket[] }>("/platform/support/tickets") });
  return (
    <div className="grid gap-3">
      {canWrite && (
        <Button onClick={onNew} className="justify-self-start">
          <PlusIcon /> {t("web.platform.support.new")}
        </Button>
      )}
      <p className="text-sm font-semibold">{t("web.platform.support.mine")}</p>
      {q.isPending ? (
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">{describeError(q.error, t)}</p>
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("web.platform.support.none")}</p>
      ) : (
        <ul className="grid gap-2" data-testid="my-tickets">
          {q.data.items.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => onOpen(x.id)} className="grid w-full gap-1 rounded-xl bg-card p-3 text-left text-sm ring-1 ring-border hover:bg-accent">
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={x.status} />
                  {x.unread && <Badge variant="destructive">{t("web.platform.support.newReply")}</Badge>}
                </span>
                <span className="font-medium break-words">{x.subject}</span>
                <span className="text-meta text-muted-foreground">
                  {x.number} · {formatDate(x.lastMessageAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTicket({ prefill, onBack, onSent, disabled }: { prefill: OpenSupport | null; onBack: () => void; onSent: (id: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const question = prefill?.question?.trim() || null;
  const screen = prefill?.screen ?? (typeof window !== "undefined" ? window.location.pathname : null);
  const [subject, setSubject] = React.useState(question ? question.slice(0, 120) : "");
  const [body, setBody] = React.useState(question ?? "");
  const send = useMutation({
    mutationFn: () => api.post<ShopTicket>("/platform/support/tickets", { subject, body, screen, question, source: question ? "help" : "menu" }),
    onSuccess: (tk) => {
      toast.success(t("web.platform.support.sent"));
      void qc.invalidateQueries({ queryKey: ["platform"] });
      onSent(tk.id);
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && subject.trim().length >= 3 && body.trim().length >= 5) send.mutate();
      }}
    >
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}>
        <ArrowLeftIcon /> {t("web.platform.support.back")}
      </Button>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t("web.platform.support.subject")}</span>
        <Input value={subject} maxLength={160} onChange={(e) => setSubject(e.target.value)} placeholder={t("web.platform.support.subjectPlaceholder")} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t("web.platform.support.body")}</span>
        <Textarea rows={6} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder={t("web.platform.support.bodyPlaceholder")} />
      </label>
      {screen && <p className="text-meta break-all text-muted-foreground">{t("web.platform.support.screen", { screen })}</p>}
      {question && <p className="text-meta text-muted-foreground">{t("web.platform.support.fromHelp")}</p>}
      <Button type="submit" disabled={disabled || send.isPending || subject.trim().length < 3 || body.trim().length < 5}>
        {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {send.isPending ? t("web.platform.support.sending") : t("web.platform.support.send")}
      </Button>
    </form>
  );
}

function TicketThread({ id, onBack, canWrite }: { id: string; onBack: () => void; canWrite: boolean }) {
  const { t, formatDate } = useI18n();
  const formatDateTime = (d: string) => formatDate(d, { dateStyle: "medium", timeStyle: "short" });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "ticket", id], queryFn: () => api.get<ShopTicket>(`/platform/support/tickets/${id}`) });
  const [text, setText] = React.useState("");
  // Opening a ticket clears its unread flag on the server: refresh the badge.
  React.useEffect(() => {
    if (q.data) void qc.invalidateQueries({ queryKey: BADGES });
  }, [q.data, qc]);
  const reply = useMutation({
    mutationFn: () => api.post<ShopTicket>(`/platform/support/tickets/${id}/messages`, { body: text }),
    onSuccess: (d) => {
      setText("");
      qc.setQueryData(["platform", "ticket", id], d);
      void qc.invalidateQueries({ queryKey: ["platform", "tickets"] });
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  const solved = useMutation({
    mutationFn: () => api.post<ShopTicket>(`/platform/support/tickets/${id}/resolve`, {}),
    onSuccess: (d) => {
      qc.setQueryData(["platform", "ticket", id], d);
      void qc.invalidateQueries({ queryKey: ["platform", "tickets"] });
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (q.isPending) return <Loader2Icon className="size-5 animate-spin text-muted-foreground" />;
  if (q.isError) return <p className="text-sm text-destructive">{describeError(q.error, t)}</p>;
  const tk = q.data;
  return (
    <div className="grid gap-3" data-testid="my-ticket">
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}>
        <ArrowLeftIcon /> {t("web.platform.support.back")}
      </Button>
      <div className="grid gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-meta text-muted-foreground">{tk.number}</span>
          <StatusBadge status={tk.status} />
        </p>
        <p className="font-semibold break-words">{tk.subject}</p>
      </div>
      <ul className="grid gap-2">
        {tk.messages?.map((m) => (
          <li key={m.id} className={`grid gap-1 rounded-xl p-3 text-sm ring-1 ${m.from === "rbms" ? "bg-primary/5 ring-primary/20" : "bg-card ring-border"}`}>
            <p className="text-meta text-muted-foreground">
              {m.from === "rbms" ? t("web.platform.support.rbms") : t("web.platform.support.you")} · {formatDateTime(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        ))}
      </ul>
      {tk.status === "closed" ? (
        <p className="text-sm text-muted-foreground">{t("web.platform.support.closed")}</p>
      ) : (
        canWrite && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) reply.mutate();
            }}
          >
            <Textarea rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("web.platform.support.reply")} aria-label={t("web.platform.support.reply")} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={reply.isPending || !text.trim()}>
                {reply.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("web.platform.support.replySend")}
              </Button>
              {tk.status !== "resolved" && (
                <Button type="button" size="sm" variant="outline" disabled={solved.isPending} onClick={() => solved.mutate()}>
                  <CheckIcon /> {t("web.platform.support.solved")}
                </Button>
              )}
            </div>
          </form>
        )
      )}
    </div>
  );
}

function WhatsNewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale, formatDate } = useI18n();
  const qc = useQueryClient();
  const demo = useIsDemo();
  const q = useQuery({ queryKey: ["platform", "whats-new"], queryFn: () => api.get<{ items: Note[]; unseen: number; seenAt: string | null }>("/platform/whats-new"), enabled: open });
  // Mark as seen once the panel showed the notes (the demo is read-only: it just keeps its badge).
  const seenAt = q.data?.seenAt ?? null;
  React.useEffect(() => {
    if (!open || !q.data || q.data.unseen === 0 || demo) return;
    void api
      .post("/platform/whats-new/seen", {})
      .then(() => qc.invalidateQueries({ queryKey: BADGES }))
      .catch(() => undefined);
  }, [open, q.data, demo, qc]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md" closeLabel={t("web.common.close")}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MegaphoneIcon className="size-5" /> {t("web.platform.news.title")}
          </SheetTitle>
          <SheetDescription>{t("web.platform.news.intro")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-4" data-testid="whats-new">
          {q.isPending ? (
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          ) : q.isError ? (
            <p className="text-sm text-destructive">{describeError(q.error, t)}</p>
          ) : q.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("web.platform.news.none")}</p>
          ) : (
            q.data.items.map((n) => (
              <section key={n.id} className="grid gap-2 rounded-xl bg-card p-3 ring-1 ring-border" lang={locale === "ta" ? "ta" : "en"}>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{locale === "ta" ? n.titleTa || n.titleEn : n.titleEn}</span>
                  {n.publishedAt && <span className="text-meta text-muted-foreground">{formatDate(n.publishedAt)}</span>}
                  {n.publishedAt && (!seenAt || n.publishedAt > seenAt) && <Badge variant="default">{t("web.platform.news.new")}</Badge>}
                </p>
                <ul className="grid list-disc gap-1 pl-5 text-sm">
                  {n.items.map((i) => (
                    <li key={i.id}>{locale === "ta" ? i.ta || i.en : i.en}</li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
