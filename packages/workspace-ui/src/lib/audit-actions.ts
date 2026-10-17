/**
 * Human-readable audit actions. The audit hook records either an explicit action ("staff.role.update",
 * "invoice.cancel") or a derived one: `<moduleId>.<method> <routePattern>` ("invoices.post /:id([0-9a-f-]{36})/cancel").
 * `describeAction` maps both to a message id; anything unknown falls back to "<verb> in <module>".
 */

/** Message ids under `workspace.audit.actions.*`, keyed by the normalised action. */
const KNOWN: Record<string, string> = {
  // bills
  "invoices.post /": "invoiceCreate",
  "invoices.patch /:": "invoiceEdit",
  "invoices.delete /:": "invoiceDelete",
  "invoices.post /:/issue": "invoiceIssue",
  "invoices.post /:/cancel": "invoiceCancel",
  "invoice.cancel": "invoiceCancel",
  "invoices.post /:/payments": "paymentAdd",
  "invoices.delete /:/payments/:": "paymentRemove",
  "invoices.post /:/share": "invoiceShare",
  "invoices.post /:/send": "invoiceSend",
  // customers + credit book
  "invoices.post /customers": "customerCreate",
  "invoices.patch /customers/:": "customerEdit",
  "invoices.delete /customers/:": "customerDelete",
  "invoices.post /customers/:/receipts": "receiptAdd",
  "invoices.delete /customers/:/receipts/:": "receiptRemove",
  "invoices.post /customers/:/remind": "reminderSend",
  "invoices.post /customers/:/statement/share": "statementShare",
  // saved items
  "invoices.post /items": "itemCreate",
  "invoices.patch /items/:": "itemEdit",
  "invoices.delete /items/:": "itemDelete",
  // catalogue
  "catalog.post /products": "productCreate",
  "catalog.patch /products/:": "productEdit",
  "catalog.delete /products/:": "productDelete",
  "catalog.post /categories": "categoryCreate",
  "catalog.patch /categories/:": "categoryEdit",
  "catalog.delete /categories/:": "categoryDelete",
  // stock + purchases
  "inventory.post /adjust": "stockAdjust",
  "inventory.post /transfer": "stockTransfer",
  "inventory.adjust": "stockAdjust",
  "inventory.post /purchases": "purchaseCreate",
  "inventory.post /purchases/:/cancel": "purchaseCancel",
  "inventory.post /purchases/:/paid": "purchasePaid",
  "inventory.post /suppliers": "supplierCreate",
  "inventory.patch /suppliers/:": "supplierEdit",
  "inventory.delete /suppliers/:": "supplierDelete",
  // orders + coupons
  "orders.post /:/cancel": "orderCancel",
  "orders.post /:/status": "orderStatus",
  "orders.post /:/refunds": "orderRefund",
  "coupons.post /": "couponCreate",
  "coupons.patch /:": "couponEdit",
  "coupons.delete /:": "couponDelete",
  // expenses
  "expenses.post /": "expenseCreate",
  "expenses.patch /:": "expenseEdit",
  "expenses.delete /:": "expenseCancel",
  // team
  "staff.member.invite": "memberInvite",
  "staff.member.update": "memberUpdate",
  "staff.member.remove": "memberRemove",
  "staff.role.create": "roleCreate",
  "staff.role.update": "roleUpdate",
  "staff.role.delete": "roleDelete",
  "staff.post /invites": "memberInvite",
  "staff.patch /members/:": "memberUpdate",
  "staff.delete /members/:": "memberRemove",
  "staff.post /roles": "roleCreate",
  "staff.patch /roles/:": "roleUpdate",
  "staff.delete /roles/:": "roleDelete",
  // import, settings, features, payments
  "import.post /:/commit": "importRun",
  "features.put /toggles/:": "featureToggle",
  "payments.put /account": "paymentAccount",
  "payments.delete /account": "paymentAccountRemove",
  "settings.put /:/tenant": "settingsSave",
  "branding.put /": "brandingSave",
  "onboarding.post /:/skip": "setupSkip",
  "onboarding.post /dismiss": "setupDismiss",
};

/** Message ids the table can produce (for tests / message completeness). */
export const KNOWN_ACTION_IDS: readonly string[] = [...new Set(Object.values(KNOWN))];

