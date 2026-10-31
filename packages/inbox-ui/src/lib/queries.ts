"use client";

import * as React from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, useFeature } from "@rbms/web";
import { FEATURES, PERMS, useMe } from "./access";
import { mergeById } from "./grouping";
import type {
  AudiencePreview,
  AudienceSpec,
  Campaign,
  CampaignRecipient,
  ChatAttachment,
  ChatConversation,
  ChatMessage,
  ConversationList,
  ConversationType,
  FaqArticle,
  FaqCategory,
  HeaderMedia,
  MessagePage,
  OrderLite,
  Paged,
  RecipientStatus,
  StaffMember,
  Ticket,
  TicketList,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  TicketThread,
  TemplateMapping,
  WaConversation,
  WaConversationDetail,
  WaConversationList,
  WaMessage,
  WaNote,
  WaTemplate,
} from "./types";

export const PAGE = 30;
export const MESSAGES_PAGE = 40;

export const qk = {
  all: ["inbox"] as const,
  chat: ["inbox", "chat"] as const,
  chatLists: ["inbox", "chat", "list"] as const,
  chatList: (f: object) => ["inbox", "chat", "list", f] as const,
  chatUnread: ["inbox", "chat", "unread"] as const,
  chatConv: (id: string) => ["inbox", "chat", "conv", id] as const,
  chatMessages: (id: string) => ["inbox", "chat", "messages", id] as const,
  wa: ["inbox", "wa"] as const,
  waLists: ["inbox", "wa", "list"] as const,
  waList: (f: object) => ["inbox", "wa", "list", f] as const,
  waUnread: ["inbox", "wa", "unread"] as const,
  waConv: (id: string) => ["inbox", "wa", "conv", id] as const,
  waMessages: (id: string) => ["inbox", "wa", "messages", id] as const,
  waTags: ["inbox", "wa", "tags"] as const,
  waTemplates: ["inbox", "wa", "templates"] as const,
  campaigns: ["inbox", "wa", "campaigns"] as const,
  /** The campaigns table (prefix of every page/filter of it). */
  campaignTable: ["inbox", "wa", "campaigns", "list"] as const,
  campaign: (id: string) => ["inbox", "wa", "campaigns", "detail", id] as const,
  recipients: (id: string, status: string) => ["inbox", "wa", "campaigns", "recipients", id, status] as const,
  audienceSources: ["inbox", "wa", "audience-sources"] as const,
  tickets: ["inbox", "support", "tickets"] as const,
  /** The desk table (useServerTable appends the request params); ticket mutations invalidate `[...tickets, "list"]`. */
  ticketTable: ["inbox", "support", "tickets", "list", "table"] as const,
  ticketSummary: ["inbox", "support", "tickets", "summary"] as const,
  ticket: (id: string) => ["inbox", "support", "tickets", "detail", id] as const,
  faqCategories: ["inbox", "support", "faq", "categories"] as const,
  /** The FAQ manager table; article mutations invalidate `[...faq, "articles"]`. */
  faqArticleTable: ["inbox", "support", "faq", "articles", "table"] as const,
  faqArticle: (id: string) => ["inbox", "support", "faq", "article", id] as const,
  faq: ["inbox", "support", "faq"] as const,
  staff: ["inbox", "staff"] as const,
  order: (id: string) => ["inbox", "order", id] as const,
};

const clean = <T extends object>(f: T) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== false && v !== null)) as T;

const offsetPaging = <T,>(size: number) => ({
  initialPageParam: 0,
  getNextPageParam: (last: Paged<T>, pages: Paged<T>[]) => {
    const loaded = pages.reduce((n, p) => n + p.items.length, 0);
    return last.items.length === size && loaded < last.total ? loaded : undefined;
  },
});

/** Don't retry 4xx answers (feature off, no permission): show them at once. */
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

// ================================================================ staff + context

