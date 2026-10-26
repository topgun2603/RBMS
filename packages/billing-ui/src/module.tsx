"use client";

import * as React from "react";
import {
  ArrowLeftRightIcon,
  BarChart3Icon,
  BellRingIcon,
  BookMarkedIcon,
  BookOpenIcon,
  BookTextIcon,
  BoxesIcon,
  BuildingIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  CreditCardIcon,
  FileCheck2Icon,
  FileSignatureIcon,
  FileTextIcon,
  HandCoinsIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListTreeIcon,
  LockIcon,
  PackageIcon,
  PercentIcon,
  PlusIcon,
  ReceiptIndianRupeeIcon,
  ScaleIcon,
  TrendingUpIcon,
  TruckIcon,
  UsersIcon,
  WalletCardsIcon,
  WarehouseIcon,
} from "lucide-react";
import { ModuleDashboard, type NavSection, type RouteDef, type WebModule, type WidgetDef } from "@srirealtime/web";
import { ACC_POST, ACC_VIEW } from "./lib/accounting";
import { EXPENSES_PERMISSION, QUOTATIONS_MANAGE_PERMISSION, QUOTATIONS_VIEW_PERMISSION } from "./lib/access";
import { billingMessages } from "./lib/messages";

/** Feature keys the billing UI uses (declared by @srirealtime/invoices, inventory and payments; docs/features.md). */
export const BILLING_FEATURES = {
  invoices: "invoices",
  whatsapp: "invoices.whatsapp",
  reminders: "invoices.reminders",
  creditBook: "invoices.credit-book",
  reports: "invoices.reports",
  gstReports: "invoices.gst-reports",
  /** Quotations (estimates) that turn into a bill or an order (@srirealtime/invoices). */
  quotations: "invoices.quotations",
  inventory: "inventory",
  purchases: "inventory.purchases",
  /** Several stock locations (branches, warehouses) and transfers between them. */
  locations: "inventory.locations",
  payments: "payments",
  /** Expenses and the profit report (@srirealtime/expenses). */
  expenses: "expenses",
  /** PDF downloads (@srirealtime/documents). */
  documents: "documents",
  /** Double-entry books: chart of accounts, journal, ledgers, trial balance, P&L, balance sheet (@srirealtime/accounting). */
  accounting: "accounting",
} as const;

const F = BILLING_FEATURES;

export interface BillingModuleOptions {
  /** Where the host mounts billing: "/" (apps/billing) or e.g. "/billing" (apps/shop). Default "/". */
  basePath?: string;
  /**
   * Further restrict features on top of the server (grants like "invoices", "invoices.*"). Leave it out to use whatever
   * the shop's app profile, plan and owner switches allow.
   */
  features?: string[];
  /**
   * Sidebar layout: "sections" (Sell / Stock / Insights, for an app that is all billing) or "single" (one "Billing"
   * section next to the host's own). Default: "sections" at "/", "single" anywhere else.
   */
  nav?: "sections" | "single";
}

// Pages and widgets load on demand: an app that mounts billing only downloads the screens it opens.
const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));
const widgets = () => import("./widgets/dashboard");

