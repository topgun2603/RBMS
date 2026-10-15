/**
 * Host options the screens need (set by inboxModule()). Links to other modules are app-absolute, because a UI module
 * never imports another one and doesn't know where the host mounted it.
 */
export interface InboxLinks {
  /** Order detail (orders-ui). Default `/orders/<id>` (apps/shop mounts orders at "/"). */
  order: (id: string) => string;
  /** Bill detail (billing-ui). Default `/invoices/<id>` (apps/billing); apps/shop passes `/billing/invoices/<id>`. */
  invoice: (id: string) => string;
}

export const DEFAULT_LINKS: InboxLinks = {
  order: (id) => `/orders/${id}`,
  invoice: (id) => `/invoices/${id}`,
};

let links: InboxLinks = DEFAULT_LINKS;

export function setInboxLinks(next: Partial<InboxLinks> | undefined) {
  links = { ...DEFAULT_LINKS, ...(next ?? {}) };
}

export const inboxLinks = () => links;