/** Shop staff for assignee pickers and author names. Needs `staff.manage`; others get an empty list (names fall back). */
export function useStaff() {
  const me = useMe();
  const on = useFeature("staff");
  const enabled = on && me.can(PERMS.staff);
  const q = useQuery({
    queryKey: qk.staff,
    queryFn: () => api.get<Paged<StaffMember>>("/staff/members").then((r) => r.items),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const byId = React.useMemo(() => new Map((q.data ?? []).map((s) => [s.userId, s])), [q.data]);
  return { ...q, members: q.data ?? [], byId, available: enabled && !q.isError };
}

/** The order behind an order conversation (only when the orders feature is on). */
export function useOrderLite(id: string | null | undefined) {
  const on = useFeature(FEATURES.orders);
  return useQuery({
    queryKey: qk.order(id ?? ""),
    queryFn: ({ signal }) => api.get<OrderLite>(`/orders/${id}`, undefined, { signal }),
    enabled: !!id && on,
    staleTime: 60_000,
    retry,
  });
}

// ================================================================ chat

export interface ChatListFilters {
  type?: ConversationType | "";
  scope?: "all" | "mine";
}

export function useChatConversations(filters: ChatListFilters, refetchInterval: number | false = false) {
  const f = clean(filters);
  return useInfiniteQuery({
    queryKey: qk.chatList(f),
    ...offsetPaging<ChatConversation>(PAGE),
    queryFn: ({ pageParam, signal }) => api.get<ConversationList>("/chat/conversations", { ...f, limit: PAGE, offset: pageParam }, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval,
    retry,
  });
}

export function useChatUnread(enabled = true, refetchInterval: number | false = 60_000) {
  return useQuery({
    queryKey: qk.chatUnread,
    queryFn: ({ signal }) => api.get<ConversationList>("/chat/conversations", { limit: 1 }, { signal }).then((r) => r.unreadTotal),
    enabled,
    refetchInterval,
    retry,
  });
}

export function useChatConversation(id: string | null) {
  return useQuery({
    queryKey: qk.chatConv(id ?? ""),
    queryFn: ({ signal }) => api.get<ChatConversation>(`/chat/conversations/${id}`, undefined, { signal }),
    enabled: !!id,
    retry,
  });
}

/** Newest page first; `fetchNextPage` loads older messages (`before=<cursor>`). */
export function useChatMessages(id: string | null, refetchInterval: number | false = false) {
  return useInfiniteQuery({
    refetchInterval,
    queryKey: qk.chatMessages(id ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get<MessagePage>(`/chat/conversations/${id}/messages`, { limit: MESSAGES_PAGE, before: pageParam ?? undefined }, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
    retry,
  });
}

/** Oldest-first list of every loaded page. */
export const flattenPages = <M extends { id: string; createdAt: string }>(data: InfiniteData<{ items: M[] }> | undefined): M[] =>
  data ? mergeById([], [...data.pages].reverse().flatMap((p) => p.items)) : [];

/** Puts a message (new, edited or deleted) into a loaded thread. New ones go on the newest page. */
export function upsertChatMessage(qc: QueryClient, m: ChatMessage) {
  qc.setQueryData<InfiniteData<MessagePage>>(qk.chatMessages(m.conversationId), (data) => {
    if (!data || data.pages.length === 0) return data;
    let found = false;
    const pages = data.pages.map((p) => {
      if (!p.items.some((x) => x.id === m.id)) return p;
      found = true;
      return { ...p, items: p.items.map((x) => (x.id === m.id ? m : x)) };
    });
    if (!found) pages[0] = { ...pages[0]!, items: mergeById(pages[0]!.items, [m]) };
    return { ...data, pages };
  });
}

/** Moves a participant's read marker in a loaded conversation (read ticks). */
export function applyChatRead(qc: QueryClient, conversationId: string, userId: string, readAt: string, myId: string | null) {
  qc.setQueryData<ChatConversation>(qk.chatConv(conversationId), (c) =>
    c
      ? {
          ...c,
          participants: c.participants.map((p) => (p.userId === userId && (!p.lastReadAt || p.lastReadAt < readAt) ? { ...p, lastReadAt: readAt } : p)),
          ...(userId === myId ? { unread: 0, lastReadAt: readAt } : {}),
        }
      : c,
  );
}

export function useSendChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; attachments?: ChatAttachment[] }) => api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, body),
    onSuccess: (m) => upsertChatMessage(qc, m),
  });
}

