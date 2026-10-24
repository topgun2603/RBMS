"use client";

import * as React from "react";
import {
  BarChart3Icon,
  BellRingIcon,
  BookOpenIcon,
  BoxesIcon,
  BuildingIcon,
  ClipboardListIcon,
  CreditCardIcon,
  FileTextIcon,
  HandCoinsIcon,
  LayoutDashboardIcon,
  PackageIcon,
  PlusIcon,
  ReceiptIndianRupeeIcon,
  TruckIcon,
  UsersIcon,
  WalletCardsIcon,
  WarehouseIcon,
} from "lucide-react";
import { ModuleDashboard, type NavSection, type RouteDef, type WebModule, type WidgetDef } from "@srirealtime/web";
import { EXPENSES_PERMISSION } from "./lib/access";
import { billingMessages } from "./lib/messages";

/** Feature keys the billing UI uses (declared by @srirealtime/invoices, inventory and payments; docs/features.md). */
export const BILLING_FEATURES = {
  invoices: "invoices",
  whatsapp: "invoices.whatsapp",
  reminders: "invoices.reminders",
  creditBook: "invoices.credit-book",
  reports: "invoices.reports",
  gstReports: "invoices.gst-reports",
  inventory: "inventory",
  purchases: "inventory.purchases",
  payments: "payments",
  /** Expenses and the profit report (@srirealtime/expenses). */
  expenses: "expenses",
  /** PDF downloads (@srirealtime/documents). */
  documents: "documents",
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
    { href: "credit-book", label: "billing.nav.creditBook", icon: BookOpenIcon, feature: F.creditBook, mobile: "tab" as const },
    { href: "customers", label: "billing.nav.customers", icon: UsersIcon, feature: F.invoices },
  ];
  const stock = [
    { href: "items", label: "billing.nav.items", icon: PackageIcon, feature: F.invoices },
    { href: "stock", label: "billing.nav.stock", icon: WarehouseIcon, feature: F.inventory },
    { href: "purchases", label: "billing.nav.purchases", icon: BoxesIcon, feature: F.purchases },
    { href: "purchase-orders", label: "billing.nav.purchaseOrders", icon: ClipboardListIcon, feature: F.purchases },
    { href: "suppliers", label: "billing.nav.suppliers", icon: TruckIcon, feature: F.purchases },
    { href: "payables", label: "billing.nav.payables", icon: WalletCardsIcon, feature: F.purchases },
  ];
  const insights = [
    { href: "reports", label: "billing.nav.reports", icon: BarChart3Icon, feature: F.reports },
    { href: "expenses", label: "billing.nav.expenses", icon: ReceiptIndianRupeeIcon, feature: F.expenses, permission: EXPENSES_PERMISSION },
  ];

  const nav: NavSection[] =
    layout === "sections"
      ? [
          { id: "sell", title: "billing.nav.sell", items: [home, ...sell] },
          { id: "stock", title: "billing.nav.stockGroup", items: stock },
          { id: "insights", title: "billing.nav.insights", items: insights },
        ]
      : [{ id: "billing", title: "billing.nav.billing", items: [home, ...sell, ...stock, ...insights] }];

  // Static segments before ":id" so "invoices/new" isn't read as a bill id.
  const routes: RouteDef[] = [
    // The module's own overview. At "/" the app's dashboard (all modules' widgets) takes this path instead.
    { path: "", component: ModuleDashboard, feature: F.invoices },
    { path: "invoices", component: page(() => import("./pages/invoices")), feature: F.invoices },
    { path: "invoices/new", component: page(() => import("./pages/invoice-new")), feature: F.invoices, immersive: true },
    { path: "invoices/:id", component: page(() => import("./pages/invoice-detail")), feature: F.invoices },
    { path: "invoices/:id/edit", component: page(() => import("./pages/invoice-edit")), feature: F.invoices, immersive: true },
    { path: "credit-notes", component: page(() => import("./pages/credit-notes")), feature: F.invoices },
    { path: "credit-notes/:id", component: page(() => import("./pages/credit-note-detail")), feature: F.invoices },
    { path: "customers", component: page(() => import("./pages/customers")), feature: F.invoices },
    { path: "customers/:id", component: page(() => import("./pages/customer-detail")), feature: F.invoices },
    { path: "credit-book", component: page(() => import("./pages/credit-book")), feature: F.creditBook },
    { path: "items", component: page(() => import("./pages/items")), feature: F.invoices },
    { path: "stock", component: page(() => import("./pages/stock")), feature: F.inventory },
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
    { path: "expenses", component: page(() => import("./pages/expenses")), feature: F.expenses, permission: EXPENSES_PERMISSION },
  ];

  const widgetDefs: WidgetDef[] = [
    // KPI strip: sales leads every app it is mounted in; "to collect" outranks collected/overdue so a store (EC) that
    // also shows orders and visitors keeps it among its four.
    { id: "kpi-sales", zone: "kpi", priority: 10, feature: F.invoices, component: widget("SalesKpiWidget", widgets) },
    { id: "kpi-to-collect", zone: "kpi", priority: 40, feature: F.invoices, component: widget("ToCollectKpiWidget", widgets) },
    { id: "kpi-collected", zone: "kpi", priority: 45, feature: F.invoices, component: widget("CollectedKpiWidget", widgets) },
    { id: "kpi-overdue", zone: "kpi", priority: 50, feature: F.invoices, component: widget("OverdueKpiWidget", widgets) },
    // Needs attention: overdue bills, low / out-of-stock items.
    { id: "kpi-payables", zone: "kpi", priority: 55, feature: F.purchases, component: widget("PayablesKpiWidget", () => import("./widgets/payables")) },
    { id: "attention", zone: "attention", priority: 10, feature: F.invoices, component: widget("BillingAttentionWidget", widgets) },
    { id: "sales-trend", zone: "main", priority: 10, feature: F.reports, component: widget("SalesTrendWidget", widgets) },
    { id: "recent-bills", zone: "main", priority: 30, feature: F.invoices, component: widget("RecentBillsWidget", widgets) },
    { id: "payments-by-method", zone: "side", priority: 10, feature: F.reports, component: widget("PaymentMethodsWidget", widgets) },
    { id: "top-dues", zone: "side", priority: 20, feature: F.creditBook, component: widget("TopDuesWidget", widgets) },
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
    ],
    widgets: widgetDefs,
    actions: [
      { id: "new-bill", label: "billing.nav.newBill", href: "invoices/new", icon: PlusIcon, feature: F.invoices, primary: true },
      { id: "receive-money", label: "billing.dashboard.quickReceive", href: "credit-book?filter=due", icon: HandCoinsIcon, feature: F.creditBook },
      { id: "add-purchase", label: "billing.dashboard.quickPurchase", href: "purchases/new", icon: BoxesIcon, feature: F.purchases },
    ],
    settings: [
      { path: "", label: "billing.nav.settings", icon: BuildingIcon, feature: F.invoices, component: page(() => import("./pages/settings-profile")) },
      { path: "payments", label: "billing.nav.onlinePayments", icon: CreditCardIcon, feature: F.payments, component: page(() => import("./pages/settings-payments")) },
      { path: "reminders", label: "billing.nav.reminders", icon: BellRingIcon, feature: F.reminders, component: page(() => import("./pages/settings-reminders")) },
    ],
  };
}
