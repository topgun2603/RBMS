"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, InboxIcon, Loader2Icon, RefreshCwIcon, SendIcon, SparklesIcon, StickyNoteIcon } from "lucide-react";
import { Button, EmptyState, Input, PageHeader, Skeleton, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast, type StatusTone } from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { usePlatformT } from "@/lib/platform-messages";

const STATUSES = ["active", "open", "pending", "resolved", "closed", "all"] as const;
const CATEGORIES = ["billing", "payments", "gst", "stock", "printing", "online-store", "login", "subscription", "messages", "import", "bug", "feature-request", "other"] as const;
const URGENCIES = ["urgent", "high", "normal", "low"] as const;
type Status = "open" | "pending" | "resolved" | "closed";
type Urgency = (typeof URGENCIES)[number];

interface ListItem {
  id: string;
  number: string;
  subject: string;
  status: Status;
  category: string | null;
  urgency: Urgency | null;
  language: string | null;
  summary: string | null;
  triageStatus: "queued" | "done" | "failed";
  shop: { slug: string; name: string; appId: string | null } | null;
  requesterName: string | null;
  createdAt: string;
  lastMessageAt: string;
  waitingHours: number | null;
}
interface Triage {
  category: string;
  urgency: Urgency;
  language: "en" | "ta";
  summary: string;
  topic: string;
  draft: string;
  sources: { id: string; chapter: string; title: string }[];
  source: "ai" | "template";
  removed: { sentence: string; reason: string }[];
  urgencyReason?: string | null;
  note?: string | null;
}
interface Detail {
  ticket: {
    id: string;
    number: string;
    subject: string;
    status: Status;
    requesterName: string | null;
    requesterRole: string | null;
    screen: string | null;
    question: string | null;
    source: "help" | "menu";
    triage: Triage | null;
    triageStatus: "queued" | "done" | "failed";
    createdAt: string;
  };
  shop: { slug: string; name: string; appId: string | null } | null;
  messages: { id: string; authorKind: "shop" | "rbms" | "system"; authorName: string | null; kind: "reply" | "note"; body: string; fromDraft: string | null; createdAt: string }[];
}
interface Common {
  weeks: number;
  total: number;
  clusters: { week: string; category: string; label: string; count: number; shops: number; tickets: { id: string; number: string; subject: string }[] }[];
}

const KEY = ["platform", "support"] as const;
const urgencyTone: Record<Urgency, StatusTone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral" };
const statusTone: Record<Status, StatusTone> = { open: "warning", pending: "info", resolved: "success", closed: "neutral" };

/** Platform > Support inbox: tickets shops raised with RBMS, AI triage and draft replies (a person sends), common problems by week. */
export default function SupportInboxPage() {
  return (
    <SuperAdminOnly>
      <Inbox />
    </SuperAdminOnly>
  );
}