export function useEditChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.patch<ChatMessage>(`/chat/messages/${id}`, { body }),
    onSuccess: (m) => upsertChatMessage(qc, m),
  });
}

export function useDeleteChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<ChatMessage>(`/chat/messages/${id}`),
    onSuccess: (m) => upsertChatMessage(qc, m),
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  const me = useMe();
  return useMutation({
    mutationFn: (conversationId: string) => api.post<{ conversationId: string; readAt: string }>(`/chat/conversations/${conversationId}/read`, {}),
    onSuccess: (r) => {
      applyChatRead(qc, r.conversationId, me.userId ?? "", r.readAt, me.userId);
      void qc.invalidateQueries({ queryKey: qk.chatLists });
      void qc.invalidateQueries({ queryKey: qk.chatUnread });
    },
  });
}

export function sendTyping(conversationId: string) {
  return api.post(`/chat/conversations/${conversationId}/typing`, {}).catch(() => undefined);
}

export function useCreateDirectChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post<ChatConversation & { created: boolean }>("/chat/conversations", { type: "direct", userId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.chatLists }),
  });
}

// ================================================================ whatsapp inbox

export interface WaListFilters {
  filter?: "all" | "unread" | "mine" | "unassigned" | "opted_out" | "archived";
  q?: string;
  tag?: string;
}

export function useWaConversations(filters: WaListFilters, refetchInterval: number | false) {
  const f = clean(filters);
  return useInfiniteQuery({
    queryKey: qk.waList(f),
    ...offsetPaging<WaConversation>(PAGE),
    queryFn: ({ pageParam, signal }) => api.get<WaConversationList>("/whatsapp/conversations", { ...f, limit: PAGE, offset: pageParam }, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval,
    retry,
  });
}

export function useWaUnread(enabled = true, refetchInterval: number | false = 60_000) {
  return useQuery({
    queryKey: qk.waUnread,
    queryFn: ({ signal }) => api.get<WaConversationList>("/whatsapp/conversations", { limit: 1 }, { signal }).then((r) => r.unreadTotal),
    enabled,
    refetchInterval,
    retry,
  });
}

export function useWaConversation(id: string | null, refetchInterval: number | false = false) {
  return useQuery({
    queryKey: qk.waConv(id ?? ""),
    queryFn: ({ signal }) => api.get<WaConversationDetail>(`/whatsapp/conversations/${id}`, undefined, { signal }),
    enabled: !!id,
    refetchInterval,
    retry,
  });
}

export function useWaMessages(id: string | null, refetchInterval: number | false = false) {
  return useInfiniteQuery({
    queryKey: qk.waMessages(id ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get<{ items: WaMessage[]; nextCursor: string | null }>(`/whatsapp/conversations/${id}/messages`, { limit: MESSAGES_PAGE, before: pageParam ?? undefined }, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
    refetchInterval,
    retry,
  });
}

export function upsertWaMessage(qc: QueryClient, m: WaMessage) {
  qc.setQueryData<InfiniteData<{ items: WaMessage[]; nextCursor: string | null }>>(qk.waMessages(m.contactId), (data) => {
    if (!data || data.pages.length === 0) return data;
    let found = false;
    const pages = data.pages.map((p) => {
      if (!p.items.some((x) => x.id === m.id)) return p;
      found = true;
      return { ...p, items: p.items.map((x) => (x.id === m.id ? m : x)) };
    });
    if (!found) pages[0] = { ...pages[0]!, items: mergeById(pages[0]!.items, [m]) };
    return { ...data, pages };
  });
}

export function applyWaStatus(qc: QueryClient, contactId: string, messageId: string, status: WaMessage["status"], error: string | null) {
  qc.setQueryData<InfiniteData<{ items: WaMessage[]; nextCursor: string | null }>>(qk.waMessages(contactId), (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === messageId ? { ...x, status, error } : x)) })) }
      : data,
  );
}

