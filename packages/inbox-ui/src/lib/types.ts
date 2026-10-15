/** API shapes used by the inbox UI (docs/batch3.md §A2, §A3, §B1). Dates arrive as ISO strings. */

export type ISODate = string;

export interface Paged<T> {
  items: T[];
  total: number;
}

// ------------------------------------------------------------------ chat (/v1/chat)

export const CONVERSATION_TYPES = ["direct", "support", "order", "group"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export interface ChatAttachment {
  url: string;
  type: "image" | "file";
  name?: string;
  mime?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments: ChatAttachment[];
  replyTo: string | null;
  editedAt: ISODate | null;
  deletedAt: ISODate | null;
  createdAt: ISODate;
  cursor: string;
}

export interface ChatParticipant {
  userId: string;
  kind: "staff" | "shopper" | "vendor";
  name: string | null;
  lastReadAt: ISODate | null;
  joinedAt: ISODate;
}

export interface ChatConversation {
  id: string;
  type: ConversationType;
  subjectType: string | null;
  subjectId: string | null;
  title: string | null;
  lastMessageAt: ISODate | null;
  lastMessagePreview: string | null;
  createdBy: string;
  createdAt: ISODate;
  joined: boolean;
  muted: boolean;
  lastReadAt: ISODate | null;
  unread: number;
  participants: ChatParticipant[];
}

export interface ConversationList extends Paged<ChatConversation> {
  unreadTotal: number;
}

export interface MessagePage {
  items: ChatMessage[];
  nextCursor: string | null;
}

/** SSE payloads of /v1/chat/stream. */
export type ChatStreamEvent =
  | { type: "message"; data: { conversationId: string; message: ChatMessage } }
  | { type: "read"; data: { conversationId: string; userId: string; readAt: ISODate } }
  | { type: "typing"; data: { conversationId: string; userId: string; at: ISODate } }
  | { type: "conversation"; data: { conversation?: ChatConversation; conversationId?: string; joined?: { userId: string; kind: string } } };

// ------------------------------------------------------------------ whatsapp (/v1/whatsapp)

export interface WaConversation {
  id: string;
  phone: string;
  displayPhone: string;
  name: string | null;
  optedIn: boolean;
  optedOutAt: ISODate | null;
  tags: string[];
  unreadCount: number;
  assigneeId: string | null;
  archived: boolean;
  lastInboundAt: ISODate | null;
  lastMessageAt: ISODate | null;
  lastMessagePreview: string | null;
  window: { open: boolean; expiresAt: ISODate | null };
}

export interface WaNote {
  id: string;
  contactId: string;
  authorId: string | null;
  body: string;
  createdAt: ISODate;
}

export interface WaConversationDetail extends WaConversation {
  notes: WaNote[];
}

export type WaMessageStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "received";

export interface WaMessage {
  id: string;
  contactId: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  media: { link?: string | null; mime_type?: string; filename?: string | null; caption?: string; id?: string } | null;
  templateName: string | null;
  templateLanguage: string | null;
  templateParams: Record<string, string> | null;
  status: WaMessageStatus;
  providerId: string | null;
  replyTo: string | null;
  error: string | null;
  campaignId: string | null;
  sentBy: string | null;
  statusAt: ISODate | null;
  createdAt: ISODate;
}

export interface WaConversationList extends Paged<WaConversation> {
  unreadTotal: number;
}

export interface WaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string }[];
}

export interface TemplateSlot {
  slot: string;
  component: "header" | "body" | "button";
  key: string;
  buttonIndex?: number;
  buttonType?: string;
}

export type ParamSource =
  | { from: "name"; fallback?: string }
  | { from: "phone" }
  | { from: "var"; key: string; fallback?: string }
  | { from: "text"; value: string };

export interface HeaderMedia {
  type: "image" | "document" | "video";
  link: string;
  filename?: string;
}

