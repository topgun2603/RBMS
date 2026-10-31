"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, InboxIcon, Loader2Icon, LockIcon, PhoneIcon, SendHorizontalIcon, ShieldCheckIcon, TicketIcon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { Field, FieldControl, FieldError, FieldHint, FieldLabel, FieldRow, InputGroup, InputGroupAddon, InputGroupInput } from "@rbms/ui/components/field";
import { Input } from "@rbms/ui/components/input";
import { OtpInput } from "@rbms/ui/components/otp-input";
import { toast } from "@rbms/ui/components/sonner";
import { Textarea } from "@rbms/ui/components/textarea";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { canReply, ticketTone } from "../lib/help";
import { formatDate, normalizeMobile, prettyPhone } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { List, OrderSummary, PublicThread, PublicTicket } from "../types";
import { Empty, StatusChip } from "../components/bits";
import { ApiError, call, errorMessage } from "./api";
import { OtpSignIn } from "./sign-in";
import { useStore } from "./store-context";

// ------------------------------------------------------------------ identity (signed-in shopper or OTP-verified guest)

const GUEST_KEY = "sr_support_guest";

interface GuestToken {
  token: string;
  phone: string;
  expiresAt: string;
}

function readGuest(): GuestToken | null {
  try {
    const g = JSON.parse(sessionStorage.getItem(GUEST_KEY) ?? "null") as GuestToken | null;
    return g?.token && Date.parse(g.expiresAt) > Date.now() + 30_000 ? g : null;
  } catch {
    return null;
  }
}

function writeGuest(g: GuestToken | null) {
  try {
    if (g) sessionStorage.setItem(GUEST_KEY, JSON.stringify(g));
    else sessionStorage.removeItem(GUEST_KEY);
  } catch {
    /* storage off */
  }
}

/**
 * Who talks to the help desk: the signed-in shopper (bearer token), else a guest with a 60-minute OTP-verified token
 * (`x-guest-token`, kept in sessionStorage for this tab), else nobody yet.
 */
export function useSupportIdentity() {
  const { auth } = useStore();
  const [guest, setGuestState] = React.useState<GuestToken | null>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    setGuestState(readGuest());
    setReady(true);
  }, []);
  const setGuest = React.useCallback((g: GuestToken | null) => {
    writeGuest(g);
    setGuestState(g);
  }, []);
  const user = !!auth.token;
  const kind: "user" | "guest" | null = user ? "user" : guest ? "guest" : null;
  const headers = React.useMemo((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (!user && guest) h["x-guest-token"] = guest.token;
    return h;
  }, [user, guest]);
  return { ready: ready && auth.ready, kind, guest, setGuest, headers, key: user ? `u:${auth.user?.id ?? "me"}` : guest ? `g:${guest.phone}` : "none" };
}