export const GENERIC_VERBS = ["create", "update", "delete", "other"] as const;
export type GenericVerb = (typeof GENERIC_VERBS)[number];

export type ActionDescription =
  | { kind: "known"; id: string; module: string }
  | { kind: "generic"; verb: GenericVerb; module: string; detail: string };

/**
 * "invoices.post /:id([0-9a-fA-F-]{36})/cancel" → "invoices.post /:/cancel" (route regexes stripped, params unnamed).
 * Explicit dotted actions ("staff.role.update") pass through unchanged.
 */
export function normalizeAction(action: string): string {
  const s = action.trim();
  const space = s.indexOf(" ");
  if (space < 0) return s.toLowerCase();
  const head = s.slice(0, space).toLowerCase();
  let pattern = s.slice(space + 1).trim();
  pattern = pattern.replace(/(:[A-Za-z_][\w-]*)\([^)]*\)/g, "$1").replace(/:[A-Za-z_][\w-]*/g, ":");
  if (pattern.length > 1) pattern = pattern.replace(/\/+$/, "");
  return `${head} ${pattern || "/"}`;
}

const VERB_OF: Record<string, GenericVerb> = { post: "create", put: "update", patch: "update", delete: "delete" };

/** Known action id, or a generic "<verb> in <module>" description with the raw route as detail. */
export function describeAction(action: string): ActionDescription {
  const norm = normalizeAction(action);
  const known = KNOWN[norm];
  const space = norm.indexOf(" ");
  if (space < 0) {
    const [module = norm, ...rest] = norm.split(".");
    if (known) return { kind: "known", id: known, module };
    const last = rest[rest.length - 1] ?? "";
    const verb: GenericVerb = /create|add|invite/.test(last) ? "create" : /update|edit|change|set/.test(last) ? "update" : /delete|remove|cancel/.test(last) ? "delete" : "other";
    return { kind: "generic", verb, module, detail: action };
  }
  const head = norm.slice(0, space);
  const dot = head.lastIndexOf(".");
  const module = dot > 0 ? head.slice(0, dot) : head;
  const method = dot > 0 ? head.slice(dot + 1) : "";
  if (known) return { kind: "known", id: known, module };
  // Actions like "POST /:id/cancel" are cancellations whatever the method says.
  const pattern = norm.slice(space + 1);
  const tail = pattern.split("/").filter((p) => p && p !== ":").pop() ?? "";
  const verb: GenericVerb = /cancel|remove|delete|void/.test(tail) ? "delete" : (VERB_OF[method] ?? "other");
  return { kind: "generic", verb, module, detail: `${method.toUpperCase()} ${action.slice(action.indexOf(" ") + 1)}` };
}

/** Module ids with their own label under `workspace.audit.modules.*`. */
export const AUDIT_MODULES = [
  "invoices",
  "invoice",
  "catalog",
  "inventory",
  "orders",
  "coupons",
  "expenses",
  "staff",
  "import",
  "features",
  "payments",
  "settings",
  "branding",
  "onboarding",
  "cms",
  "reviews",
  "delivery",
  "store",
  "tenancy",
] as const;

/** Entity types the filter offers (free text is also accepted). */
export const ENTITY_TYPES = ["invoices", "catalog", "inventory", "orders", "expenses", "member", "role", "import"] as const;

/**
 * The "Area" filter: module id (label `workspace.audit.modules.<id>`) → the `action` prefix sent to the API.
 * Bills use `invoice*` so both derived ("invoices.post /…") and explicit ("invoice.cancel") actions match.
 */
export const AUDIT_AREAS: readonly { id: (typeof AUDIT_MODULES)[number]; action: string }[] = [
  { id: "invoices", action: "invoice*" },
  { id: "catalog", action: "catalog.*" },
  { id: "inventory", action: "inventory.*" },
  { id: "orders", action: "orders.*" },
  { id: "coupons", action: "coupons.*" },
  { id: "expenses", action: "expenses.*" },
  { id: "staff", action: "staff.*" },
  { id: "import", action: "import.*" },
  { id: "features", action: "features.*" },
  { id: "payments", action: "payments.*" },
  { id: "settings", action: "settings.*" },
];
