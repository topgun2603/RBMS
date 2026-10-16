"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  HeadsetIcon,
  ImagePlusIcon,
  Loader2Icon,
  MessageCircleIcon,
  MessagesSquareIcon,
  MoreVerticalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
  UserRoundIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AnimatePresence,
  Button,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  InitialsAvatar,
  motion,
  Skeleton,
  StatusPill,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, ModuleLink, QueryError, SearchField, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import { Age, ConnectionPill, DaySeparator, Ticks, TypingDots, UnreadBadge, useAnnouncer } from "../components/bits";
import { AutoTextarea, UploadTray, useUploads } from "../components/composer";
import { TwoPane, useSentinel, useThreadScroll } from "../components/two-pane";
import { useMe } from "../lib/access";
import { inboxLinks } from "../lib/config";
import { formatPhone, money } from "../lib/format";
import { activeTypers, groupMessages, readState } from "../lib/grouping";
import { noteChatCursor, useLiveStream } from "../lib/live";
import {
  applyChatRead,
  flattenPages,
  qk,
  sendTyping,
  upsertChatMessage,
  useChatConversation,
  useChatConversations,
  useChatMessages,
  useCreateDirectChat,
  useDeleteChatMessage,
  useEditChatMessage,
  useMarkChatRead,
  useOrderLite,
  useSendChatMessage,
  useStaff,
  type ChatListFilters,
} from "../lib/queries";
import type { LiveEvent, LiveStatus } from "../lib/sse";
import { istTime } from "../lib/time";
import type { ChatAttachment, ChatConversation, ChatMessage, ConversationType } from "../lib/types";

const EDIT_WINDOW_MS = 15 * 60_000;

const TYPE_ICON: Record<ConversationType, React.ComponentType<{ className?: string }>> = {
  support: HeadsetIcon,
  order: PackageIcon,
  direct: UserRoundIcon,
  group: UsersRoundIcon,
};

interface Pending {
  tempId: string;
  conversationId: string;
  body: string;
  attachments: ChatAttachment[];
  createdAt: string;
  status: "sending" | "failed";
  error?: string;
}

type Typing = Record<string, Record<string, number>>;

/** Title of a conversation as the viewer sees it. */
export function conversationTitle(c: ChatConversation, myId: string | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (c.title) return c.title;
  const others = c.participants.filter((p) => p.userId !== myId && p.name).map((p) => p.name!);
  if (c.type === "order" && others.length === 0) return t("inbox.chat.orderChat");
  if (others.length) return others.slice(0, 3).join(", ") + (others.length > 3 ? ` +${others.length - 3}` : "");
  return t(`inbox.chat.type.${c.type}`);
}

export default function ChatPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id?: string }>();
  const openId = id ?? null;
  const qc = useQueryClient();
  const me = useMe();
  const [typing, setTyping] = React.useState<Typing>({});
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [announcer, announce] = useAnnouncer();
  const throttle = React.useRef<number | null>(null);
  const openRef = React.useRef(openId);
  openRef.current = openId;

  const refreshLists = React.useCallback(() => {
    if (throttle.current !== null) return;
    throttle.current = window.setTimeout(() => {
      throttle.current = null;
      void qc.invalidateQueries({ queryKey: qk.chatLists });
      void qc.invalidateQueries({ queryKey: qk.chatUnread });
    }, 800);
  }, [qc]);

  const onEvent = React.useCallback(
    (e: LiveEvent) => {
      const d = e.data as Record<string, unknown>;
      if (e.type === "message") {
        const m = (d as { message: ChatMessage }).message;
        if (!m) return;
        upsertChatMessage(qc, m);
        refreshLists();
        setTyping((ty) => {
          const conv = ty[m.conversationId];
          if (!conv?.[m.senderId]) return ty;
          const { [m.senderId]: _gone, ...rest } = conv;
          return { ...ty, [m.conversationId]: rest };
        });
        if (m.senderId !== me.userId && m.conversationId === openRef.current && !m.editedAt && !m.deletedAt) {
          const conv = qc.getQueryData<ChatConversation>(qk.chatConv(m.conversationId));
          const name = conv?.participants.find((p) => p.userId === m.senderId)?.name ?? t("inbox.chat.someone");
          announce(t("inbox.chat.announce", { name, text: m.body.slice(0, 140) || t("inbox.chat.photo") }));
        }
      } else if (e.type === "read") {
        const r = d as { conversationId: string; userId: string; readAt: string };
        applyChatRead(qc, r.conversationId, r.userId, r.readAt, me.userId);
        if (r.userId === me.userId) refreshLists();
      } else if (e.type === "typing") {
        const ty = d as { conversationId: string; userId: string };
        setTyping((prev) => ({ ...prev, [ty.conversationId]: { ...(prev[ty.conversationId] ?? {}), [ty.userId]: Date.now() } }));
      } else if (e.type === "conversation") {
        refreshLists();
        const cid = (d.conversationId as string | undefined) ?? (d.conversation as ChatConversation | undefined)?.id;
        if (cid) void qc.invalidateQueries({ queryKey: qk.chatConv(cid) });
      }
    },
    [qc, refreshLists, me.userId, announce, t],
  );

  const status = useLiveStream("chat", {
    onEvent,
    onReady: ({ reconnected, data }) => {
      if (!reconnected) return;
      refreshLists();
      if ((data as { truncated?: boolean } | null)?.truncated) void qc.invalidateQueries({ queryKey: [...qk.chat, "messages"] });
    },
  });

  return (
    <>
      {announcer}
      <TwoPane
        open={!!openId}
        list={<ConversationList openId={openId} status={status} />}
        thread={
          openId ? (
            <Thread key={openId} id={openId} status={status} typing={typing[openId] ?? {}} pending={pending.filter((p) => p.conversationId === openId)} setPending={setPending} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={MessagesSquareIcon} title={t("inbox.chat.pickTitle")} description={t("inbox.chat.pickBody")} />
            </div>
          )
        }
      />
    </>
  );
}

