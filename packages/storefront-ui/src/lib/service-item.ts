/*
 * Services in the store (pure, no React): items the shop does for the customer (a haircut, a repair) rather than
 * ships. The catalogue marks them `kind: "service"` (a bookable appointment service, a service unit or a SAC code) and
 * says whether they can be booked online. The store then shows "Book now" (→ /book?service=<id>) or "Enquire on
 * WhatsApp" instead of the cart, stock, PIN-code and shipping blocks.
 */

import type { ServiceInfo } from "../types";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

export interface ItemKindish {
  kind?: "product" | "service" | null;
  service?: ServiceInfo | null;
}

export const isService = (p: ItemKindish | null | undefined): boolean => p?.kind === "service";

/** The booking page with this service ticked (the wizard reads `?service=`). */
export const bookHref = (serviceId: string | null | undefined): string => (serviceId ? `/book?service=${encodeURIComponent(serviceId)}` : "/book");

/** wa.me link for a WhatsApp number (10-digit Indian numbers get +91), or the link itself when it already is one. */
export function whatsappHref(number: string, text: string): string | null {
  const v = number.trim();
  if (!v) return null;
  if (/^https?:/i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(text)}`;
}

export type ServiceAction = { kind: "book"; href: string } | { kind: "enquire"; href: string; external: boolean };

/**
 * What a service's main button does: book online when it can be booked; otherwise enquire on WhatsApp (the shop's
 * WhatsApp number, else its phone), or call / the contact page when there is neither.
 */
export function serviceAction(p: ItemKindish & { name: string }, contact: { whatsapp?: string | null; phone?: string | null }, t: T): ServiceAction {
  if (p.service?.bookable && p.service.serviceId) return { kind: "book", href: bookHref(p.service.serviceId) };
  const text = t("service.enquireText", { name: p.name });
  const wa = whatsappHref(contact.whatsapp ?? "", text) ?? whatsappHref(contact.phone ?? "", text);
  if (wa) return { kind: "enquire", href: wa, external: true };
  const tel = (contact.phone ?? "").replace(/[^\d+]/g, "");
  return tel ? { kind: "enquire", href: `tel:${tel}`, external: true } : { kind: "enquire", href: "/contact", external: false };
}

/** "45 min", "1 hr", "1 hr 30 min". */
export function durationLabel(min: number | null | undefined, t: T): string | null {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return t("service.min", { min: m });
  return m ? t("service.hrMin", { h, min: m }) : t("service.hr", { h });
}

export type ListKind = "products" | "services" | "items";

/** What a list holds: only services → "services", some → "items", none → "products". */
export function listKind(items: readonly ItemKindish[]): ListKind {
  const services = items.filter(isService).length;
  if (!services) return "products";
  return services === items.length ? "services" : "items";
}

/** "12 products" / "8 services" / "20 items". */
export function countLabel(count: number, kind: ListKind, t: T): string {
  return t(kind === "services" ? "list.countServices" : kind === "items" ? "list.countItems" : "list.count", { count });
}

/** Category id → what its items are, from a sample of summaries (categories with no sampled item are left out). */
export function categoryKinds(items: readonly (ItemKindish & { categoryId: string | null })[]): Map<string, ListKind> {
  const by = new Map<string, ItemKindish[]>();
  for (const p of items) if (p.categoryId) by.set(p.categoryId, [...(by.get(p.categoryId) ?? []), p]);
  return new Map([...by].map(([id, list]) => [id, listKind(list)]));
}