export function applyWaConversation(qc: QueryClient, c: WaConversation) {
  qc.setQueryData<WaConversationDetail>(qk.waConv(c.id), (d) => (d ? { ...d, ...c } : d));
}

export type WaSendInput =
  | { type: "text"; body: string }
  | { type: "image" | "document"; link: string; caption?: string; filename?: string }
  | { type: "template"; templateId: string; values: Record<string, string>; headerMedia?: HeaderMedia };

export function useWaSend(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WaSendInput) => api.post<WaMessage>(`/whatsapp/conversations/${contactId}/messages`, input),
    onSuccess: (m) => {
      upsertWaMessage(qc, m);
      void qc.invalidateQueries({ queryKey: qk.waLists });
    },
    onError: (err) => {
      // A failed provider send still stored the message (status failed): show it in the thread.
      const m = err instanceof ApiError ? (err.details as { message?: WaMessage } | undefined)?.message : undefined;
      if (m?.id) upsertWaMessage(qc, m);
    },
  });
}

export function useWaMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => api.post<WaConversation>(`/whatsapp/conversations/${contactId}/read`, {}),
    onSuccess: (c) => {
      applyWaConversation(qc, c);
      void qc.invalidateQueries({ queryKey: qk.waLists });
      void qc.invalidateQueries({ queryKey: qk.waUnread });
    },
  });
}

function useWaContactMutation<I>(fn: (contactId: string, input: I) => Promise<WaConversation>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, input }: { contactId: string; input: I }) => fn(contactId, input),
    onSuccess: (c) => {
      applyWaConversation(qc, c);
      void qc.invalidateQueries({ queryKey: qk.waLists });
      void qc.invalidateQueries({ queryKey: qk.waTags });
    },
  });
}

export const useWaAssign = () => useWaContactMutation<string | null>((id, assigneeId) => api.post(`/whatsapp/conversations/${id}/assign`, { assigneeId }));
export const useWaTagsSet = () => useWaContactMutation<string[]>((id, tags) => api.put(`/whatsapp/conversations/${id}/tags`, { tags }));
export const useWaContactPatch = () =>
  useWaContactMutation<{ name?: string | null; optedIn?: boolean; archived?: boolean }>((id, body) => api.patch(`/whatsapp/conversations/${id}`, body));

export function useWaAddNote(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<WaNote>(`/whatsapp/conversations/${contactId}/notes`, { body }),
    onSuccess: (n) => qc.setQueryData<WaConversationDetail>(qk.waConv(contactId), (d) => (d ? { ...d, notes: [n, ...d.notes] } : d)),
  });
}

export function useWaDeleteNote(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.delete(`/whatsapp/notes/${noteId}`),
    onSuccess: (_r, noteId) => qc.setQueryData<WaConversationDetail>(qk.waConv(contactId), (d) => (d ? { ...d, notes: d.notes.filter((n) => n.id !== noteId) } : d)),
  });
}

export function useWaTags(enabled = true) {
  return useQuery({
    queryKey: qk.waTags,
    queryFn: ({ signal }) => api.get<{ items: { tag: string; count: number }[] }>("/whatsapp/tags", undefined, { signal }).then((r) => r.items),
    enabled,
    staleTime: 60_000,
    retry,
  });
}

export function useWaTemplates(enabled = true) {
  return useQuery({
    queryKey: qk.waTemplates,
    queryFn: ({ signal }) => api.get<Paged<WaTemplate>>("/whatsapp/templates", undefined, { signal }).then((r) => r.items),
    enabled,
    staleTime: 5 * 60_000,
    retry,
  });
}

export function useSyncTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Paged<WaTemplate> & { created: number; updated: number; removed: number }>("/whatsapp/templates/sync", {}),
    onSuccess: (r) => qc.setQueryData(qk.waTemplates, r.items),
  });
}

