"use client";

import * as React from "react";
import { LifeBuoyIcon, MegaphoneIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, WebModule, WidgetDef } from "@srirealtime/web";
import { FEATURES, PERMS } from "./lib/access";
import { setInboxLinks, type InboxLinks } from "./lib/config";
import { inboxMessages } from "./lib/messages";
import { NAV_ITEMS } from "./lib/nav";

export { FEATURES as INBOX_FEATURES, PERMS as INBOX_PERMISSIONS };

export interface InboxModuleOptions {
  /** Where the host mounts the module. Default "/inbox" (apps/shop and apps/billing). */
  basePath?: string;
  /** Further restrict features on top of the server ("chat", "whatsapp.*", "support"). */
  features?: string[];
  /** App-absolute links to other modules' screens (order detail, bill detail). */
  links?: Partial<InboxLinks>;
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widgets = () => import("./widgets/inbox");

const WA = { feature: FEATURES.whatsapp, permission: PERMS.whatsapp } as const;
const CAMPAIGNS = { feature: [FEATURES.whatsapp, FEATURES.campaigns], permission: PERMS.whatsapp } as const;
const SUPPORT = { feature: FEATURES.support, permission: PERMS.support } as const;
const FAQ = { feature: [FEATURES.support, FEATURES.faq], permission: PERMS.support } as const;

/**
 * The unified inbox: live chat, WhatsApp inbox + campaigns, support desk + FAQ manager.
 * Mount with createWebApp({ modules: [..., inboxModule({ basePath: "/inbox" })] }).
 */
export function inboxModule(opts: InboxModuleOptions = {}): WebModule {
  setInboxLinks(opts.links);

  const nav: NavSection[] = [{ id: "inbox", title: "inbox.nav.section", items: NAV_ITEMS }];

  const chat = page(() => import("./pages/chat"));
  const whatsapp = page(() => import("./pages/whatsapp"));
  const ticket = page(() => import("./pages/ticket"));
  const faqArticle = page(() => import("./pages/faq-article"));

  // Static segments before ":id" ("campaigns/new" must not read as an id).
  const routes: RouteDef[] = [
    // The overview shows only the sections (and cards) the member may open.
    { path: "", component: page(() => import("./pages/overview")) },
    { path: "chat", component: chat, feature: FEATURES.chat },
    { path: "chat/:id", component: chat, feature: FEATURES.chat, immersive: true },
    { path: "whatsapp", component: whatsapp, ...WA },
    { path: "whatsapp/:id", component: whatsapp, ...WA, immersive: true },
    { path: "campaigns", component: page(() => import("./pages/campaigns")), ...CAMPAIGNS },
    { path: "campaigns/new", component: page(() => import("./pages/campaign-new")), ...CAMPAIGNS, immersive: true },
    { path: "campaigns/:id", component: page(() => import("./pages/campaign-detail")), ...CAMPAIGNS },
    { path: "support", component: page(() => import("./pages/support")), ...SUPPORT },
    { path: "support/new", component: page(() => import("./pages/ticket-new")), ...SUPPORT },
    { path: "support/:id", component: ticket, ...SUPPORT },
    { path: "faq", component: page(() => import("./pages/faq")), ...FAQ },
    { path: "faq/new", component: faqArticle, ...FAQ },
    { path: "faq/:id", component: faqArticle, ...FAQ },
  ];

  const widgetDefs: WidgetDef[] = [
    // Chat and/or WhatsApp: the kit's `feature` is all-of, so the card checks each source itself and hides when neither is on.
    { id: "inbox-unread", zone: "attention", priority: 30, component: React.lazy(() => widgets().then((m) => ({ default: m.UnreadAttentionWidget }))) },
    { id: "inbox-tickets", zone: "attention", priority: 25, ...SUPPORT, component: React.lazy(() => widgets().then((m) => ({ default: m.TicketsAttentionWidget }))) },
  ];

  const actions: QuickAction[] = [
    { id: "new-ticket", label: "inbox.ticket.new", href: "support/new", icon: LifeBuoyIcon, ...SUPPORT },
    { id: "new-campaign", label: "inbox.campaign.new", href: "campaigns/new", icon: MegaphoneIcon, ...CAMPAIGNS },
  ];

  return {
    id: "inbox",
    basePath: opts.basePath ?? "/inbox",
    features: opts.features,
    messages: inboxMessages,
    nav,
    routes,
    widgets: widgetDefs,
    actions,
  };
}