function Inbox() {
  const t = usePlatformT();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("inbox");
  return (
    <Page>
      <PageHeader title={t("admin.pt.support.title")} description={t("admin.pt.support.subtitle")} />
      <Tabs value={tab} onValueChange={setTab} className="grid gap-4">
        <TabsList>
          <TabsTrigger value="inbox">{t("admin.pt.support.tab.inbox")}</TabsTrigger>
          <TabsTrigger value="common">{t("admin.pt.support.tab.common")}</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox">
          <TicketsPane selected={selected} onSelect={setSelected} />
        </TabsContent>
        <TabsContent value="common">
          <CommonProblems
            onOpen={(id) => {
              setSelected(id);
              setTab("inbox");
            }}
          />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function TicketsPane({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const t = usePlatformT();
  const { formatDateTime } = useI18n();
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("active");
  const [category, setCategory] = React.useState("");
  const [urgency, setUrgency] = React.useState("");
  const [search, setSearch] = React.useState("");
  const q = useQuery({
    queryKey: [...KEY, "list", status, category, urgency, search],
    queryFn: () => api.get<{ items: ListItem[] }>("/admin/platform/support/tickets", { status: status === "all" ? undefined : status, category: category || undefined, urgency: urgency || undefined, q: search || undefined }, { tenant: null }),
    refetchInterval: 30_000,
  });
  const select = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className={selected ? "hidden gap-3 md:grid" : "grid gap-3"}>
        <div className="grid grid-cols-2 gap-2">
          <select className={select} value={status} onChange={(e) => setStatus(e.target.value as never)} aria-label={t("admin.pt.support.status")}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.pt.support.status.${s}`)}
              </option>
            ))}
          </select>
          <select className={select} value={urgency} onChange={(e) => setUrgency(e.target.value)} aria-label={t("admin.pt.support.urgency")}>
            <option value="">
              {t("admin.pt.support.urgency")}: {t("admin.pt.support.any")}
            </option>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {t(`admin.pt.support.urg.${u}`)}
              </option>
            ))}
          </select>
          <select className={`${select} col-span-2`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("admin.pt.support.category")}>
            <option value="">
              {t("admin.pt.support.category")}: {t("admin.pt.support.any")}
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`admin.pt.support.cat.${c}`)}
              </option>
            ))}
          </select>
          <Input className="col-span-2" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.pt.support.search")} aria-label={t("admin.pt.support.search")} />
        </div>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={InboxIcon} title={t("admin.pt.support.empty")} description={t("admin.pt.support.emptyHint")} />
        ) : (
          <ul className="grid gap-2" data-testid="support-list">
            {q.data.items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className={`grid w-full gap-1 rounded-xl p-3 text-left text-sm ring-1 transition-colors ${selected === r.id ? "bg-primary/10 ring-primary/40" : "bg-card ring-border hover:bg-accent"}`}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-meta text-muted-foreground">{r.number}</span>
                    {r.urgency && <StatusPill tone={urgencyTone[r.urgency]}>{t(`admin.pt.support.urg.${r.urgency}`)}</StatusPill>}
                    <StatusPill tone={statusTone[r.status]}>{t(`admin.pt.support.status.${r.status}`)}</StatusPill>
                  </span>
                  <span className="font-medium break-words">{r.subject}</span>
                  {r.summary && <span className="line-clamp-2 break-words text-muted-foreground">{r.summary}</span>}
                  <span className="text-meta text-muted-foreground">
                    {r.shop?.name ?? "-"} · {r.category ? t(`admin.pt.support.cat.${r.category}`) : r.triageStatus === "queued" ? t("admin.pt.support.triageQueued") : "-"} · {formatDateTime(r.lastMessageAt)}
                    {r.waitingHours !== null && r.waitingHours >= 1 ? ` · ${t("admin.pt.support.waiting", { h: r.waitingHours })}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={selected ? "grid content-start gap-3" : "hidden content-start md:grid"}>
        {selected ? <TicketDetail id={selected} onBack={() => onSelect(null)} /> : <p className="rounded-xl bg-muted/40 p-6 text-sm text-muted-foreground">{t("admin.pt.support.pick")}</p>}
      </div>
    </div>
  );
}

function TicketDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const t = usePlatformT();
  const { t: tt, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...KEY, "ticket", id],
    queryFn: () => api.get<Detail>(`/admin/platform/support/tickets/${id}`, undefined, { tenant: null }),
    refetchInterval: (query) => (query.state.data?.ticket.triageStatus === "queued" ? 3000 : false),
  });
  const [reply, setReply] = React.useState("");
  const [draftUsed, setDraftUsed] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    setReply("");
    setDraftUsed(null);
    setNote("");
  }, [id]);
  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => toast.error(describeError(e, tt));
  const send = useMutation({
    mutationFn: (status: Status | null) =>
      api.post<Detail>(`/admin/platform/support/tickets/${id}/reply`, { body: reply, fromDraft: draftUsed === null ? null : reply.trim() === draftUsed.trim() ? "as-drafted" : "edited", status }, { tenant: null }),
    onSuccess: () => {
      toast.success(t("admin.pt.support.sent"));
      setReply("");
      setDraftUsed(null);
      done();
    },
    onError,
  });
  const addNote = useMutation({
    mutationFn: () => api.post(`/admin/platform/support/tickets/${id}/note`, { body: note }, { tenant: null }),
    onSuccess: () => {
      setNote("");
      done();
    },
    onError,
  });
  const setStatus = useMutation({ mutationFn: (status: Status) => api.post(`/admin/platform/support/tickets/${id}/status`, { status }, { tenant: null }), onSuccess: done, onError });
  const retriage = useMutation({ mutationFn: () => api.post(`/admin/platform/support/tickets/${id}/triage`, {}, { tenant: null }), onSuccess: done, onError });

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  const { ticket: tk, shop, messages } = q.data;
  const tr = tk.triage;
  return (
    <article className="grid gap-4" data-testid="support-detail">
      <Button variant="ghost" size="sm" className="justify-self-start md:hidden" onClick={onBack}>
        <ArrowLeftIcon /> {t("admin.pt.support.back")}
      </Button>
      <header className="grid gap-1 rounded-xl bg-card p-4 ring-1 ring-border">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-meta text-muted-foreground">{tk.number}</span>
          <StatusPill tone={statusTone[tk.status]}>{t(`admin.pt.support.status.${tk.status}`)}</StatusPill>
        </p>
        <h2 className="text-lg font-semibold break-words">{tk.subject}</h2>
        <p className="text-sm text-muted-foreground">
          {shop ? `${shop.name} (${[shop.slug, shop.appId].filter(Boolean).join(" · ")})` : "-"} · {t("admin.pt.support.from", { name: tk.requesterName ?? "-", role: tk.requesterRole ?? "-" })} · {formatDateTime(tk.createdAt)}
        </p>
        {tk.screen && <p className="text-meta break-all text-muted-foreground">{t("admin.pt.support.screen", { screen: tk.screen })}</p>}
        {tk.question && <p className="text-meta break-words text-muted-foreground">{t("admin.pt.support.question", { q: tk.question })}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {tk.status !== "resolved" && tk.status !== "closed" && (
            <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate("resolved")}>
              {t("admin.pt.support.markResolved")}
            </Button>
          )}
          {tk.status === "resolved" && (
            <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate("open")}>
              {t("admin.pt.support.reopen")}
            </Button>
          )}
          {tk.status !== "closed" && (
            <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate("closed")}>
              {t("admin.pt.support.close")}
            </Button>
          )}
        </div>
      </header>

      <section className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-border" aria-labelledby="triage-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="triage-h" className="flex items-center gap-1.5 text-sm font-semibold">
            <SparklesIcon className="size-4" /> {t("admin.pt.support.triage")}
          </h3>
          <Button size="sm" variant="ghost" disabled={retriage.isPending} onClick={() => retriage.mutate()}>
            {retriage.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("admin.pt.support.retriage")}
          </Button>
        </div>
        {tk.triageStatus === "queued" && !tr ? (
          <p className="text-sm text-muted-foreground">{t("admin.pt.support.triageQueued")}</p>
        ) : !tr ? (
          <p className="text-sm text-muted-foreground">{t("admin.pt.support.triageFailed")}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-meta text-muted-foreground">{t("admin.pt.support.category")}</dt>
                <dd>{t(`admin.pt.support.cat.${tr.category}`)}</dd>
              </div>
              <div>
                <dt className="text-meta text-muted-foreground">{t("admin.pt.support.urgency")}</dt>
                <dd>
                  <StatusPill tone={urgencyTone[tr.urgency]}>{t(`admin.pt.support.urg.${tr.urgency}`)}</StatusPill>
                </dd>
              </div>
              <div>
                <dt className="text-meta text-muted-foreground">{t("admin.pt.support.language")}</dt>
                <dd>{t(`admin.pt.support.lang.${tr.language}`)}</dd>
              </div>
              <div>
                <dt className="text-meta text-muted-foreground">{t("admin.pt.support.topic")}</dt>
                <dd className="break-words">{tr.topic}</dd>
              </div>
            </dl>
            <p className="text-sm break-words">
              <span className="text-muted-foreground">{t("admin.pt.support.summary")}: </span>
              {tr.summary}
            </p>
            {tr.urgencyReason && <p className="text-meta text-muted-foreground">{t("admin.pt.support.urgencyRaised", { why: tr.urgencyReason })}</p>}
            <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
              <p className="text-meta font-medium text-muted-foreground">{tr.source === "ai" ? t("admin.pt.support.draft") : t("admin.pt.support.draftTemplate")}</p>
              <p className="text-sm whitespace-pre-wrap break-words" lang={tr.language}>
                {tr.draft}
              </p>
              {tr.sources.length > 0 && (
                <p className="text-meta text-muted-foreground">
                  {t("admin.pt.support.sources")}: {tr.sources.map((s) => `${s.chapter} > ${s.title}`).join(" · ")}
                </p>
              )}
              {tr.removed.length > 0 && (
                <details className="text-meta text-muted-foreground">
                  <summary>{t("admin.pt.support.removed")} ({tr.removed.length})</summary>
                  <ul className="mt-1 grid list-disc gap-0.5 pl-4">
                    {tr.removed.map((r, i) => (
                      <li key={i} className="break-words">
                        {r.reason}: {r.sentence}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReply(tr.draft);
                    setDraftUsed(tr.draft);
                  }}
                >
                  {t("admin.pt.support.useDraft")}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="grid gap-2" aria-labelledby="thread-h">
        <h3 id="thread-h" className="text-sm font-semibold">
          {t("admin.pt.support.thread")}
        </h3>
        <ul className="grid gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`grid gap-1 rounded-xl p-3 text-sm ring-1 ${m.kind === "note" ? "bg-warning/10 ring-warning/30" : m.authorKind === "rbms" ? "bg-primary/5 ring-primary/20 md:ml-8" : "bg-card ring-border md:mr-8"}`}
            >
              <p className="text-meta text-muted-foreground">
                {m.kind === "note" ? `${t("admin.pt.support.noteLabel")} · ` : ""}
                {m.authorKind === "rbms" ? `${t("admin.pt.support.you")}${m.authorName ? ` (${m.authorName})` : ""}` : (m.authorName ?? shop?.name ?? "-")} · {formatDateTime(m.createdAt)}
                {m.fromDraft ? ` · ${t("admin.pt.support.fromDraft")}` : ""}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {tk.status !== "closed" && (
        <form
          className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-border"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim().length >= 2) send.mutate(null);
          }}
        >
          <label className="text-sm font-semibold" htmlFor="reply-box">
            {t("admin.pt.support.reply")}
          </label>
          <Textarea id="reply-box" rows={6} maxLength={6000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("admin.pt.support.replyPlaceholder")} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={send.isPending || reply.trim().length < 2}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("admin.pt.support.send")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={send.isPending || reply.trim().length < 2} onClick={() => send.mutate("resolved")}>
              {t("admin.pt.support.sendResolve")}
            </Button>
          </div>
        </form>
      )}
      <form
        className="grid gap-2 rounded-xl bg-muted/30 p-4 ring-1 ring-border"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) addNote.mutate();
        }}
      >
        <label className="text-sm font-semibold" htmlFor="note-box">
          {t("admin.pt.support.note")}
        </label>
        <Textarea id="note-box" rows={2} maxLength={6000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin.pt.support.notePlaceholder")} />
        <div>
          <Button type="submit" size="sm" variant="outline" disabled={addNote.isPending || !note.trim()}>
            <StickyNoteIcon /> {t("admin.pt.support.addNote")}
          </Button>
        </div>
      </form>
    </article>
  );
}