/** Sign in, or verify a phone as a guest (two steps: number → OTP). */
export function SupportGate({ onGuest }: { onGuest(g: GuestToken): void }) {
  const { t } = useStore();
  const [mode, setMode] = React.useState<"choose" | "signin" | "guest">("choose");
  const reduced = useReducedMotionSafe();
  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="kolam mx-auto grid max-w-md gap-5 rounded-3xl border bg-card p-6 shadow-[var(--elevation-1)] sm:p-8" data-testid="support-gate">
      <div className="text-center">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LockIcon className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">{t("ticket.signInOrGuest")}</p>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {mode === "choose" && (
          <motion.div key="choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" className="rounded-full" onClick={() => setMode("signin")}>
              {t("ticket.signIn")}
            </Button>
            <Button size="lg" variant="outline" className="rounded-full" onClick={() => setMode("guest")} data-testid="support-guest">
              {t("ticket.guest")}
            </Button>
          </motion.div>
        )}
        {mode === "signin" && (
          <motion.div key="signin" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
            <OtpSignIn compact />
          </motion.div>
        )}
        {mode === "guest" && (
          <motion.div key="guest" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
            <GuestVerify onVerified={onGuest} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function GuestVerify({ onVerified }: { onVerified(g: GuestToken): void }) {
  const { t } = useStore();
  const [phone, setPhone] = React.useState("");
  const [target, setTarget] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = normalizeMobile(phone);
    if (!n) return setError(t("auth.invalidPhone"));
    setBusy(true);
    try {
      await call("/auth/otp/request", { body: { target: n, channel: "sms" }, auth: false });
      setTarget(n);
      setCode("");
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c = code) => {
    if (!target || c.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ guestToken: string; expiresAt: string; phone: string }>("/auth/guest/verify", { body: { target, code: c }, auth: false });
      const g = { token: r.guestToken, phone: r.phone, expiresAt: r.expiresAt };
      writeGuest(g);
      onVerified(g);
      toast.success(t("ticket.guestVerified", { phone: prettyPhone(r.phone) }));
    } catch (err) {
      setError(errorMessage(err, t));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (!target) {
    return (
      <form onSubmit={request} className="grid gap-4" noValidate>
        <Field invalid={!!error}>
          <FieldLabel>{t("ticket.guestPhone")}</FieldLabel>
          <InputGroup size="lg" className="rounded-xl">
            <InputGroupAddon>
              <PhoneIcon className="size-4" /> +91
            </InputGroupAddon>
            <FieldControl>
              <InputGroupInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" data-testid="guest-phone" />
            </FieldControl>
          </InputGroup>
          <FieldError className="text-danger-ink">{error}</FieldError>
        </Field>
        <Button type="submit" size="lg" className="rounded-full" disabled={busy} data-testid="guest-send">
          {busy && <Loader2Icon className="animate-spin" />}
          {t("ticket.guestSend")}
        </Button>
      </form>
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <Field invalid={!!error}>
        <FieldLabel htmlFor={null}>{t("ticket.guestCode", { phone: prettyPhone(target) })}</FieldLabel>
        <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} autoFocus invalid={!!error} />
        <FieldError className="text-danger-ink">{error}</FieldError>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="flex-1 rounded-full" disabled={busy || code.length < 6} data-testid="guest-verify">
          {busy ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
          {t("ticket.guestVerify")}
        </Button>
        <Button type="button" variant="ghost" size="lg" className="rounded-full" onClick={() => setTarget(null)}>
          {t("ticket.guestForget")}
        </Button>
      </div>
    </form>
  );
}

function GuestBadge({ phone, onForget }: { phone: string; onForget(): void }) {
  const { t } = useStore();
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-success/10 px-4 py-2.5 text-sm text-success-ink">
      <ShieldCheckIcon className="size-4" />
      {t("ticket.guestVerified", { phone: prettyPhone(phone) })}
      <button type="button" onClick={onForget} className="ms-auto text-xs font-semibold underline-offset-2 hover:underline">
        {t("ticket.guestForget")}
      </button>
    </p>
  );
}

// ------------------------------------------------------------------ raise a ticket

export function RaiseTicket({ initialOrder }: { initialOrder?: string }) {
  const { t, auth } = useStore();
  const id = useSupportIdentity();
  const router = useRouter();
  const qc = useQueryClient();
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [orderId, setOrderId] = React.useState(initialOrder ?? "");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const orders = useQuery({ queryKey: ["orders", "help"], queryFn: () => call<List<OrderSummary>>("/store/me/orders", { query: { limit: 20 } }), enabled: id.kind === "user" });

  const create = useMutation({
    mutationFn: () =>
      call<PublicThread>("/support/public/tickets", {
        headers: id.headers,
        body: {
          subject: subject.trim(),
          body: body.trim(),
          ...(orderId ? { related: { type: "order", id: orderId } } : {}),
          ...(id.kind === "guest" ? { name: name.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        },
      }),
    onSuccess: (r) => {
      toast.success(t("ticket.created", { number: r.ticket.number }));
      qc.setQueryData(["ticket", id.key, r.ticket.id], r);
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      router.push(`/help/tickets/${r.ticket.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) id.setGuest(null);
      if (err instanceof ApiError && err.code === "invalid_input" && Array.isArray(err.details)) {
        const fe: Record<string, string> = {};
        for (const d of err.details as { path?: (string | number)[]; message?: string }[]) {
          const k = d.path?.[0];
          if (typeof k === "string") fe[k] = d.message ?? t("address.required");
        }
        setErrors(fe);
      }
      toast.error(errorMessage(err, t));
    },
  });

  if (!id.ready) return <div className="sf-shimmer mx-auto h-72 max-w-2xl rounded-3xl" />;
  if (!id.kind) return <SupportGate onGuest={id.setGuest} />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (subject.trim().length < 3) fe.subject = t("address.required");
    if (!body.trim()) fe.body = t("address.required");
    if (id.kind === "guest" && !name.trim()) fe.name = t("address.required");
    setErrors(fe);
    if (!Object.keys(fe).length) create.mutate();
  };
  const orderItems = orders.data?.items ?? [];

  return (
    <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} noValidate className="mx-auto grid max-w-2xl gap-5 rounded-3xl border bg-card p-5 shadow-[var(--elevation-1)] sm:p-7" data-testid="ticket-form">
      <div>
        <h2 className="font-display text-h3 font-semibold">{t("ticket.newTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("ticket.newBody")}</p>
      </div>
      {id.kind === "guest" && id.guest && <GuestBadge phone={id.guest.phone} onForget={() => id.setGuest(null)} />}
      {id.kind === "guest" && (
        <FieldRow>
          <Field invalid={!!errors.name}>
            <FieldLabel>{t("ticket.name")}</FieldLabel>
            <FieldControl>
              <Input size="lg" className="rounded-xl" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} data-testid="ticket-name" />
            </FieldControl>
            <FieldError className="text-danger-ink">{errors.name}</FieldError>
          </Field>
          <Field invalid={!!errors.email}>
            <FieldLabel optional={t("common.optional")}>{t("ticket.email")}</FieldLabel>
            <FieldControl>
              <Input size="lg" type="email" className="rounded-xl" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </FieldControl>
            <FieldError className="text-danger-ink">{errors.email}</FieldError>
          </Field>
        </FieldRow>
      )}
      <FieldRow cols={id.kind === "user" && orderItems.length ? 2 : 1}>
        <Field invalid={!!errors.subject}>
          <FieldLabel>{t("ticket.subject")}</FieldLabel>
          <FieldControl>
            <Input size="lg" className="rounded-xl" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder={t("ticket.subjectPlaceholder")} data-testid="ticket-subject" />
          </FieldControl>
          <FieldError className="text-danger-ink">{errors.subject}</FieldError>
        </Field>
        {id.kind === "user" && orderItems.length > 0 && (
          <Field>
            <FieldLabel optional={t("common.optional")}>{t("ticket.order")}</FieldLabel>
            <FieldControl>
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid="ticket-order">
                <option value="">{t("ticket.orderNone")}</option>
                {orderItems.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {formatDate(o.placedAt, "en")}
                  </option>
                ))}
              </select>
            </FieldControl>
          </Field>
        )}
      </FieldRow>
      <Field invalid={!!errors.body}>
        <FieldLabel aside={<span className="tabular-nums">{body.length}/5000</span>}>{t("ticket.message")}</FieldLabel>
        <FieldControl>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} placeholder={t("ticket.messagePlaceholder")} className="min-h-32 rounded-xl" data-testid="ticket-body" />
        </FieldControl>
        <FieldError className="text-danger-ink">{errors.body}</FieldError>
        {!auth.token && <FieldHint>{t("help.stillNeedBody")}</FieldHint>}
      </Field>
      <motion.div whileTap={{ scale: 0.98 }} className="justify-self-start">
        <Button type="submit" size="lg" className="rounded-full px-7" disabled={create.isPending} data-testid="ticket-submit">
          {create.isPending ? <Loader2Icon className="animate-spin" /> : <SendHorizontalIcon />}
          {t("ticket.submit")}
        </Button>
      </motion.div>
    </motion.form>
  );
}

// ------------------------------------------------------------------ my tickets

export function MyTickets() {
  const { t, locale } = useStore();
  const id = useSupportIdentity();
  const q = useQuery({
    queryKey: ["tickets", id.key],
    queryFn: () => call<List<PublicTicket>>("/support/public/tickets", { headers: id.headers, query: { limit: 50 } }),
    enabled: !!id.kind,
  });
  React.useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401 && id.kind === "guest") id.setGuest(null);
  }, [q.error, id]);

  if (!id.ready) return <TicketsSkeleton />;
  if (!id.kind) return <SupportGate onGuest={id.setGuest} />;
  if (q.isLoading) return <TicketsSkeleton />;
  if (q.isError)
    return (
      <Empty
        icon={<InboxIcon />}
        title={errorMessage(q.error, t)}
        action={
          <Button variant="outline" className="rounded-full" onClick={() => void q.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  const items = q.data?.items ?? [];
  return (
    <div className="grid gap-4">
      {id.kind === "guest" && id.guest && <GuestBadge phone={id.guest.phone} onForget={() => id.setGuest(null)} />}
      {!items.length ? (
        <Empty
          icon={<TicketIcon />}
          title={t("ticket.listEmpty")}
          body={t("ticket.listEmptyBody")}
          action={
            <Button asChild className="rounded-full">
              <Link href="/help/new">{t("help.raise")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3" data-testid="ticket-list">
          {items.map((tk, i) => (
            <motion.li key={tk.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}>
              <Link href={`/help/tickets/${tk.id}`} className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-card focus-ring">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <TicketIcon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{tk.subject}</span>
                  <span className="block text-xs text-muted-foreground">
                    {tk.number} · {t("ticket.updated", { when: formatDate(tk.lastMessageAt, locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}
                  </span>
                </span>
                <StatusChip status={ticketTone(tk.status)} label={t(`ticket.status.${tk.status}`)} className="hidden sm:inline-flex" />
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TicketThread({ ticketId }: { ticketId: string }) {
  const { t, locale, shell } = useStore();
  const id = useSupportIdentity();
  const qc = useQueryClient();
  const reduced = useReducedMotionSafe();
  const [reply, setReply] = React.useState("");
  const q = useQuery({
    queryKey: ["ticket", id.key, ticketId],
    queryFn: () => call<PublicThread>(`/support/public/tickets/${ticketId}/messages`, { headers: id.headers }),
    enabled: !!id.kind,
    // No live channel for tickets: refresh while the page is open.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
  const send = useMutation({
    mutationFn: () => call<PublicThread>(`/support/public/tickets/${ticketId}/messages`, { headers: id.headers, body: { body: reply.trim() } }),
    onSuccess: (r) => {
      qc.setQueryData(["ticket", id.key, ticketId], r);
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      setReply("");
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  if (!id.ready) return <TicketsSkeleton />;
  if (!id.kind) return <SupportGate onGuest={id.setGuest} />;
  if (q.isLoading) return <TicketsSkeleton />;
  if (!q.data) return <Empty icon={<InboxIcon />} title={t("ticket.needSignIn")} />;
  const { ticket, items } = q.data;
  const open = canReply(ticket);
  return (
    <div className="grid gap-5" data-testid="ticket-thread">
      <Link href="/help/tickets" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ChevronLeftIcon className="size-4" />
        {t("ticket.back")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{ticket.number}</p>
          <h1 className="font-display text-h2 font-semibold text-balance">{ticket.subject}</h1>
        </div>
        <StatusChip status={ticketTone(ticket.status)} label={t(`ticket.status.${ticket.status}`)} />
      </div>
      <ol className="grid gap-3">
        {items.map((m, i) => {
          const mine = m.from === "requester";
          return (
            <motion.li
              key={m.id}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
              className={cn("max-w-[92%] rounded-3xl border p-4 sm:max-w-[80%]", mine ? "ms-auto rounded-br-lg bg-primary/5" : "rounded-bl-lg bg-card")}
            >
              <p className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold">{mine ? t("ticket.from.requester") : t("ticket.from.staff", { shop: shell.name })}</span>
                <time dateTime={String(m.createdAt)} className="text-muted-foreground">
                  {formatDate(m.createdAt, locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </time>
              </p>
              <Markdown source={m.body} className="text-sm leading-relaxed text-foreground/90" />
            </motion.li>
          );
        })}
      </ol>
      {ticket.mergedInto ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">{t("ticket.mergedNote", { number: ticket.mergedInto })}</p>
      ) : !open ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">{t("ticket.closedNote")}</p>
      ) : (
        <form
          className="grid gap-3 rounded-3xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) send.mutate();
          }}
        >
          <Field>
            <FieldLabel>{t("ticket.reply")}</FieldLabel>
            <FieldControl>
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={5000} placeholder={t("ticket.replyPlaceholder")} className="min-h-24 rounded-xl" data-testid="ticket-reply" />
            </FieldControl>
          </Field>
          <Button type="submit" className="justify-self-end rounded-full" disabled={!reply.trim() || send.isPending} data-testid="ticket-reply-send">
            {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendHorizontalIcon />}
            {t("ticket.sendReply")}
          </Button>
        </form>
      )}
    </div>
  );
}

function TicketsSkeleton() {
  return (
    <div className="grid gap-3" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="sf-shimmer h-20 rounded-2xl" />
      ))}
    </div>
  );
}
