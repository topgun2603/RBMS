"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  BanIcon,
  BellOffIcon,
  BellRingIcon,
  Clock3Icon,
  FileTextIcon,
  ImageIcon,
  InfoIcon,
  Loader2Icon,
  LockIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  PaperclipIcon,
  PanelRightIcon,
  SendIcon,
  StickyNoteIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  ChipGroup,
  cn,
  EmptyState,
  Field,
  FieldControl,
  FieldHint,
  FieldLabel,
  InitialsAvatar,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusPill,
  Switch,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@rbms/ui";
import { describeError, ModuleLink, QueryError, SearchField, useDebounced, useI18n, useQueryParams, useRouteParams } from "@rbms/web";
import { Age, ConnectionPill, DaySeparator, Section, TagEditor, Ticks, UnreadBadge, useAnnouncer, type TickState } from "../components/bits";
import { AutoTextarea, UploadTray, useUploads } from "../components/composer";
import { StaffSelect, useStaffName } from "../components/staff-select";
import { TemplateDialog } from "../components/template-dialog";
import { TwoPane, useSentinel, useThreadScroll } from "../components/two-pane";
import { useMe } from "../lib/access";
import { groupMessages } from "../lib/grouping";
import { pollWhenNotLive } from "../lib/live";
import {
  flattenPages,
  useWaAddNote,
  useWaAssign,
  useWaContactPatch,
  useWaConversation,
  useWaConversations,
  useWaDeleteNote,
  useWaMarkRead,
  useWaMessages,
  useWaSend,
  useWaTags,
  useWaTagsSet,
  type WaListFilters,
} from "../lib/queries";
import type { LiveStatus } from "../lib/sse";
import { istTime } from "../lib/time";
import type { WaConversation, WaConversationDetail, WaMessage, WaNote } from "../lib/types";
import { useWhatsAppLive } from "../lib/wa-live";
import { countdownInterval, sessionWindow } from "../lib/window";

type Filter = NonNullable<WaListFilters["filter"]>;

