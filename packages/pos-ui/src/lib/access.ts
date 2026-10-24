/** Feature keys the counter uses (docs/features.md). Unknown keys count as off, so optional parts simply hide. */
export const POS_FEATURES = {
  /** The counter itself (GST bills). */
  invoices: "invoices",
  whatsapp: "invoices.whatsapp",
  /** Credit tender (leave the rest on the customer's account). */
  creditBook: "invoices.credit-book",
  /** "Whole shop today" X report (payments report). */
  reports: "invoices.reports",
  /** Product search, categories, barcode lookup. Off → billing items. */
  catalogue: "catalogue",
  /** Stock badges on lines. */
  inventory: "inventory",
  loyalty: "loyalty",
  branches: "multi-branch",
  /** Paired terminals + PIN unlock (docs/pos-terminals.md). */
  terminals: "pos.terminals",
  /** Weighing station + weigh tickets (depends on scales). */
  weighing: "pos.weighing",
} as const;

/** Permission keys (packages/invoices; owners and admins hold all). */
export const POS_PERMISSIONS = {
  /** Open the counter. */
  create: "invoices.create",
  /** Line discounts. */
  discount: "invoices.discount",
  /** Changing a line's price is a discount in effect: same key. */
  price: "invoices.discount",
  /** Cancel a whole bill (a return before anything was credited). */
  cancel: "invoices.cancel",
  /** Returns as credit notes (partial or full) with refunds. */
  creditNote: "invoices.credit-note",
  /** Open / close the till, cash in / out. */
  till: "pos.till",
  /** Manage terminals, pairing codes and staff PINs. */
  devices: "pos.devices",
  /** Use a weighing station. */
  weigh: "pos.weigh",
} as const;
