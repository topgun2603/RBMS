import { badRequest, forbidden, hasPermission, isSuperAdmin, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import { z } from "zod";
import { CHAT_PERMISSION_KEYS } from "./features";
import type { ChatAttachment, ConversationRow, ConversationType, MessageRow, ParticipantKind } from "./schema";

export const BODY_MAX = 4000;
export const ATTACHMENTS_MAX = 10;
export const EDIT_WINDOW_MS = 15 * 60_000;
export const PREVIEW_MAX = 140;
export const SEND_RATE = { limit: 20, windowMs: 60_000 } as const;

/** Conversations between a shopper and the shop: every staff member with `chat.manage` may see and answer them. */
export const SHOP_FACING_TYPES: readonly ConversationType[] = ["support", "order"];
export const isShopFacing = (type: ConversationType) => SHOP_FACING_TYPES.includes(type);

const STAFF_ROLES = ["owner", "admin", "staff"];

/** The signed-in user as chat sees them. */
export interface Viewer {
  tenantId: string;
  userId: string;
  /** A member of the shop (owner/admin/staff) or a super-admin; everyone else is a shopper. */
  isStaff: boolean;
  /** Staff holding `chat.manage` (owners, admins and super-admins always do). */
  canManage: boolean;
}

export function viewerFromContext(ctx: RequestContext): Viewer {
  const user = requireUser(ctx);
  const tenant = requireTenant(ctx);
  const isStaff = isSuperAdmin(ctx) || user.tenantRoles.some((r) => STAFF_ROLES.includes(r));
  return { tenantId: tenant.id, userId: user.id, isStaff, canManage: isStaff && hasPermission(ctx, CHAT_PERMISSION_KEYS.manage) };
}

export const viewerKind = (v: Viewer): ParticipantKind => (v.isStaff ? "staff" : "shopper");

// ------------------------------------------------------------------ access

export type Access = "participant" | "manager" | null;

/**
 * Participants always have access. Staff with `chat.manage` also see every shop-facing (support/order) conversation
 * as "manager" (they join it when they reply or mark it read). Nobody else does — shoppers only see their own.
 */
export function accessTo(conv: { type: ConversationType }, participantIds: readonly string[], viewer: Viewer): Access {
  if (participantIds.includes(viewer.userId)) return "participant";
  if (viewer.isStaff && viewer.canManage && isShopFacing(conv.type)) return "manager";
  return null;
}

/**
 * Who may open which kind of conversation. Shoppers only with the shop (`support`, or `order` about their own order);
 * staff open `order`, `direct` and `group` conversations with staff or vendors (never a direct line to a shopper —
 * shopper conversations are shop-facing so the whole team can answer).
 */
export function assertCanCreate(viewer: Viewer, type: ConversationType, targetKinds: readonly (ParticipantKind | null)[] = []) {
  if (!viewer.isStaff) {
    if (type !== "support" && type !== "order") throw forbidden("Shoppers can only chat with the shop");
    return;
  }
  if (type === "support") throw badRequest("Support conversations are opened by shoppers");
  if (type === "direct" || type === "group") {
    if (targetKinds.some((k) => k === null)) throw badRequest("Unknown user");
    if (targetKinds.some((k) => k === "shopper")) throw forbidden("Talk to shoppers in a support or order conversation");
  }
}

export interface ChatMessageLike {
  senderId: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export function canEdit(msg: ChatMessageLike, viewer: Viewer, now: Date, windowMs = EDIT_WINDOW_MS): boolean {
  return msg.senderId === viewer.userId && !msg.deletedAt && now.getTime() - msg.createdAt.getTime() <= windowMs;
}

/** Own messages any time; staff with `chat.manage` may also remove messages in shop-facing conversations. */
export function canDelete(msg: ChatMessageLike, conv: { type: ConversationType }, viewer: Viewer): boolean {
  if (msg.deletedAt) return false;
  if (msg.senderId === viewer.userId) return true;
  return viewer.isStaff && viewer.canManage && isShopFacing(conv.type);
}

// ------------------------------------------------------------------ unread

/** Messages after `lastReadAt` (all of them when null), not sent by `userId`, not deleted. */
export function unreadCount(messages: readonly ChatMessageLike[], userId: string, lastReadAt: Date | null): number {
  const since = lastReadAt?.getTime() ?? -Infinity;
  return messages.filter((m) => m.senderId !== userId && !m.deletedAt && m.createdAt.getTime() > since).length;
}

/**
 * For a manager who hasn't joined a shop-facing conversation: live messages (not by `userId`) after the last message
 * from a staff participant — how many are waiting for a reply.
 */
export function awaitingReplyCount(messages: readonly ChatMessageLike[], userId: string, staffIds: ReadonlySet<string>): number {
  const lastStaff = Math.max(-Infinity, ...messages.filter((m) => staffIds.has(m.senderId)).map((m) => m.createdAt.getTime()));
  return messages.filter((m) => m.senderId !== userId && !m.deletedAt && m.createdAt.getTime() > lastStaff).length;
}

// ------------------------------------------------------------------ cursors

export interface Cursor {
  at: Date;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/** `<ms>_<message id>`: the message order key, used for `before=` pages and as the SSE event id. */
export const encodeCursor = (m: { createdAt: Date; id: string }) => `${m.createdAt.getTime()}_${m.id}`;

export function decodeCursor(s: string | null | undefined): Cursor | null {
  if (!s) return null;
  const m = /^(\d{1,15})_([0-9a-fA-F-]{36})$/.exec(s.trim());
  if (!m || !isUuid(m[2]!)) return null;
  const at = new Date(Number(m[1]));
  return Number.isNaN(at.getTime()) ? null : { at, id: m[2]!.toLowerCase() };
}

/** Strict "comes before" in (created_at, id) order. */
export const isBefore = (m: { createdAt: Date; id: string }, c: Cursor) =>
  m.createdAt.getTime() < c.at.getTime() || (m.createdAt.getTime() === c.at.getTime() && m.id < c.id);

/**
 * Turns rows fetched newest-first with `limit + 1` into a page shown oldest-first, with the cursor for the next older
 * page (null when this is the oldest page).
 */
export function pageOf<T extends { createdAt: Date; id: string }>(rowsNewestFirst: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  const hasMore = rowsNewestFirst.length > limit;
  const kept = rowsNewestFirst.slice(0, limit);
  const oldest = kept[kept.length - 1];
  return { rows: kept.reverse(), nextCursor: hasMore && oldest ? encodeCursor(oldest) : null };
}

// ------------------------------------------------------------------ inputs

/** http(s) URLs, or site-relative paths ("/uploads/x.jpg"; not protocol-relative "//host"). */
export function isAllowedUrl(url: string): boolean {
  if (!url || url.length > 2000 || /[\s<>"]/.test(url)) return false;
  if (url.startsWith("/")) return !url.startsWith("//") && !url.startsWith("/\\");
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

export const attachmentSchema = z.object({
  url: z.string().trim().refine(isAllowedUrl, "Attachments must be http(s) or site-relative URLs"),
  type: z.enum(["image", "file"]).default("file"),
  name: z.string().trim().max(200).optional(),
  mime: z.string().trim().max(100).optional(),
  size: z.number().int().nonnegative().optional(),
});

const bodySchema = z.string().max(BODY_MAX * 2).transform((s) => s.trim());

export const messageInputSchema = z
  .object({
    body: bodySchema.default(""),
    attachments: z.array(attachmentSchema).max(ATTACHMENTS_MAX).default([]),
    replyTo: z.string().uuid().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.body.length > BODY_MAX) ctx.addIssue({ code: "custom", path: ["body"], message: `At most ${BODY_MAX} characters` });
    if (!v.body && v.attachments.length === 0) ctx.addIssue({ code: "custom", path: ["body"], message: "Write a message or attach a file" });
  });
export type MessageInput = z.input<typeof messageInputSchema>;

export const editInputSchema = z.object({
  body: bodySchema.refine((s) => s.length <= BODY_MAX, `At most ${BODY_MAX} characters`),
});
export type EditInput = z.input<typeof editInputSchema>;

export const createConversationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("support"), title: z.string().trim().max(120).optional() }),
  z.object({ type: z.literal("order"), orderId: z.string().uuid() }),
  z.object({ type: z.literal("direct"), userId: z.string().uuid() }),
  z.object({
    type: z.literal("group"),
    title: z.string().trim().min(1).max(120),
    userIds: z.array(z.string().uuid()).min(1).max(50),
  }),
]);
export type CreateConversationInput = z.input<typeof createConversationSchema>;

export const listConversationsQuerySchema = z.object({
  type: z.enum(["direct", "support", "order", "group"]).optional(),
  /** `mine` = only conversations I'm in (managers otherwise also get every shop-facing one). */
  scope: z.enum(["all", "mine"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListConversationsQuery = z.input<typeof listConversationsQuerySchema>;

export const listMessagesQuerySchema = z.object({
  /** A cursor (`nextCursor` of the previous page) or a message id. */
  before: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.input<typeof listMessagesQuerySchema>;

export const readInputSchema = z.object({ messageId: z.string().uuid().optional() });
export const muteInputSchema = z.object({ muted: z.boolean() });

// ------------------------------------------------------------------ views

export function previewOf(body: string, attachments: readonly ChatAttachment[]): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
  if (attachments.some((a) => a.type === "image")) return "[photo]";
  return attachments.length ? "[attachment]" : "";
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments: ChatAttachment[];
  replyTo: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Order key; pass as `before=` or compare with SSE ids. */
  cursor: string;
}

/** Deleted messages become tombstones (no body or attachments). */
export function toMessage(r: MessageRow): ChatMessage {
  const deleted = !!r.deletedAt;
  return {
    id: r.id,
    conversationId: r.conversationId,
    senderId: r.senderId,
    body: deleted ? "" : r.body,
    attachments: deleted ? [] : (r.attachments ?? []),
    replyTo: r.replyTo,
    editedAt: r.editedAt?.toISOString() ?? null,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    cursor: encodeCursor(r),
  };
}

export interface ChatParticipant {
  userId: string;
  kind: ParticipantKind;
  name: string | null;
  lastReadAt: string | null;
  joinedAt: string;
}

export interface ChatConversation {
  id: string;
  type: ConversationType;
  subjectType: string | null;
  subjectId: string | null;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdBy: string;
  createdAt: string;
  /** Am I a participant (false for managers looking at a support conversation they haven't joined). */
  joined: boolean;
  muted: boolean;
  lastReadAt: string | null;
  unread: number;
  participants: ChatParticipant[];
}

export function toConversation(
  r: ConversationRow,
  me: { joined: boolean; muted: boolean; lastReadAt: Date | null; unread: number },
  participants: ChatParticipant[],
): ChatConversation {
  return {
    id: r.id,
    type: r.type,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    title: r.title,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: r.lastMessagePreview,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    joined: me.joined,
    muted: me.muted,
    lastReadAt: me.lastReadAt?.toISOString() ?? null,
    unread: me.unread,
    participants,
  };
}