export default function WhatsAppPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id?: string }>();
  const openId = id ?? null;
  const openRef = React.useRef(openId);
  openRef.current = openId;
  const [announcer, announce] = useAnnouncer();
  const status = useWhatsAppLive({
    onInbound: (m) => {
      if (m.contactId === openRef.current) announce(t("inbox.wa.announce", { text: (m.body ?? t("inbox.wa.media")).slice(0, 140) }));
    },
  });
  const [details, setDetails] = React.useState(false);

  return (
    <>
      {announcer}
      <TwoPane
        open={!!openId}
        list={<WaList openId={openId} status={status} />}
        thread={
          openId ? (
            <WaThread key={openId} id={openId} status={status} onDetails={() => setDetails(true)} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={MessageSquareTextIcon} title={t("inbox.wa.pickTitle")} description={t("inbox.wa.pickBody")} />
            </div>
          )
        }
        aside={openId ? <ContactPanel id={openId} status={status} /> : undefined}
      />
      {openId && (
        <Sheet open={details} onOpenChange={setDetails}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-sm xl:hidden" closeLabel={t("inbox.common.close")}>
            <SheetHeader>
              <SheetTitle>{t("inbox.wa.details")}</SheetTitle>
            </SheetHeader>
            <ContactPanel id={openId} status={status} />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------------ list

function WaList({ openId, status }: { openId: string | null; status: LiveStatus }) {
  const { t } = useI18n();
  const params = useQueryParams();
  const [filter, setFilter] = React.useState<Filter>(() => {
    const f = params?.get("filter");
    return f === "unread" || f === "mine" || f === "unassigned" ? f : "all";
  });
  const [q, setQ] = React.useState("");
  const [tag, setTag] = React.useState("");
  const debounced = useDebounced(q.trim(), 300);
  const list = useWaConversations({ filter, q: debounced, tag }, pollWhenNotLive(status));
  const tags = useWaTags();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadTotal = list.data?.pages[0]?.unreadTotal ?? 0;
  const sentinel = useSentinel(() => void list.fetchNextPage(), !!list.hasNextPage && !list.isFetchingNextPage);
  const filtered = filter !== "all" || !!debounced || !!tag;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 px-4 pt-5 pb-3 md:pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight">
            <MessageSquareTextIcon className="size-5 text-success-ink" aria-hidden />
            {t("inbox.wa.title")}
            <UnreadBadge count={unreadTotal} label={t("inbox.common.unreadCount", { count: unreadTotal })} />
          </h1>
          <ConnectionPill status={status} className="hidden sm:inline-flex md:hidden lg:inline-flex" />
        </div>
        <SearchField value={q} onChange={setQ} placeholder={t("inbox.wa.search")} size="default" />
        <div className="flex items-center gap-2">
          <ChipGroup<Filter>
            size="sm"
            className="min-w-0 flex-1"
            aria-label={t("inbox.wa.filter")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("inbox.common.all") },
              { value: "unread", label: t("inbox.wa.filterUnread") },
              { value: "mine", label: t("inbox.wa.filterMine") },
              { value: "unassigned", label: t("inbox.wa.filterUnassigned") },
            ]}
          />
          {(tags.data?.length ?? 0) > 0 && (
            <Select value={tag || "__all"} onValueChange={(v) => setTag(v === "__all" ? "" : v)}>
              <SelectTrigger size="sm" className="w-auto max-w-32" aria-label={t("inbox.wa.filterTag")}>
                <TagIcon className="size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("inbox.wa.anyTag")}</SelectItem>
                {tags.data!.map((x) => (
                  <SelectItem key={x.tag} value={x.tag}>
                    {x.tag} ({x.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-2 pb-4 transition-opacity", list.isPlaceholderData && "opacity-60")}>
        {list.isError ? (
          <QueryError compact error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <div className="grid gap-1.5 px-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact icon={MessageSquareTextIcon} title={filtered ? t("inbox.common.noMatch") : t("inbox.wa.emptyTitle")} description={filtered ? undefined : t("inbox.wa.emptyBody")} />
        ) : (
          <ul className="grid gap-0.5" aria-label={t("inbox.wa.conversations")}>
            {items.map((c) => (
              <li key={c.id}>
                <WaRow c={c} active={c.id === openId} />
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinel} className="h-1" />
        {list.isFetchingNextPage && <Loader2Icon className="mx-auto my-3 size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
    </div>
  );
}

function WaRow({ c, active }: { c: WaConversation; active: boolean }) {
  const { t } = useI18n();
  const name = c.name || c.displayPhone;
  const w = sessionWindow(c.lastInboundAt);
  return (
    <ModuleLink
      to={`whatsapp/${c.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-start gap-3 rounded-xl px-2.5 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-primary/8 ring-1 ring-primary/20 hover:bg-primary/10",
      )}
    >
      <InitialsAvatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{name}</span>
          <Age at={c.lastMessageAt} />
        </span>
        <span className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-xs", c.unreadCount > 0 ? "text-foreground" : "text-muted-foreground")}>{c.lastMessagePreview || "—"}</span>
          <UnreadBadge count={c.unreadCount} label={t("inbox.common.unreadCount", { count: c.unreadCount })} />
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {c.optedOutAt && (
            <span className="inline-flex items-center gap-0.5 text-[0.625rem] font-medium text-danger-ink">
              <BanIcon className="size-3" aria-hidden /> {t("inbox.wa.optedOut")}
            </span>
          )}
          {w.open && (
            <span className={cn("inline-flex items-center gap-0.5 text-[0.625rem] font-medium", w.tone === "closing" ? "text-warning-ink" : "text-success-ink")}>
              <Clock3Icon className="size-3" aria-hidden /> {t("inbox.wa.windowShort", { h: w.hours, m: w.minutes })}
            </span>
          )}
          {c.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-1.5 text-[0.625rem] text-muted-foreground">
              {tag}
            </span>
          ))}
        </span>
      </span>
    </ModuleLink>
  );
}

// ------------------------------------------------------------------ thread

type Item =
  | { id: string; senderId: string; createdAt: string; kind: "msg"; m: WaMessage }
  | { id: string; senderId: string; createdAt: string; kind: "note"; n: WaNote };

function useWindow(lastInboundAt: string | null | undefined) {
  const [now, setNow] = React.useState(() => Date.now());
  const w = sessionWindow(lastInboundAt ?? null, now);
  React.useEffect(() => {
    const h = window.setTimeout(() => setNow(Date.now()), countdownInterval(w.remainingMs));
    return () => window.clearTimeout(h);
  }, [now, w.remainingMs]);
  return w;
}

function WaThread({ id, status, onDetails }: { id: string; status: LiveStatus; onDetails: () => void }) {
  const { t } = useI18n();
  const poll = pollWhenNotLive(status);
  const conv = useWaConversation(id, poll);
  const msgs = useWaMessages(id, poll);
  const markRead = useWaMarkRead();
  const staffName = useStaffName();
  const [tplOpen, setTplOpen] = React.useState(false);
  const c = conv.data;
  const w = useWindow(c?.lastInboundAt);

  const loaded = React.useMemo(() => flattenPages(msgs.data), [msgs.data]);
  const items: Item[] = React.useMemo(() => {
    const out: Item[] = loaded.map((m) => ({ id: m.id, senderId: m.direction === "in" ? "customer" : "shop", createdAt: m.createdAt, kind: "msg" as const, m }));
    const oldest = loaded[0]?.createdAt;
    // Notes older than the loaded messages wait until those pages are loaded.
    for (const n of c?.notes ?? []) if (!msgs.hasNextPage || !oldest || n.createdAt >= oldest) out.push({ id: `note-${n.id}`, senderId: "note", createdAt: n.createdAt, kind: "note", n });
    return out.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }, [loaded, c?.notes, msgs.hasNextPage]);
  const grouped = React.useMemo(() => groupMessages(items, { myId: "shop" }), [items]);

  React.useEffect(() => {
    if (c && c.unreadCount > 0 && !markRead.isPending && document.visibilityState === "visible") markRead.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per unread change
  }, [c?.unreadCount, id]);

  const scroll = useThreadScroll({ count: items.length, lastId: items[items.length - 1]?.id ?? null, resetKey: id });
  const sentinel = useSentinel(() => void msgs.fetchNextPage(), !!msgs.hasNextPage && !msgs.isFetchingNextPage, scroll.ref);

  if (conv.isError) {
    return (
      <div className="flex flex-1 flex-col">
        <BackToList />
        <div className="p-6">
          <QueryError error={conv.error} onRetry={() => void conv.refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 bg-card/60 px-3 py-2.5 backdrop-blur sm:px-4">
        <BackToList />
        {c ? (
          <>
            <InitialsAvatar name={c.name || c.displayPhone} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.name || c.displayPhone}</p>
              <p className="flex items-center gap-2 truncate text-meta text-muted-foreground">
                {c.name && <span className="tabular-nums">{c.displayPhone}</span>}
                <span className="max-sm:hidden">{t("inbox.wa.assignedTo", { name: staffName(c.assigneeId) })}</span>
              </p>
            </div>
            <OptPill c={c} className="max-sm:hidden" />
          </>
        ) : (
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        )}
        <ConnectionPill status={status} className="max-sm:hidden" />
        <Button variant="ghost" size="icon-sm" className="xl:hidden" onClick={onDetails} aria-label={t("inbox.wa.details")}>
          <PanelRightIcon />
        </Button>
      </header>

      {c && <WindowBanner w={w} onTemplate={() => setTplOpen(true)} optedOut={!!c.optedOutAt} />}

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-5" aria-label={t("inbox.chat.messages")}>
        <div ref={sentinel} className="h-1" />
        {msgs.isFetchingNextPage && <Loader2Icon className="mx-auto my-2 size-4 animate-spin text-muted-foreground" aria-label={t("inbox.common.loading")} />}
        {msgs.isError ? (
          <QueryError compact error={msgs.error} onRetry={() => void msgs.refetch()} />
        ) : msgs.isPending ? (
          <div className="grid gap-3 py-4">
            {[50, 35, 60].map((wd, i) => (
              <Skeleton key={i} className={cn("h-10 rounded-2xl", i % 2 ? "ml-auto" : "")} style={{ width: `${wd}%` }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact icon={MessageSquareTextIcon} title={t("inbox.wa.noMessages")} description={t("inbox.wa.noMessagesBody")} />
        ) : (
          <AnimatePresence initial={false}>
            {grouped.map((g) =>
              g.kind === "day" ? (
                <DaySeparator key={g.key} relation={g.relation} at={g.at} />
              ) : (
                <div key={g.key} className={cn("mb-2 flex flex-col gap-0.5", g.senderId === "customer" ? "items-start" : g.senderId === "note" ? "items-center" : "items-end")}>
                  {g.messages.map((it) => (it.kind === "note" ? <NoteBubble key={it.id} contactId={id} n={it.n} /> : <WaBubble key={it.id} m={it.m} />))}
                </div>
              ),
            )}
          </AnimatePresence>
        )}
        {scroll.showJump && (
          <div className="sticky bottom-2 flex justify-center">
            <Button size="sm" variant="secondary" className="rounded-full shadow-md" onClick={() => scroll.toBottom(true)}>
              <ArrowDownIcon /> {t("inbox.chat.newBelow")}
            </Button>
          </div>
        )}
      </div>

      {c && <WaComposer c={c} windowOpen={w.open} onTemplate={() => setTplOpen(true)} onSent={() => scroll.toBottom(true)} />}
      {c && <TemplateDialog contactId={id} contactName={c.name} open={tplOpen} onOpenChange={setTplOpen} />}
    </div>
  );
}

function BackToList() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
      <ModuleLink to="whatsapp" aria-label={t("inbox.common.back")}>
        <ArrowLeftIcon />
      </ModuleLink>
    </Button>
  );
}

export function OptPill({ c, className }: { c: Pick<WaConversation, "optedIn" | "optedOutAt">; className?: string }) {
  const { t } = useI18n();
  if (c.optedOutAt)
    return (
      <StatusPill tone="danger" icon={BanIcon} className={className}>
        {t("inbox.wa.optedOut")}
      </StatusPill>
    );
  if (c.optedIn)
    return (
      <StatusPill tone="success" icon={BellRingIcon} className={className}>
        {t("inbox.wa.optedIn")}
      </StatusPill>
    );
  return (
    <StatusPill tone="neutral" icon={BellOffIcon} className={className}>
      {t("inbox.wa.notOptedIn")}
    </StatusPill>
  );
}

function WindowBanner({ w, onTemplate, optedOut }: { w: ReturnType<typeof sessionWindow>; onTemplate: () => void; optedOut: boolean }) {
  const { t } = useI18n();
  if (w.tone === "open")
    return (
      <div className="flex items-center gap-2 border-b border-success/20 bg-success/8 px-4 py-1.5 text-xs text-success-ink" role="status">
        <Clock3Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{t("inbox.wa.windowOpen", { h: w.hours, m: w.minutes })}</span>
      </div>
    );
  if (w.tone === "closing")
    return (
      <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/12 px-4 py-1.5 text-xs text-warning-ink" role="status">
        <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{t("inbox.wa.windowClosing", { h: w.hours, m: w.minutes })}</span>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/50 px-4 py-2 text-xs" role="status">
      <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{w.tone === "never" ? t("inbox.wa.windowNever") : t("inbox.wa.windowClosed")}</span>
      {!optedOut && (
        <Button size="sm" variant="outline" className="h-7" onClick={onTemplate}>
          <FileTextIcon /> {t("inbox.wa.sendTemplate")}
        </Button>
      )}
    </div>
  );
}

function waTick(s: WaMessage["status"]): TickState {
  return s === "received" ? "delivered" : s;
}

function WaBubble({ m }: { m: WaMessage }) {
  const { t } = useI18n();
  const staffName = useStaffName();
  const out = m.direction === "out";
  const link = m.media?.link ?? null;
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm shadow-xs sm:max-w-[70%]",
        out ? "rounded-br-md bg-[oklch(0.93_0.06_150)] text-foreground dark:bg-[oklch(0.33_0.06_160)]" : "rounded-bl-md border bg-card",
        m.status === "failed" && "ring-2 ring-destructive/50",
      )}
    >
      {m.type === "template" && (
        <p className="mb-1 flex items-center gap-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          <FileTextIcon className="size-3" aria-hidden /> {t("inbox.wa.templateNamed", { name: m.templateName ?? "" })}
        </p>
      )}
      {m.campaignId && (
        <p className="mb-1 flex items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
          <MegaphoneIcon className="size-3" aria-hidden /> {t("inbox.wa.fromCampaign")}
        </p>
      )}
      {(m.type === "image" || m.type === "sticker") &&
        (link ? (
          <a href={link} target="_blank" rel="noreferrer noopener" className="mb-1 block overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image */}
            <img src={link} alt={m.body ?? t("inbox.chat.photo")} loading="lazy" className="max-h-60 w-full object-cover" />
          </a>
        ) : (
          <p className="mb-1 flex items-center gap-1.5 text-meta text-muted-foreground">
            <ImageIcon className="size-4" aria-hidden /> {t("inbox.chat.photo")}
          </p>
        ))}
      {m.type === "document" &&
        (link ? (
          <a href={link} target="_blank" rel="noreferrer noopener" className="mb-1 flex items-center gap-1.5 underline underline-offset-2">
            <FileTextIcon className="size-4" aria-hidden /> {m.media?.filename ?? t("inbox.chat.attachment")}
          </a>
        ) : (
          <p className="mb-1 flex items-center gap-1.5 text-meta text-muted-foreground">
            <FileTextIcon className="size-4" aria-hidden /> {m.media?.filename ?? t("inbox.chat.attachment")}
          </p>
        ))}
      {!["text", "template", "image", "document", "sticker"].includes(m.type) && !m.body && <p className="text-meta text-muted-foreground italic">{t("inbox.wa.unsupported", { type: m.type })}</p>}
      {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
      {m.status === "failed" && m.error && <p className="mt-1 text-xs text-danger-ink">{m.error}</p>}
      <span className="mt-0.5 flex items-center justify-end gap-1 text-[0.625rem] text-muted-foreground">
        {out && m.sentBy && <span className="truncate">{staffName(m.sentBy)}</span>}
        <time dateTime={m.createdAt}>{istTime(m.createdAt)}</time>
        {out && <Ticks state={waTick(m.status)} />}
      </span>
    </motion.div>
  );
}

function NoteBubble({ contactId, n }: { contactId: string; n: WaNote }) {
  const { t } = useI18n();
  const me = useMe();
  const staffName = useStaffName();
  const del = useWaDeleteNote(contactId);
  const canDelete = me.isManager || n.authorId === me.userId;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="group/note w-full max-w-lg rounded-xl border border-dashed border-warning/50 bg-warning/10 px-3 py-2 text-sm"
    >
      <p className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-warning-ink">
        <StickyNoteIcon className="size-3.5" aria-hidden /> {t("inbox.wa.noteBy", { name: staffName(n.authorId) })}
        <time dateTime={n.createdAt} className="ml-auto font-normal text-muted-foreground">
          {istTime(n.createdAt)}
        </time>
        {canDelete && (
          <button
            type="button"
            onClick={() => del.mutate(n.id, { onError: (err) => toast.error(describeError(err, t)) })}
            className="inline-flex size-5 items-center justify-center rounded opacity-60 outline-none hover:bg-foreground/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("inbox.wa.deleteNote")}
          >
            <Trash2Icon className="size-3" />
          </button>
        )}
      </p>
      <p className="break-words whitespace-pre-wrap">{n.body}</p>
    </motion.div>
  );
}

function WaComposer({ c, windowOpen, onTemplate, onSent }: { c: WaConversationDetail; windowOpen: boolean; onTemplate: () => void; onSent: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<"reply" | "note">("reply");
  const [text, setText] = React.useState("");
  const send = useWaSend(c.id);
  const addNote = useWaAddNote(c.id);
  const uploads = useUploads("whatsapp", { max: 1 });
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const optedOutLater = !!c.optedOutAt && (!c.lastInboundAt || c.optedOutAt > c.lastInboundAt);
  const freeForm = windowOpen && !optedOutLater;
  const body = text.trim();
  const busy = send.isPending || addNote.isPending;

  const submit = async () => {
    if (busy) return;
    try {
      if (mode === "note") {
        if (!body) return;
        await addNote.mutateAsync(body);
      } else {
        const file = uploads.items[0];
        if (file) {
          if (!file.done) return;
          const isImage = file.file.type.startsWith("image/");
          await send.mutateAsync({ type: isImage ? "image" : "document", link: file.done.url, ...(body ? { caption: body } : {}), ...(isImage ? {} : { filename: file.file.name }) });
          uploads.clear();
        } else {
          if (!body) return;
          await send.mutateAsync({ type: "text", body });
        }
      }
      setText("");
      onSent();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className={cn("border-t border-border/60 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur sm:px-4", mode === "note" ? "bg-warning/8" : "bg-card/70")}>
      <div className="mb-2 flex items-center gap-2">
        <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "reply" | "note")} aria-label={t("inbox.wa.composerMode")}>
          <ToggleGroupItem value="reply" className="px-3 text-xs">
            <SendIcon /> {t("inbox.wa.reply")}
          </ToggleGroupItem>
          <ToggleGroupItem value="note" className="px-3 text-xs">
            <StickyNoteIcon /> {t("inbox.wa.note")}
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "reply" && !c.optedOutAt && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onTemplate}>
            <FileTextIcon /> {t("inbox.wa.template")}
          </Button>
        )}
      </div>
      {mode === "reply" && !freeForm ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-muted/40 px-3 py-3 text-sm">
          <InfoIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 text-muted-foreground">{c.optedOutAt ? t("inbox.wa.optedOutBody") : t("inbox.wa.templateOnly")}</span>
          {!c.optedOutAt && (
            <Button size="sm" onClick={onTemplate}>
              <FileTextIcon /> {t("inbox.wa.sendTemplate")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {mode === "reply" && <UploadTray uploads={uploads} />}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === "reply" && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    if (e.target.files) uploads.add(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} disabled={uploads.items.length > 0} aria-label={t("inbox.wa.attach")}>
                  <PaperclipIcon />
                </Button>
              </>
            )}
            <AutoTextarea
              value={text}
              maxLength={mode === "note" ? 4000 : 4096}
              onChange={(e) => setText(e.target.value)}
              placeholder={mode === "note" ? t("inbox.wa.notePlaceholder") : uploads.items.length ? t("inbox.wa.caption") : t("inbox.wa.write")}
              aria-label={mode === "note" ? t("inbox.wa.notePlaceholder") : t("inbox.wa.write")}
              onSubmit={() => void submit()}
              className={cn(mode === "note" && "border-warning/50 bg-warning/5")}
            />
            <Button type="submit" size="icon" disabled={busy || (!body && !uploads.items.length) || !uploads.ready} aria-label={mode === "note" ? t("inbox.wa.addNote") : t("inbox.chat.send")}>
              {busy ? <Loader2Icon className="animate-spin" /> : mode === "note" ? <StickyNoteIcon /> : <SendIcon />}
            </Button>
          </form>
          {mode === "note" && <p className="mt-1 text-meta text-warning-ink">{t("inbox.wa.noteHint")}</p>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ contact panel

function ContactPanel({ id, status }: { id: string; status: LiveStatus }) {
  const { t, formatDate } = useI18n();
  const conv = useWaConversation(id, pollWhenNotLive(status));
  const assign = useWaAssign();
  const setTags = useWaTagsSet();
  const patch = useWaContactPatch();
  const tags = useWaTags();
  const c = conv.data;
  if (!c) return <div className="space-y-3 p-4">{conv.isError ? <QueryError compact error={conv.error} /> : [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  const onErr = (err: unknown) => toast.error(describeError(err, t));
  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <Section icon={BellRingIcon} title={t("inbox.wa.consent")} description={t("inbox.wa.consentHint")}>
        <OptPill c={c} />
        {c.optedOutAt ? (
          <p className="text-meta text-muted-foreground">{t("inbox.wa.optedOutOn", { date: formatDate(c.optedOutAt, { dateStyle: "medium" }) })}</p>
        ) : (
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>{t("inbox.wa.optInLabel")}</FieldLabel>
              <FieldControl>
                <Switch checked={c.optedIn} disabled={patch.isPending} onCheckedChange={(v) => patch.mutate({ contactId: c.id, input: { optedIn: v } }, { onError: onErr })} />
              </FieldControl>
            </div>
            <FieldHint>{t("inbox.wa.optInHint")}</FieldHint>
          </Field>
        )}
      </Section>
      <Section icon={TagIcon} title={t("inbox.wa.assignAndTags")}>
        <Field>
          <FieldLabel>{t("inbox.wa.assignee")}</FieldLabel>
          <FieldControl>
            <StaffSelect value={c.assigneeId} disabled={assign.isPending} onChange={(v) => assign.mutate({ contactId: c.id, input: v }, { onError: onErr })} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel htmlFor={null}>{t("inbox.wa.tags")}</FieldLabel>
          <TagEditor
            value={c.tags}
            label={t("inbox.wa.addTag")}
            placeholder={t("inbox.wa.addTag")}
            suggestions={(tags.data ?? []).map((x) => x.tag)}
            disabled={setTags.isPending}
            onChange={(next) => setTags.mutate({ contactId: c.id, input: next }, { onError: onErr })}
          />
        </Field>
      </Section>
      <Section icon={StickyNoteIcon} title={t("inbox.wa.notes")} tone="text-warning-ink">
        {c.notes.length === 0 ? (
          <p className="text-meta text-muted-foreground">{t("inbox.wa.noNotes")}</p>
        ) : (
          <ul className="grid gap-2">
            {c.notes.slice(0, 5).map((n) => (
              <li key={n.id} className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs">
                <p className="line-clamp-3 whitespace-pre-wrap">{n.body}</p>
                <p className="mt-0.5 text-[0.625rem] text-muted-foreground">{formatDate(n.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Button variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ contactId: c.id, input: { archived: !c.archived } }, { onError: onErr, onSuccess: () => toast.success(c.archived ? t("inbox.wa.unarchived") : t("inbox.wa.archived")) })}>
        {c.archived ? t("inbox.wa.unarchive") : t("inbox.wa.archive")}
      </Button>
    </div>
  );
}