// ------------------------------------------------------------------ list

type TypeFilter = "" | "support" | "order" | "team";

function ConversationList({ openId, status }: { openId: string | null; status: LiveStatus }) {
  const { t } = useI18n();
  const me = useMe();
  const [type, setType] = React.useState<TypeFilter>("");
  const [q, setQ] = React.useState("");
  const filters: ChatListFilters = { type: type === "team" ? "" : type };
  const list = useChatConversations(filters, status === "live" ? false : 30_000);
  const all = React.useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const items = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((c) => {
      if (type === "team" && c.type !== "direct" && c.type !== "group") return false;
      if (!term) return true;
      const hay = [c.title, c.lastMessagePreview, ...c.participants.map((p) => p.name)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [all, q, type]);
  const sentinel = useSentinel(() => void list.fetchNextPage(), !!list.hasNextPage && !list.isFetchingNextPage);
  const unreadTotal = list.data?.pages[0]?.unreadTotal ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 px-4 pt-5 pb-3 md:pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight">
            <MessageCircleIcon className="size-5 text-primary" aria-hidden />
            {t("inbox.chat.title")}
            <UnreadBadge count={unreadTotal} label={t("inbox.common.unreadCount", { count: unreadTotal })} />
          </h1>
          <div className="flex items-center gap-1">
            <ConnectionPill status={status} className="hidden sm:inline-flex md:hidden lg:inline-flex" />
            <NewChatButton />
          </div>
        </div>
        <SearchField value={q} onChange={setQ} placeholder={t("inbox.chat.search")} size="default" />
        <ChipGroup<TypeFilter>
          size="sm"
          aria-label={t("inbox.chat.filter")}
          value={type}
          onChange={setType}
          options={[
            { value: "", label: t("inbox.common.all") },
            { value: "support", label: t("inbox.chat.type.support") },
            { value: "order", label: t("inbox.chat.type.order") },
            { value: "team", label: t("inbox.chat.team") },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {list.isError ? (
          <QueryError compact error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <div className="grid gap-1.5 px-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact icon={MessagesSquareIcon} title={q || type ? t("inbox.common.noMatch") : t("inbox.chat.emptyTitle")} description={q || type ? undefined : t("inbox.chat.emptyBody")} />
        ) : (
          <ul className="grid gap-0.5" aria-label={t("inbox.chat.conversations")}>
            {items.map((c) => {
              const Icon = TYPE_ICON[c.type];
              const title = conversationTitle(c, me.userId, t);
              const active = c.id === openId;
              return (
                <li key={c.id}>
                  <ModuleLink
                    to={`chat/${c.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-3 rounded-xl px-2.5 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-primary/8 ring-1 ring-primary/20 hover:bg-primary/10",
                    )}
                  >
                    <span className="relative">
                      <InitialsAvatar name={title} />
                      <span className="absolute -right-1 -bottom-1 inline-flex size-5 items-center justify-center rounded-full border-2 border-page bg-card text-muted-foreground" title={t(`inbox.chat.type.${c.type}`)}>
                        <Icon className="size-3" aria-hidden />
                        <span className="sr-only">{t(`inbox.chat.type.${c.type}`)}</span>
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm", c.unread > 0 ? "font-semibold" : "font-medium")}>{title}</span>
                        <Age at={c.lastMessageAt ?? c.createdAt} />
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread > 0 ? "text-foreground" : "text-muted-foreground")}>
                          {c.lastMessagePreview === "[photo]" ? t("inbox.chat.photo") : c.lastMessagePreview === "[attachment]" ? t("inbox.chat.attachment") : c.lastMessagePreview || t("inbox.chat.noMessages")}
                        </span>
                        {!c.joined && c.type !== "direct" && c.type !== "group" && <StatusPill tone="info" className="h-5 px-1.5 text-[0.625rem]">{t("inbox.chat.waiting")}</StatusPill>}
                        <UnreadBadge count={c.unread} label={t("inbox.common.unreadCount", { count: c.unread })} />
                      </span>
                    </span>
                  </ModuleLink>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={sentinel} className="h-1" />
        {list.isFetchingNextPage && <Loader2Icon className="mx-auto my-3 size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
    </div>
  );
}

function NewChatButton() {
  const { t } = useI18n();
  const me = useMe();
  const staff = useStaff();
  const create = useCreateDirectChat();
  const navigate = useModuleNavigate();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  if (!staff.available) return null;
  const people = staff.members.filter((m) => m.active && m.userId !== me.userId && (!q || `${m.name ?? ""} ${m.phone ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <Button variant="outline" size="icon-sm" onClick={() => setOpen(true)} aria-label={t("inbox.chat.new")}>
        <PlusIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inbox.chat.new")}</DialogTitle>
            <DialogDescription>{t("inbox.chat.newBody")}</DialogDescription>
          </DialogHeader>
          <SearchField value={q} onChange={setQ} placeholder={t("inbox.chat.findPerson")} size="default" />
          <ul className="max-h-72 overflow-y-auto">
            {people.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t("inbox.common.noMatch")}</li>}
            {people.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={async () => {
                    try {
                      const c = await create.mutateAsync(m.userId);
                      setOpen(false);
                      navigate(`chat/${c.id}`);
                    } catch (err) {
                      toast.error(describeError(err, t));
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <InitialsAvatar name={m.name ?? m.phone ?? ""} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name || formatPhone(m.phone) || m.email}</span>
                    {m.name && <span className="block truncate text-xs text-muted-foreground">{formatPhone(m.phone) || m.email}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ thread

type ShownMessage = ChatMessage & { pending?: Pending };

function Thread({
  id,
  status,
  typing,
  pending,
  setPending,
}: {
  id: string;
  status: LiveStatus;
  typing: Record<string, number>;
  pending: Pending[];
  setPending: React.Dispatch<React.SetStateAction<Pending[]>>;
}) {
  const { t } = useI18n();
  const me = useMe();
  const conv = useChatConversation(id);
  // No stream route on this API: poll the open thread instead.
  const msgs = useChatMessages(id, status === "polling" ? 10_000 : false);
  const markRead = useMarkChatRead();
  const send = useSendChatMessage(id);
  const del = useDeleteChatMessage();
  const [editing, setEditing] = React.useState<ChatMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<ChatMessage | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 2_000);
    return () => window.clearInterval(iv);
  }, []);

  const loaded = React.useMemo(() => flattenPages(msgs.data), [msgs.data]);
  // The stream can echo my message before the POST resolves: hide the optimistic copy once the real one is here.
  const echoed = (p: Pending) =>
    p.status === "sending" &&
    loaded.some((m) => m.senderId === me.userId && m.body === p.body.trim() && m.attachments.length === p.attachments.length && Date.parse(m.createdAt) >= Date.parse(p.createdAt) - 5_000);
  const shown: ShownMessage[] = React.useMemo(
    () => [
      ...loaded,
      ...pending.filter((p) => !echoed(p)).map((p) => ({
        id: p.tempId,
        conversationId: id,
        senderId: me.userId ?? "",
        body: p.body,
        attachments: p.attachments,
        replyTo: null,
        editedAt: null,
        deletedAt: null,
        createdAt: p.createdAt,
        cursor: "",
        pending: p,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- echoed reads loaded/me, listed
    [loaded, pending, id, me.userId],
  );
  const items = React.useMemo(() => groupMessages(shown, { myId: me.userId, now }), [shown, me.userId, now]);
  const last = loaded[loaded.length - 1];

  React.useEffect(() => noteChatCursor(last?.cursor), [last?.cursor]);

  // Mark read when the thread is open and visible and something new from others is in it.
  const lastOther = [...loaded].reverse().find((m) => m.senderId !== me.userId);
  const myRead = conv.data?.participants.find((p) => p.userId === me.userId)?.lastReadAt ?? null;
  const needsRead = !!lastOther && (!myRead || myRead < lastOther.createdAt || (conv.data?.unread ?? 0) > 0);
  React.useEffect(() => {
    if (!needsRead || markRead.isPending) return;
    const go = () => document.visibilityState === "visible" && markRead.mutate(id);
    const h = window.setTimeout(go, 600);
    document.addEventListener("visibilitychange", go);
    return () => {
      window.clearTimeout(h);
      document.removeEventListener("visibilitychange", go);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate is stable enough; re-run when a new message arrives
  }, [needsRead, id, lastOther?.id]);

  const scroll = useThreadScroll({ count: shown.length, lastId: shown[shown.length - 1]?.id ?? null, resetKey: id });
  const sentinel = useSentinel(() => void msgs.fetchNextPage(), !!msgs.hasNextPage && !msgs.isFetchingNextPage, scroll.ref);

  const doSend = async (body: string, attachments: ChatAttachment[], retryOf?: string) => {
    const tempId = retryOf ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setPending((list) => [
      ...list.filter((p) => p.tempId !== tempId),
      { tempId, conversationId: id, body, attachments, createdAt: new Date().toISOString(), status: "sending" },
    ]);
    try {
      await send.mutateAsync({ body, attachments });
      setPending((list) => list.filter((p) => p.tempId !== tempId));
    } catch (err) {
      setPending((list) => list.map((p) => (p.tempId === tempId ? { ...p, status: "failed", error: describeError(err, t) } : p)));
    }
  };

  const c = conv.data;
  const typers = activeTypers(typing, now, me.userId);
  const typerNames = typers.map((u) => c?.participants.find((p) => p.userId === u)?.name ?? t("inbox.chat.someone"));
  const showNames = !!c && (c.type === "group" || c.type === "support" || c.type === "order");

  if (conv.isError) {
    return (
      <div className="flex flex-1 flex-col">
        <ThreadBack />
        <div className="p-6">
          <QueryError error={conv.error} onRetry={() => void conv.refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 bg-card/60 px-3 py-2.5 backdrop-blur sm:px-4">
        <ThreadBack />
        {c ? (
          <>
            <InitialsAvatar name={conversationTitle(c, me.userId, t)} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{conversationTitle(c, me.userId, t)}</p>
              <p className="mt-0.5 truncate text-meta text-muted-foreground">
                {t(`inbox.chat.type.${c.type}`)} · {t("inbox.chat.people", { count: c.participants.length })}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        )}
        <ConnectionPill status={status} />
      </header>

      {c?.type === "order" && c.subjectId && <OrderCard orderId={c.subjectId} />}

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-5" aria-label={t("inbox.chat.messages")}>
        <div ref={sentinel} className="h-1" />
        {msgs.isFetchingNextPage && <Loader2Icon className="mx-auto my-2 size-4 animate-spin text-muted-foreground" aria-label={t("inbox.common.loading")} />}
        {!msgs.hasNextPage && msgs.isSuccess && loaded.length > 0 && <p className="py-3 text-center text-[0.6875rem] text-muted-foreground">{t("inbox.chat.start")}</p>}
        {msgs.isError ? (
          <QueryError compact error={msgs.error} onRetry={() => void msgs.refetch()} />
        ) : msgs.isPending ? (
          <div className="grid gap-3 py-4">
            {[40, 64, 52, 30].map((w, i) => (
              <Skeleton key={i} className={cn("h-10 rounded-2xl", i % 2 ? "ml-auto" : "")} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState compact icon={MessageCircleIcon} title={t("inbox.chat.noMessages")} description={t("inbox.chat.sayHello")} />
        ) : (
          <AnimatePresence initial={false}>
            {items.map((it) =>
              it.kind === "day" ? (
                <DaySeparator key={it.key} relation={it.relation} at={it.at} />
              ) : (
                <div key={it.key} className={cn("mb-2 flex gap-2", it.mine && "flex-row-reverse")}>
                  {!it.mine && <InitialsAvatar name={c?.participants.find((p) => p.userId === it.senderId)?.name ?? "?"} size="sm" className="mt-auto size-7 text-[0.625rem]" />}
                  <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-0.5 sm:max-w-[70%]", it.mine ? "items-end" : "items-start")}>
                    {!it.mine && showNames && <span className="px-2 text-[0.6875rem] font-medium text-muted-foreground">{c?.participants.find((p) => p.userId === it.senderId)?.name ?? t("inbox.chat.someone")}</span>}
                    {it.messages.map((m) => (
                      <Bubble
                        key={m.id}
                        m={m}
                        mine={it.mine}
                        tick={m.pending ? m.pending.status : c ? readState(m, c.participants, me.userId ?? "") : "sent"}
                        canEdit={it.mine && !m.pending && !m.deletedAt && now - Date.parse(m.createdAt) <= EDIT_WINDOW_MS && !!m.body}
                        onEdit={() => setEditing(m)}
                        onDelete={() => setConfirmDelete(m)}
                        onRetry={() => m.pending && void doSend(m.pending.body, m.pending.attachments, m.pending.tempId)}
                        onDiscard={() => m.pending && setPending((l) => l.filter((p) => p.tempId !== m.pending!.tempId))}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </AnimatePresence>
        )}
        <AnimatePresence>
          {typers.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="py-1">
              <TypingDots label={typerNames.length === 1 ? t("inbox.chat.typingOne", { name: typerNames[0]! }) : t("inbox.chat.typingMany")} />
            </motion.div>
          )}
        </AnimatePresence>
        {scroll.showJump && (
          <div className="sticky bottom-2 flex justify-center">
            <Button size="sm" variant="secondary" className="rounded-full shadow-md" onClick={() => scroll.toBottom(true)}>
              <ArrowDownIcon /> {t("inbox.chat.newBelow")}
            </Button>
          </div>
        )}
      </div>

      <ChatComposer conversationId={id} editing={editing} onCancelEdit={() => setEditing(null)} onSend={(b, a) => void doSend(b, a).then(() => scroll.toBottom(true))} />

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t("inbox.chat.deleteTitle")}
        description={t("inbox.chat.deleteBody")}
        confirmLabel={t("inbox.common.delete")}
        onConfirm={async () => {
          try {
            await del.mutateAsync(confirmDelete!.id);
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}

function ThreadBack() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
      <ModuleLink to="chat" aria-label={t("inbox.common.back")}>
        <ArrowLeftIcon />
      </ModuleLink>
    </Button>
  );
}

function Bubble({
  m,
  mine,
  tick,
  canEdit,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
}: {
  m: ShownMessage;
  mine: boolean;
  tick: "sending" | "failed" | "sent" | "read";
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  const images = m.attachments.filter((a) => a.type === "image");
  const files = m.attachments.filter((a) => a.type !== "image");
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group/msg flex max-w-full items-end gap-1", mine && "flex-row-reverse")}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl px-3 py-2 text-sm shadow-xs",
          mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card",
          m.deletedAt && "border border-dashed bg-transparent text-muted-foreground italic shadow-none",
          m.pending?.status === "failed" && "ring-2 ring-destructive/60",
          m.pending?.status === "sending" && "opacity-80",
        )}
      >
        {m.deletedAt ? (
          t("inbox.chat.deleted")
        ) : (
          <>
            {images.length > 0 && (
              <div className={cn("mb-1 grid gap-1", images.length > 1 && "grid-cols-2")}>
                {images.map((a) => (
                  <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {/* eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image */}
                    <img src={a.url} alt={a.name ?? t("inbox.chat.photo")} loading="lazy" className="max-h-60 w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
            {files.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener" className="mb-1 block truncate underline underline-offset-2">
                {a.name ?? t("inbox.chat.attachment")}
              </a>
            ))}
            {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
          </>
        )}
        <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[0.625rem]", mine ? "text-primary-foreground/75" : "text-muted-foreground")}>
          {m.editedAt && !m.deletedAt && <span>{t("inbox.chat.edited")}</span>}
          <time dateTime={m.createdAt}>{istTime(m.createdAt)}</time>
          {mine && !m.deletedAt && <Ticks state={tick} />}
        </span>
      </div>
      {m.pending?.status === "failed" ? (
        <span className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={onRetry} aria-label={t("inbox.chat.retry")} title={m.pending.error}>
            <RotateCcwIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDiscard} aria-label={t("inbox.chat.discard")}>
            <XIcon />
          </Button>
        </span>
      ) : (
        mine &&
        !m.pending &&
        !m.deletedAt && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-60" aria-label={t("inbox.chat.messageActions")}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={mine ? "end" : "start"}>
              {canEdit && (
                <DropdownMenuItem onSelect={onEdit}>
                  <PencilIcon /> {t("inbox.common.edit")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2Icon /> {t("inbox.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      )}
    </motion.div>
  );
}

function ChatComposer({
  conversationId,
  editing,
  onCancelEdit,
  onSend,
}: {
  conversationId: string;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSend: (body: string, attachments: ChatAttachment[]) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = React.useState("");
  const uploads = useUploads("chat", { imagesOnly: true, max: 10 });
  const edit = useEditChatMessage();
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const lastTyping = React.useRef(0);

  React.useEffect(() => {
    if (editing) {
      setText(editing.body);
      areaRef.current?.focus();
    }
  }, [editing]);

  const body = text.trim();
  const canSend = editing ? !!body && body !== editing.body && !edit.isPending : (!!body || uploads.items.length > 0) && uploads.ready && body.length <= 4000;

  const submit = async () => {
    if (!canSend) return;
    if (editing) {
      try {
        await edit.mutateAsync({ id: editing.id, body });
        setText("");
        onCancelEdit();
      } catch (err) {
        toast.error(describeError(err, t));
      }
      return;
    }
    const attachments: ChatAttachment[] = uploads.items.flatMap((u) => (u.done ? [{ url: u.done.url, type: "image" as const, name: u.file.name, mime: u.file.type, size: u.file.size }] : []));
    onSend(body, attachments);
    setText("");
    uploads.clear();
    areaRef.current?.focus();
  };

  return (
    <div className="border-t border-border/60 bg-card/70 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur sm:px-4">
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs">
          <PencilIcon className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">{t("inbox.chat.editing")}</span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => (setText(""), onCancelEdit())}>
            {t("inbox.common.cancel")}
          </Button>
        </div>
      )}
      <UploadTray uploads={uploads} />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!editing && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) uploads.add(e.target.files);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label={t("inbox.chat.addPhoto")}>
              <ImagePlusIcon />
            </Button>
          </>
        )}
        <AutoTextarea
          ref={areaRef}
          value={text}
          maxLength={4000}
          aria-label={t("inbox.chat.write")}
          placeholder={t("inbox.chat.write")}
          onChange={(e) => {
            setText(e.target.value);
            if (!editing && Date.now() - lastTyping.current > 3_000 && e.target.value.trim()) {
              lastTyping.current = Date.now();
              void sendTyping(conversationId);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editing) {
              e.preventDefault();
              setText("");
              onCancelEdit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (files.length && !editing) {
              e.preventDefault();
              uploads.add(files);
            }
          }}
          onSubmit={() => void submit()}
        />
        <Button type="submit" size="icon" disabled={!canSend} aria-label={editing ? t("inbox.common.save") : t("inbox.chat.send")}>
          {edit.isPending || uploads.busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </form>
    </div>
  );
}

function OrderCard({ orderId }: { orderId: string }) {
  const { t, formatDate } = useI18n();
  const order = useOrderLite(orderId);
  const href = inboxLinks().order(orderId);
  return (
    <div className="border-b border-border/60 bg-muted/30 px-3 py-2 sm:px-4">
      <ModuleLink href={href} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="icon-chip size-8 text-primary">
          <PackageIcon className="size-4" />
        </span>
        {order.isPending && order.fetchStatus !== "idle" ? (
          <Skeleton className="h-4 w-48" />
        ) : order.data ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{t("inbox.chat.orderNumber", { number: order.data.number })}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {money(order.data.total)} · {t("inbox.chat.orderPlaced", { date: formatDate(order.data.placedAt, { day: "numeric", month: "short" }) })} ·{" "}
              {t.has(`orders.status.${order.data.status}`) ? t(`orders.status.${order.data.status}`) : order.data.status}
            </span>
          </span>
        ) : (
          <span className="flex-1 font-medium">{t("inbox.chat.openOrder")}</span>
        )}
        <span className="text-xs font-medium text-primary">{t("inbox.common.open")}</span>
      </ModuleLink>
    </div>
  );
}