/** The billing UI module. Mount it with createWebApp({ modules: [billingModule({ basePath: "/billing" })] }). */
export function billingModule(opts: BillingModuleOptions = {}): WebModule {
  const basePath = opts.basePath ?? "/";
  const atRoot = basePath.replace(/^\/+|\/+$/g, "") === "";
  const layout = opts.nav ?? (atRoot ? "sections" : "single");

  const home = {
    href: "",
    label: atRoot ? "billing.nav.dashboard" : "billing.nav.overview",
    tabLabel: atRoot ? "billing.nav.home" : undefined,
    icon: LayoutDashboardIcon,
    mobile: atRoot ? ("tab" as const) : ("more" as const),
  };
  const sell = [
    { href: "invoices", label: "billing.nav.invoices", icon: FileTextIcon, feature: F.invoices, mobile: "tab" as const },
    { href: "quotations", label: "billing.nav.quotations", icon: FileSignatureIcon, feature: F.quotations, permission: QUOTATIONS_VIEW_PERMISSION },
    { href: "credit-book", label: "billing.nav.creditBook", icon: BookOpenIcon, feature: F.creditBook, mobile: "tab" as const },
    { href: "customers", label: "billing.nav.customers", icon: UsersIcon, feature: F.invoices },
  ];
  const stock = [
    { href: "items", label: "billing.nav.items", icon: PackageIcon, feature: F.invoices },
    { href: "stock", label: "billing.nav.stock", icon: WarehouseIcon, feature: F.inventory },
    { href: "batches", label: "billing.nav.batches", icon: CalendarClockIcon, feature: F.inventory },
    { href: "pricing-hints", label: "billing.nav.pricingHints", icon: TrendingUpIcon, feature: F.inventory, permission: ["reports.view", "inventory.adjust", "inventory.purchases"] },
    { href: "stock-audit", label: "billing.nav.stockAudit", icon: ClipboardCheckIcon, feature: F.inventory, permission: "inventory.audit" },
    { href: "transfers", label: "billing.nav.transfers", icon: ArrowLeftRightIcon, feature: F.locations },
    { href: "purchases", label: "billing.nav.purchases", icon: BoxesIcon, feature: F.purchases },
    { href: "purchase-orders", label: "billing.nav.purchaseOrders", icon: ClipboardListIcon, feature: F.purchases },
    { href: "suppliers", label: "billing.nav.suppliers", icon: TruckIcon, feature: F.purchases },
    { href: "payables", label: "billing.nav.payables", icon: WalletCardsIcon, feature: F.purchases },
  ];
  const insights = [
    { href: "reports", label: "billing.nav.reports", icon: BarChart3Icon, feature: F.reports },
    { href: "gst", label: "billing.nav.gst", icon: FileCheck2Icon, feature: F.gstReports, permission: "reports.view" },
    { href: "expenses", label: "billing.nav.expenses", icon: ReceiptIndianRupeeIcon, feature: F.expenses, permission: EXPENSES_PERMISSION },
  ];

  const accounting = [
    { href: "accounting", label: "billing.accounting.nav.overview", icon: BookMarkedIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/journal", label: "billing.accounting.nav.journal", icon: BookTextIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/day-book", label: "billing.accounting.nav.dayBook", icon: CalendarDaysIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/ledger", label: "billing.accounting.nav.ledger", icon: BookOpenIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/trial-balance", label: "billing.accounting.nav.trialBalance", icon: ScaleIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/profit-loss", label: "billing.accounting.nav.profitLoss", icon: TrendingUpIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/balance-sheet", label: "billing.accounting.nav.balanceSheet", icon: LandmarkIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/gst", label: "billing.accounting.nav.gst", icon: PercentIcon, feature: F.accounting, permission: ACC_VIEW },
    { href: "accounting/accounts", label: "billing.accounting.nav.accounts", icon: ListTreeIcon, feature: F.accounting, permission: ACC_VIEW },
  ];

  const nav: NavSection[] =
    layout === "sections"
      ? [
          { id: "sell", title: "billing.nav.sell", items: [home, ...sell] },
          { id: "stock", title: "billing.nav.stockGroup", items: stock },
          { id: "insights", title: "billing.nav.insights", items: insights },
          { id: "accounting", title: "billing.accounting.nav.group", items: accounting },
        ]
      : [{ id: "billing", title: "billing.nav.billing", items: [home, ...sell, ...stock, ...insights, ...accounting] }];

  // Static segments before ":id" so "invoices/new" isn't read as a bill id.
  const routes: RouteDef[] = [
    // The module's own overview. At "/" the app's dashboard (all modules' widgets) takes this path instead.
    { path: "", component: ModuleDashboard, feature: F.invoices },
    { path: "invoices", component: page(() => import("./pages/invoices")), feature: F.invoices },
    { path: "invoices/new", component: page(() => import("./pages/invoice-new")), feature: F.invoices, immersive: true },
    { path: "invoices/:id", component: page(() => import("./pages/invoice-detail")), feature: F.invoices },
    { path: "invoices/:id/edit", component: page(() => import("./pages/invoice-edit")), feature: F.invoices, immersive: true },
    { path: "quotations", component: page(() => import("./pages/quotations")), feature: F.quotations, permission: QUOTATIONS_VIEW_PERMISSION },
    { path: "quotations/new", component: page(() => import("./pages/quotation-new")), feature: F.quotations, permission: QUOTATIONS_MANAGE_PERMISSION, immersive: true },
    { path: "quotations/:id", component: page(() => import("./pages/quotation-detail")), feature: F.quotations, permission: QUOTATIONS_VIEW_PERMISSION },
    { path: "quotations/:id/edit", component: page(() => import("./pages/quotation-edit")), feature: F.quotations, permission: QUOTATIONS_MANAGE_PERMISSION, immersive: true },
    { path: "credit-notes", component: page(() => import("./pages/credit-notes")), feature: F.invoices },
    { path: "credit-notes/:id", component: page(() => import("./pages/credit-note-detail")), feature: F.invoices },
    { path: "customers", component: page(() => import("./pages/customers")), feature: F.invoices },
    { path: "customers/:id", component: page(() => import("./pages/customer-detail")), feature: F.invoices },
    { path: "credit-book", component: page(() => import("./pages/credit-book")), feature: F.creditBook },
    { path: "items", component: page(() => import("./pages/items")), feature: F.invoices },
    { path: "stock", component: page(() => import("./pages/stock")), feature: F.inventory },
    { path: "batches", component: page(() => import("./pages/batches")), feature: F.inventory },
    { path: "pricing-hints", component: page(() => import("./pages/pricing-hints")), feature: F.inventory, permission: ["reports.view", "inventory.adjust", "inventory.purchases"] },
    { path: "stock-audit", component: page(() => import("./pages/stock-audits")), feature: F.inventory, permission: "inventory.audit" },
    { path: "stock-audit/:id", component: page(() => import("./pages/stock-audit-detail")), feature: F.inventory, permission: "inventory.audit" },
    { path: "transfers", component: page(() => import("./pages/transfers")), feature: F.locations },
    { path: "transfers/new", component: page(() => import("./pages/transfer-new")), feature: F.locations, permission: "inventory.transfer", immersive: true },
    { path: "transfers/:id", component: page(() => import("./pages/transfer-detail")), feature: F.locations },
    { path: "purchases", component: page(() => import("./pages/purchases")), feature: F.purchases },
    { path: "purchases/new", component: page(() => import("./pages/purchase-new")), feature: F.purchases, immersive: true },
    { path: "purchases/:id", component: page(() => import("./pages/purchase-detail")), feature: F.purchases },
    { path: "purchase-orders", component: page(() => import("./pages/purchase-orders")), feature: F.purchases },
    { path: "purchase-orders/new", component: page(() => import("./pages/purchase-order-new")), feature: F.purchases, immersive: true },
    { path: "purchase-orders/:id", component: page(() => import("./pages/purchase-order-detail")), feature: F.purchases },
    { path: "debit-notes", component: page(() => import("./pages/debit-notes")), feature: F.purchases },
    { path: "suppliers", component: page(() => import("./pages/suppliers")), feature: F.purchases },
    { path: "suppliers/:id", component: page(() => import("./pages/supplier-detail")), feature: F.purchases },
    { path: "payables", component: page(() => import("./pages/payables")), feature: F.purchases },
    { path: "reports", component: page(() => import("./pages/reports")), feature: F.reports },
    { path: "gst", component: page(() => import("./pages/gst")), feature: F.gstReports, permission: "reports.view" },
    { path: "expenses", component: page(() => import("./pages/expenses")), feature: F.expenses, permission: EXPENSES_PERMISSION },
    // Accounting: static segments first, so "accounting/journal/new" isn't read as an id.
    { path: "accounting", component: page(() => import("./pages/accounting")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/accounts", component: page(() => import("./pages/accounting-accounts")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/journal", component: page(() => import("./pages/accounting-journal")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/journal/new", component: page(() => import("./pages/accounting-journal-new")), feature: F.accounting, permission: ACC_POST },
    { path: "accounting/day-book", component: page(() => import("./pages/accounting-day-book")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/ledger", component: page(() => import("./pages/accounting-ledger")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/trial-balance", component: page(() => import("./pages/accounting-trial-balance")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/profit-loss", component: page(() => import("./pages/accounting-profit-loss")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/balance-sheet", component: page(() => import("./pages/accounting-balance-sheet")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/gst", component: page(() => import("./pages/accounting-gst")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/checks", component: page(() => import("./pages/accounting-checks")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/settings", component: page(() => import("./pages/accounting-settings")), feature: F.accounting, permission: ACC_VIEW },
    { path: "accounting/how-it-works", component: page(() => import("./pages/accounting-help")), feature: F.accounting, permission: ACC_VIEW },
  ];

  const widgetDefs: WidgetDef[] = [
    // KPI strip: sales leads every app it is mounted in; "to collect" outranks collected/overdue so a store (EC) that
    // also shows orders and visitors keeps it among its four.
    { id: "kpi-sales", zone: "kpi", priority: 10, feature: F.invoices, component: widget("SalesKpiWidget", widgets) },
    { id: "kpi-to-collect", zone: "kpi", priority: 40, feature: F.invoices, component: widget("ToCollectKpiWidget", widgets) },
    { id: "kpi-collected", zone: "kpi", priority: 45, feature: F.invoices, component: widget("CollectedKpiWidget", widgets) },
    { id: "kpi-overdue", zone: "kpi", priority: 50, feature: F.invoices, component: widget("OverdueKpiWidget", widgets) },
    // Widgets that call report / credit-book endpoints also need the permission those endpoints check (a cashier gets no 403s).
    // Needs attention: overdue bills, low / out-of-stock items.
    { id: "kpi-quotations", zone: "kpi", priority: 52, feature: F.quotations, component: widget("QuotationsKpiWidget", () => import("./widgets/quotations")) },
    { id: "kpi-payables", zone: "kpi", priority: 55, feature: F.purchases, component: widget("PayablesKpiWidget", () => import("./widgets/payables")) },
    { id: "kpi-expiry", zone: "kpi", priority: 58, feature: F.inventory, component: widget("ExpiryKpiWidget", () => import("./widgets/expiry")) },
    { id: "ai-summary", zone: "attention", priority: 5, feature: "ai", component: widget("AiSummaryWidget", () => import("./widgets/ai-summary")) },
    { id: "attention", zone: "attention", priority: 10, feature: F.invoices, component: widget("BillingAttentionWidget", widgets) },
    { id: "sales-trend", zone: "main", priority: 10, feature: F.reports, permission: "reports.view", component: widget("SalesTrendWidget", widgets) },
    { id: "recent-bills", zone: "main", priority: 30, feature: F.invoices, component: widget("RecentBillsWidget", widgets) },
    { id: "payments-by-method", zone: "side", priority: 10, feature: F.reports, permission: "reports.view", component: widget("PaymentMethodsWidget", widgets) },
    { id: "top-dues", zone: "side", priority: 20, feature: F.creditBook, permission: "invoices.credit-book", component: widget("TopDuesWidget", widgets) },
    { id: "low-stock", zone: "side", priority: 30, feature: F.inventory, component: widget("LowStockWidget", widgets) },
  ];

  return {
    id: "billing",
    basePath,
    features: opts.features,
    messages: billingMessages,
    nav,
    routes,
    publicRoutes: [
      { path: "i/:token", component: page(() => import("./pages/public-invoice")), feature: F.invoices },
      { path: "s/:token", component: page(() => import("./pages/public-statement")), feature: F.creditBook },
      { path: "q/:token", component: page(() => import("./pages/public-quotation")), feature: F.quotations },
    ],
    widgets: widgetDefs,
    actions: [
      { id: "new-bill", label: "billing.nav.newBill", href: "invoices/new", icon: PlusIcon, feature: F.invoices, primary: true },
      { id: "new-quotation", label: "billing.nav.newQuotation", href: "quotations/new", icon: FileSignatureIcon, feature: F.quotations },
      { id: "receive-money", label: "billing.dashboard.quickReceive", href: "credit-book?filter=due", icon: HandCoinsIcon, feature: F.creditBook, permission: "invoices.credit-book" },
      { id: "add-purchase", label: "billing.dashboard.quickPurchase", href: "purchases/new", icon: BoxesIcon, feature: F.purchases },
    ],
    settings: [
      { path: "", label: "billing.nav.settings", icon: BuildingIcon, feature: F.invoices, component: page(() => import("./pages/settings-profile")) },
      { path: "payments", label: "billing.nav.onlinePayments", icon: CreditCardIcon, feature: F.payments, component: page(() => import("./pages/settings-payments")) },
      { path: "reminders", label: "billing.nav.reminders", icon: BellRingIcon, feature: F.reminders, component: page(() => import("./pages/settings-reminders")) },
      { path: "quotations", label: "billing.nav.quotationSettings", icon: FileSignatureIcon, feature: F.quotations, component: page(() => import("./pages/settings-quotations")) },
      { path: "accounting", label: "billing.accounting.nav.settings", icon: LockIcon, feature: F.accounting, component: page(() => import("./pages/accounting-settings")) },
    ],
  };
}