// ================================================================ campaigns

export function useCampaign(id: string, refetchInterval: number | false | ((c: Campaign | undefined) => number | false)) {
  return useQuery({
    queryKey: qk.campaign(id),
    queryFn: ({ signal }) => api.get<Campaign>(`/whatsapp/campaigns/${id}`, undefined, { signal }),
    refetchInterval: typeof refetchInterval === "function" ? (q) => refetchInterval(q.state.data) : refetchInterval,
    retry,
  });
}

export function useRecipients(id: string, status: RecipientStatus | "", refetchInterval: number | false) {
  const size = 100;
  return useInfiniteQuery({
    queryKey: qk.recipients(id, status),
    ...offsetPaging<CampaignRecipient>(size),
    queryFn: ({ pageParam, signal }) =>
      api.get<Paged<CampaignRecipient>>(`/whatsapp/campaigns/${id}/recipients`, { status: status || undefined, limit: size, offset: pageParam }, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval,
    retry,
  });
}

export function useAudienceSources() {
  return useQuery({
    queryKey: qk.audienceSources,
    queryFn: ({ signal }) => api.get<{ items: string[] }>("/whatsapp/campaigns/audience-sources", undefined, { signal }).then((r) => r.items),
    staleTime: 10 * 60_000,
    retry,
  });
}

/** Live audience count: POST /campaigns/preview, debounced by the caller. */
export function useAudiencePreview(body: { audience: AudienceSpec; templateId?: string; mapping?: TemplateMapping } | null) {
  return useQuery({
    queryKey: ["inbox", "wa", "audience-preview", body] as const,
    queryFn: ({ signal }) => api.post<AudiencePreview>("/whatsapp/campaigns/preview", body, { signal }),
    enabled: !!body && body.audience.sources.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

export interface CampaignInput {
  name: string;
  templateId: string;
  mapping: TemplateMapping;
  audience: AudienceSpec;
  scheduleAt: string | null;
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, start }: { input: CampaignInput; start: boolean }) => {
      const c = await api.post<Campaign>("/whatsapp/campaigns", input);
      if (!start) return c;
      return api.post<Campaign>(`/whatsapp/campaigns/${c.id}/start`, { at: input.scheduleAt });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.campaigns }),
  });
}

export function useCampaignAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "cancel" | "delete"): Promise<Campaign | { ok: true }> =>
      action === "delete" ? api.delete<{ ok: true }>(`/whatsapp/campaigns/${id}`) : api.post<Campaign>(`/whatsapp/campaigns/${id}/${action}`, {}),
    onSuccess: (r) => {
      if (r && typeof r === "object" && "id" in r) qc.setQueryData(qk.campaign(id), r);
      void qc.invalidateQueries({ queryKey: qk.campaigns });
    },
  });
}

// ================================================================ support

/** Open (waiting on the shop) and overdue counts for widgets and the overview. */
export function useTicketSummary(enabled = true) {
  return useQuery({
    queryKey: qk.ticketSummary,
    queryFn: ({ signal }) => api.get<TicketList>("/support/tickets", { status: "open", sort: "due", limit: 3 }, { signal }),
    enabled,
    refetchInterval: 60_000,
    retry,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: qk.ticket(id),
    queryFn: ({ signal }) => api.get<TicketThread>(`/support/tickets/${id}`, undefined, { signal }),
    refetchInterval: 30_000,
    retry,
  });
}

function useTicketMutation<I>(id: string, fn: (input: I) => Promise<Ticket | TicketThread | { ticket: Ticket; message: TicketMessage }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.setQueryData<TicketThread>(qk.ticket(id), (d) => {
        if (!d) return d;
        if ("messages" in r) return r;
        if ("message" in r) return { ticket: r.ticket, messages: [...d.messages, r.message] };
        return { ...d, ticket: r };
      });
      void qc.invalidateQueries({ queryKey: qk.ticketSummary });
      void qc.invalidateQueries({ queryKey: [...qk.tickets, "list"] });
    },
  });
}

