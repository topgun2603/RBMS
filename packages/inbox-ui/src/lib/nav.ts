import { BookOpenIcon, LifeBuoyIcon, MegaphoneIcon, MessageCircleIcon, MessageSquareTextIcon } from "lucide-react";
import type { NavItem } from "@srirealtime/web";
import { FEATURES, PERMS } from "./access";

/** The "Inbox" nav section items (also the overview tiles). Features are all-of; permissions any-of. */
export const NAV_ITEMS: NavItem[] = [
  { href: "chat", label: "inbox.nav.chat", icon: MessageCircleIcon, feature: FEATURES.chat, exact: false },
  { href: "whatsapp", label: "inbox.nav.whatsapp", icon: MessageSquareTextIcon, feature: FEATURES.whatsapp, permission: PERMS.whatsapp, exact: false },
  { href: "campaigns", label: "inbox.nav.campaigns", icon: MegaphoneIcon, feature: [FEATURES.whatsapp, FEATURES.campaigns], permission: PERMS.whatsapp, exact: false },
  { href: "support", label: "inbox.nav.support", icon: LifeBuoyIcon, feature: FEATURES.support, permission: PERMS.support, exact: false },
  { href: "faq", label: "inbox.nav.faq", icon: BookOpenIcon, feature: [FEATURES.support, FEATURES.faq], permission: PERMS.support, exact: false },
];
