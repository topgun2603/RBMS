import { defineModule } from "@srirealtime/core";
import { CHAT_FEATURES, CHAT_PERMISSIONS } from "./features";
import { chatRoutes, type ChatRouteOptions } from "./routes";
import { chatConversations, chatMessages, chatParticipants } from "./schema";
import { ChatService, type ChatDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./features";
export * from "./service";
export * from "./sse";
export * from "./pubsub";
export * from "./presence";
export * from "./rate-limit";
export * from "./stream-token";
export { ChatHub, StreamConnection, DEFAULT_CHANNEL, type ChatEnvelope, type ChatEventName } from "./hub";
export { chatRoutes, type ChatRouteOptions, type ChatRouteService } from "./routes";

/**
 * Real-time chat at `/v1/chat` (docs/batch3.md §A2): support/order/direct/group conversations, SSE stream with
 * replay, read receipts, typing, offline notifications. `module.start` subscribes to the pub/sub channel.
 */
export function createChat(deps: ChatDeps & { routes?: ChatRouteOptions }) {
  const service = new ChatService(deps);
  const module = defineModule({
    id: "chat",
    tables: { chatConversations, chatParticipants, chatMessages },
    routes: chatRoutes(service, deps.routes),
    features: CHAT_FEATURES,
    permissions: CHAT_PERMISSIONS,
    start: () => service.start(),
    stop: () => service.stop(),
  });
  return { service, module };
}