export const useTicketAssign = (id: string) => useTicketMutation<string | null>(id, (assigneeId) => api.post(`/support/tickets/${id}/assign`, { assigneeId }));
export const useTicketStatus = (id: string) => useTicketMutation<TicketStatus>(id, (status) => api.post(`/support/tickets/${id}/status`, { status }));
export const useTicketPriority = (id: string) => useTicketMutation<TicketPriority>(id, (priority) => api.post(`/support/tickets/${id}/priority`, { priority }));
export const useTicketTags = (id: string) => useTicketMutation<string[]>(id, (tags) => api.put(`/support/tickets/${id}/tags`, { tags }));
export const useTicketReply = (id: string) =>
  useTicketMutation<{ kind: "reply" | "note"; body: string; status?: TicketStatus }>(id, (body) => api.post(`/support/tickets/${id}/messages`, body));
export const useTicketMerge = (id: string) => useTicketMutation<string>(id, (intoId) => api.post(`/support/tickets/${id}/merge`, { intoId }));

export interface NewTicketInput {
  subject: string;
  body: string;
  name?: string;
  phone?: string;
  email?: string;
  priority: TicketPriority;
  channel: string;
  assigneeId?: string | null;
  tags: string[];
  related?: { type: "order" | "invoice"; id: string } | null;
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTicketInput) => api.post<TicketThread>("/support/tickets", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tickets }),
  });
}

/** Ticket search for the merge dialog. */
export function useTicketSearch(q: string, enabled: boolean) {
  return useQuery<Ticket[]>({
    queryKey: ["inbox", "support", "tickets", "search", q] as const,
    queryFn: ({ signal }) => api.get<TicketList>("/support/tickets", { q: q || undefined, limit: 10 }, { signal }).then((r) => r.items),
    enabled,
    placeholderData: keepPreviousData,
    retry,
  });
}

// ================================================================ FAQ

export function useFaqCategories() {
  return useQuery({
    queryKey: qk.faqCategories,
    queryFn: ({ signal }) => api.get<{ items: FaqCategory[] }>("/support/faq/categories", undefined, { signal }).then((r) => r.items),
    retry,
  });
}

export function useFaqArticle(id: string | null) {
  return useQuery({
    queryKey: qk.faqArticle(id ?? ""),
    queryFn: ({ signal }) => api.get<FaqArticle>(`/support/faq/articles/${id}`, undefined, { signal }),
    enabled: !!id,
    retry,
  });
}

export function useFaqCategoryMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: qk.faq });
  return {
    create: useMutation({ mutationFn: (b: { name: string; description?: string | null }) => api.post<FaqCategory>("/support/faq/categories", b), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string | null; sort?: number }) => api.patch<FaqCategory>(`/support/faq/categories/${id}`, b),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/support/faq/categories/${id}`), onSuccess: done }),
  };
}

export interface FaqArticleInput {
  title: string;
  slug?: string | null;
  body: string;
  categoryId?: string | null;
  sort?: number;
  seo?: { title?: string; description?: string } | null;
  status?: "draft" | "published";
}

export function useFaqArticleMutations() {
  const qc = useQueryClient();
  const done = (a?: unknown) => {
    if (a && typeof a === "object" && "id" in a) qc.setQueryData(qk.faqArticle((a as FaqArticle).id), a);
    void qc.invalidateQueries({ queryKey: [...qk.faq, "articles"] });
  };
  return {
    create: useMutation({ mutationFn: (b: FaqArticleInput) => api.post<FaqArticle>("/support/faq/articles", b), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: Partial<FaqArticleInput> & { id: string }) => api.patch<FaqArticle>(`/support/faq/articles/${id}`, b), onSuccess: done }),
    publish: useMutation({
      mutationFn: ({ id, on }: { id: string; on: boolean }) => api.post<FaqArticle>(`/support/faq/articles/${id}/${on ? "publish" : "unpublish"}`, {}),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/support/faq/articles/${id}`), onSuccess: () => done() }),
  };
}
