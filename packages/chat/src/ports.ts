import type { FeatureGatePort } from "@rbms/core";
import type { ConversationType, ParticipantKind } from "./schema";

export type { FeatureGatePort };

export type Unsubscribe = () => void | Promise<void>;

/**
 * Cross-instance fan-out of chat events. The service publishes every event on one channel (`chat.events` by default)
 * and each API process subscribes once, then delivers locally to its open streams. Drivers: `MemoryPubSub` (this
 * package, single process) and Redis pub/sub (apps/api: one publisher connection + one dedicated subscriber connection).
 * Messages are opaque JSON strings. Delivery is best effort (at most once); clients catch up with `Last-Event-ID`.
 */
export interface PubSubPort {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe>;
}

export interface ChatNotification {
  tenantId: string;
  /** Notify template key. */
  template: "chat.message";
  /**
   * `user`: tell `recipientUserId` (push, else WhatsApp template). `shop`: a shopper wrote in a support/order
   * conversation no staff member has joined yet and nobody with `chat.manage` is online — tell the shop's owners.
   */
  audience: "user" | "shop";
  recipientUserId: string | null;
  conversationId: string;
  conversationType: ConversationType;
  conversationTitle: string | null;
  senderId: string;
  senderName: string | null;
  /** First 140 characters of the message, or "[attachment]". */
  preview: string;
}

/**
 * Offline notification (apps/api maps it to notify push / WhatsApp template `chat.message`). Called when a recipient has
 * had no open stream for 60 s, at most once per recipient and conversation per cooldown (10 min). Errors are logged.
 */
export interface NotifierPort {
  notify(n: ChatNotification): Promise<void>;
}

/** Who a user is inside a shop (apps/api: tenancy memberships, store customers, marketplace vendor users). */
export interface DirectoryPort {
  /** The kind of user `userId` is in the shop, or null when unknown (not a member, never shopped there). */
  kindOf(tenantId: string, userId: string): Promise<ParticipantKind | null>;
  /** Display names for user ids; missing ids are simply absent. */
  names?(tenantId: string, userIds: string[]): Promise<Record<string, string>>;
}

/** Implemented with the orders service: the shopper (auth user id) who placed the order, null when unknown. */
export interface OrdersPort {
  customerUserId(tenantId: string, orderId: string): Promise<string | null>;
  /** Short label for titles, e.g. "Order ORD-0042". */
  label?(tenantId: string, orderId: string): Promise<string | null>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