export interface TemplateMapping {
  params: Record<string, ParamSource>;
  headerMedia?: HeaderMedia;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  parameterFormat: string | null;
  components: WaTemplateComponent[];
  slots: TemplateSlot[];
  headerMediaType: HeaderMedia["type"] | null;
  mapping: TemplateMapping;
}

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "running", "completed", "cancelled", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignCounts {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export type AudienceSource =
  | { kind: "wa_contacts"; tags?: string[]; match?: "any" | "all" }
  | { kind: "dues"; minDue: number }
  | { kind: "recent_orders"; days: number }
  | { kind: "loyalty_tier"; tiers: string[] }
  | { kind: "customers" }
  | { kind: "phones"; items: { phone: string; name?: string; variables?: Record<string, string> }[] };

export type AudienceKind = AudienceSource["kind"];
export const AUDIENCE_KINDS: AudienceKind[] = ["wa_contacts", "phones", "dues", "recent_orders", "loyalty_tier", "customers"];

export interface AudienceSpec {
  sources: AudienceSource[];
  excludeTags?: string[];
}

export interface AudiencePreview {
  total: number;
  invalid: number;
  duplicates: number;
  optedOut: number;
  excluded: number;
  sendable: number;
  minutes: number;
  ratePerMinute: number;
  sample: { phone: string; name: string | null; text: string | null; missing: string[] }[];
}

export interface Campaign {
  id: string;
  name: string;
  templateId: string;
  mapping: TemplateMapping;
  audience: AudienceSpec;
  scheduleAt: ISODate | null;
  status: CampaignStatus;
  counts: CampaignCounts;
  ratePerMinute: number | null;
  error: string | null;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  cancelledAt: ISODate | null;
  createdAt: ISODate;
  template?: { id: string; name: string; language: string; status: string };
}

export const RECIPIENT_STATUSES = ["pending", "sent", "delivered", "read", "failed", "skipped", "cancelled"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export interface CampaignRecipient {
  id: string;
  phone: string;
  name: string | null;
  status: RecipientStatus;
  error: string | null;
  sentAt: ISODate | null;
}

/** SSE payloads of /v1/whatsapp/stream (event name `wa.<type>`). */
export type WaStreamEvent =
  | { type: "message"; contactId: string; message: WaMessage }
  | { type: "status"; contactId: string; messageId: string; status: WaMessageStatus; error: string | null }
  | { type: "conversation"; contactId: string; conversation: WaConversation }
  | { type: "campaign"; campaignId: string; status: CampaignStatus; counts: CampaignCounts };

// ------------------------------------------------------------------ support (/v1/support)

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_CHANNELS = ["web", "email", "whatsapp", "chat", "phone"] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  requester: { userId: string | null; name: string | null; phone: string | null; email: string | null };
  assigneeId: string | null;
  tags: string[];
  related: { type: "order" | "invoice"; id: string } | null;
  firstResponseAt: ISODate | null;
  resolvedAt: ISODate | null;
  closedAt: ISODate | null;
  slaDueAt: ISODate | null;
  overdue: boolean;
  slaBreached: boolean;
  mergedIntoId: string | null;
  lastMessageAt: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorKind: "requester" | "staff" | "system";
  kind: "reply" | "note";
  body: string;
  attachments: string[];
  createdAt: ISODate;
}

export interface TicketList extends Paged<Ticket> {
  counts: Record<TicketStatus, number>;
  overdue: number;
}

export interface TicketThread {
  ticket: Ticket;
  messages: TicketMessage[];
}

export interface TicketFilters {
  status?: TicketStatus | "";
  priority?: TicketPriority | "";
  assignee?: "me" | "none" | string;
  tag?: string;
  overdue?: boolean;
  q?: string;
  sort?: "recent" | "oldest" | "due";
}

export interface FaqCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort: number;
}

export interface FaqArticle {
  id: string;
  categoryId: string | null;
  slug: string;
  title: string;
  body: string;
  status: "draft" | "published";
  helpfulYes: number;
  helpfulNo: number;
  sort: number;
  seo: { title?: string; description?: string; noindex?: boolean } | null;
  publishedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ------------------------------------------------------------------ others

export interface StaffMember {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface OrderLite {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  total: number;
  customer: { name?: string | null; phone?: string | null } | null;
  lines?: unknown[];
  placedAt: ISODate;
}

export interface UploadSignResponse {
  fileId: string;
  key: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresIn: number };
}

export interface UploadedFile {
  id: string;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  contentType: string;
}
