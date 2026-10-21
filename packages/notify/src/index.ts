import { defineModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { ConsoleDriver } from "./drivers/console";
import { FcmDriver } from "./drivers/fcm";
import { Msg91Driver } from "./drivers/msg91";
import { ResendDriver } from "./drivers/resend";
import { WhatsAppDriver } from "./drivers/whatsapp";
import { notifyRoutes } from "./routes";
import { notifyLog, notifyTemplates, pushTokens } from "./schema";
import { NotifyService } from "./service";
import type { Channel, ChannelDriver, ContactLookup, LoggerPort, NotifyConfig, QueuePort } from "./types";

export interface NotifyDeps {
  db: Db;
  config: NotifyConfig;
  /** When given, non-OTP messages are delivered by the "notify.deliver" job (3 attempts). */
  queue?: QueuePort;
  log?: LoggerPort;
  /** Resolves phone/email/locale for sendToUser. */
  contacts?: ContactLookup;
  /** Override drivers per channel (tests, custom providers). */
  drivers?: Partial<Record<Channel, ChannelDriver>>;
}

/** Real drivers for configured providers; the console driver for any channel without credentials. */
export function buildDrivers(deps: Pick<NotifyDeps, "config" | "log" | "drivers">): Record<Channel, ChannelDriver> {
  const { config, log } = deps;
  const o = deps.drivers ?? {};
  return {
    sms: o.sms ?? (config.msg91 ? new Msg91Driver(config.msg91) : new ConsoleDriver("sms", log)),
    email: o.email ?? (config.resend ? new ResendDriver(config.resend) : new ConsoleDriver("email", log)),
    whatsapp: o.whatsapp ?? (config.whatsapp ? new WhatsAppDriver(config.whatsapp) : new ConsoleDriver("whatsapp", log)),
    push: o.push ?? (config.fcm ? new FcmDriver(config.fcm) : new ConsoleDriver("push", log)),
  };
}

export function createNotify(deps: NotifyDeps) {
  const service = new NotifyService({
    db: deps.db,
    config: deps.config,
    drivers: buildDrivers(deps),
    queue: deps.queue,
    log: deps.log,
    contacts: deps.contacts,
  });
  const module = defineModule({
    id: "notify",
    tables: { notifyTemplates, notifyLog, pushTokens },
    routes: notifyRoutes(service),
  });
  return { service, module };
}

export * from "./schema";
export * from "./types";
export { NotifyService, DELIVER_JOB, validateAttachments } from "./service";
export type {
  DeliverJob,
  OtpInput,
  PreviewInput,
  SendInput,
  SendResult,
  SendToUserInput,
  SendToUserResult,
  UpsertTemplateInput,
} from "./service";
export { render, maskTarget, escapeHtml, placeholders } from "./render";
export { composeMessage } from "./compose";
export { BUILTIN_TEMPLATES, BATCH3_TEMPLATE_KEYS, BATCH5_TEMPLATE_KEYS, pickTemplate, baseLocale, type TemplateContent, type TemplateSource } from "./templates";
export { notifyRoutes } from "./routes";
export { ConsoleDriver } from "./drivers/console";
export { FcmDriver, isUnregisteredTokenError } from "./drivers/fcm";
export { Msg91Driver } from "./drivers/msg91";
export { ResendDriver } from "./drivers/resend";
export { WhatsAppDriver } from "./drivers/whatsapp";
export { CUSTOMER_TEMPLATES, CUSTOMER_TEMPLATE_KEYS } from "./customer-templates";
export {
  CustomerMessages,
  CUSTOMER_EVENTS,
  CUSTOMER_EVENT_GROUPS,
  CUSTOMER_EVENT_KEYS,
  CUSTOMER_TEXT,
  MESSAGE_CHANNEL_MODES,
  MESSAGE_LANGUAGES,
  MESSAGES_SETTINGS_DEFAULTS,
  MESSAGES_SETTINGS_SCHEMA,
  QUIET_HOURS,
  customerEvent,
  dedupeKey,
  formatMessageDate,
  formatMessageTime,
  isCustomerEvent,
  messageLocale,
  moneyText,
  planChannels,
  quietUntil,
  resolveMessagesSettings,
  sampleVars,
  toIndianE164,
  type CustomerEventDef,
  type CustomerEventGroup,
  type CustomerEventKey,
  type CustomerMessage,
  type CustomerMessagesDeps,
  type CustomerSendResult,
  type CustomerVars,
  type DedupePort,
  type EventSetting,
  type MessageChannelMode,
  type MessageLocale,
  type MessagesSettings,
  type OptOutPort,
  type SkipReason,
} from "./customer";