function CommonProblems({ onOpen }: { onOpen: (id: string) => void }) {
  const t = usePlatformT();
  const { formatDate } = useI18n();
  const [weeks, setWeeks] = React.useState(8);
  const q = useQuery({ queryKey: [...KEY, "common", weeks], queryFn: () => api.get<Common>("/admin/platform/support/common", { weeks }, { tenant: null }) });
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  const byWeek = new Map<string, Common["clusters"]>();
  for (const c of q.data.clusters) byWeek.set(c.week, [...(byWeek.get(c.week) ?? []), c]);
  return (
    <div className="grid gap-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("admin.pt.support.common.weeks")}</span>
        <select className="h-9 rounded-md border bg-background px-2" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label={t("admin.pt.support.common.weeks")}>
          {[4, 8, 12, 26].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      {q.data.clusters.length === 0 ? (
        <EmptyState icon={InboxIcon} title={t("admin.pt.support.common.empty")} />
      ) : (
        [...byWeek.entries()].map(([week, list]) => (
          <section key={week} className="grid gap-2" aria-label={t("admin.pt.support.common.week", { date: formatDate(week) })}>
            <h3 className="text-sm font-semibold">{t("admin.pt.support.common.week", { date: formatDate(week) })}</h3>
            <ul className="grid gap-2 md:grid-cols-2" data-testid="common-problems">
              {list.map((c) => (
                <li key={`${c.week}-${c.category}-${c.label}`} className="grid gap-1 rounded-xl bg-card p-3 text-sm ring-1 ring-border">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium break-words">{c.label}</span>
                    <span className="text-meta text-muted-foreground">{t(`admin.pt.support.cat.${c.category}`)}</span>
                  </p>
                  <p className="text-meta text-muted-foreground">{t("admin.pt.support.common.count", { n: c.count, shops: c.shops })}</p>
                  <ul className="grid gap-0.5">
                    {c.tickets.map((x) => (
                      <li key={x.id}>
                        <button type="button" className="text-left text-primary underline-offset-2 hover:underline" onClick={() => onOpen(x.id)}>
                          {x.number} · {x.subject}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
