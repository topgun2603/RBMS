# Web modules: mounting UI features into any app

Back-end modules are packages wired in `apps/api/src/kit.ts`. The front end follows the same idea: a **UI module** is a
package that any Next.js app mounts, at any path, with the features that app wants.

```
packages/web            @srirealtime/web         Shared client kit: API client, session, OTP login, i18n, branding,
                                                 features, query provider, app shell, module router, common components
packages/billing-ui     @srirealtime/billing-ui  The billing UI module (bills, customers, credit book, items, stock,
                                                 purchases, suppliers, reports, billing settings, public bill/statement pages)
apps/billing            thin shell: billing-ui mounted at "/", tenant from the subdomain
apps/admin              platform + workspace admin (migrates to @srirealtime/web)
apps/shop               ecommerce demo shell: a store admin that mounts billing-ui at "/billing" with fewer features
```

## The module contract (`@srirealtime/web`)

```ts
interface WebModule {
  id: string;                                  // "billing"
  messages: { en: Messages; ta: Messages };    // merged into the app's i18n (server overrides still win)
  nav: NavSection[];                           // { id, title (msg key), items: { href (relative), label (msg key), icon, feature?, mobile?: "tab" | "more" }[] }
  routes: RouteDef[];                          // { path: "invoices/:id", component: lazy(() => import(...)), feature?: string | string[], roles?: string[] }
  publicRoutes?: RouteDef[];                   // no login: "i/:token", "s/:token"
  widgets?: WidgetDef[];                       // dashboard widgets: { id, zone, priority?, feature?, size?, component } (see "Dashboard")
  actions?: QuickAction[];                     // e.g. { id: "new-bill", label, href: "invoices/new", feature: "invoices", primary: true }
  settings?: SettingsPage[];                   // pages that appear under the app's Settings: { path, label, component, feature?, roles? }
}

function billingModule(opts?: { basePath?: string; features?: string[] /* further restrict on top of the server */ }): WebModule
```

Paths in a module are **relative**. The host decides where it lives:
- `apps/billing` mounts `billingModule()` at `/` → `/invoices/123`
- `apps/shop` mounts `billingModule({ basePath: "/billing" })` → `/billing/invoices/123`

Inside a module, code never hard-codes absolute paths: it uses `useModuleHref("invoices/123")` / `<ModuleLink to="invoices/new">`
and `useModuleNavigate()`.

## Host app

```tsx
// apps/shop/src/web-app.ts
export const webApp = createWebApp({
  appId: "EC",
  name: "Store",
  tenant: { from: "hostname" },           // or { from: "storage" } in admin
  modules: [storeModule(), billingModule({ basePath: "/billing" })],   // sidebar sections follow this order
  home: "dashboard",                       // the shell's dashboard renders widgets from every mounted module
});

// apps/shop/src/app/[[...slug]]/page.tsx  (one catch-all route; public routes the same way)
"use client";
export default function Page() { return <WebAppRouter app={webApp} />; }
```

The shell (sidebar on desktop, bottom bar + "More" sheet on phones, top bar with shop switcher/locale/theme/user menu) is
built from all modules' `nav`, filtered by `useFeatures()` (server state from `GET /v1/features`), by the module's
`features` option, and by role. A route whose feature is off renders the feature-gate page (reason plan → upgrade hint;
reason shop → "Turned off" with a link to Settings → Features for owners; reason app → not found).

## Rules
- UI modules import only `@srirealtime/web`, `@srirealtime/ui`, `@srirealtime/i18n/client` and pure packages such as
  `@srirealtime/gst`. Never another UI module, and never `next/*` (navigation goes through the kit's hooks).
- Every nav item, route, widget, action and settings page that belongs to an optional feature declares `feature`.
  Inside pages, buttons that belong to another optional feature check it with `useFeature(key)` / `<Feature when>`.
- Message keys are namespaced by module (`billing.*`); the kit's own strings are `web.*`.

## As implemented (details and small deviations)

The contract above holds; these are the details the first implementation settled.

**Types** (`packages/web/src/app/types.ts`):

```ts
interface Gated { feature?: string | readonly string[] /* all required */; roles?: readonly string[] /* any of */;
  permission?: string | readonly string[] /* any of; see "Permission gating" */; permissionExplicit?: boolean }
interface NavSection extends Gated { id; title /* msg key */; items: NavItem[] }
interface NavItem extends Gated { href /* relative, "" = module root */; label; icon?; mobile?: "tab" | "more";
  tabLabel? /* shorter label for the phone bar */; exact? /* default: true for the module root */ }
interface RouteDef extends Gated { path; component; immersive?: boolean /* own sticky action bar: phone tab bar hides */ }
interface WidgetDef extends Gated { id; zone?: WidgetZone; priority?: number; size?: "sm" | "md" | "lg"; rowSpan? /* deprecated */; component }
interface QuickAction extends Gated { id; label; href; icon?; primary? }
interface SettingsPage extends Gated { path /* "" = /settings itself */; label; icon?; component }
interface WebModule { id; basePath?; features?; messages; nav; routes; publicRoutes?; widgets?; actions?; settings? }
```

- **`basePath` and `features` live on the module object.** `billingModule(opts)` copies them from its options, so any
  module factory can take the same two options; `createWebApp` normalises `basePath` ("/billing/" → "/billing").
- `createWebApp({ appId, name?, tenant, modules, home?, roles?, messages? })`. `tenant` is
  `{ from: "hostname", rootDomain? }` (default root: `NEXT_PUBLIC_ROOT_DOMAIN`, else `localhost`) or `{ from: "storage" }`
  (slug in `localStorage.sr_tenant`, picked on the "Open your shop" screen, "Switch shop" in the user menu).
  `roles` = shop roles that may sign in (default owner/admin/staff).
- **App-level paths owned by the kit:** `/login` (OTP sign-in; verifies with the address the user typed, never the
  masked one), `/settings/*` (every module's `settings` pages in module order; `""` claims `/settings`; the first module
  wins a path), the built-in **Settings → Features** page at `/settings/features`, and `/` when `home: "dashboard"`.
  At `/` the dashboard shadows a module's own `""` route; a module mounted elsewhere (`/billing`) shows its own overview
  there (`ModuleDashboard`, its widgets only).
- **Matching:** modules with the longest `basePath` first, routes in declaration order (put `invoices/new` before
  `invoices/:id`). Params via `useRouteParams()`.
- **Gating:** role check first (`RoleGatePage`), then permission (`PermissionGatePage`, see below), then features: plan → "Not available on your plan", shop → "Turned off"
  (+ "Open Features" for owners), app or the module's own restriction → not found; `dependency` resolves to the feature
  that is really off. Public routes whose feature is off are plain "not found" (visitors never see owner hints).
- **Feature state** comes from `GET /v1/features` (sent without the bearer token, so expired sessions can't bounce
  public pages). Unknown keys count as off. If the call fails, the client fails open; the API still enforces.
  The signed-in shell waits for the answer, so nothing flickers.
- **Links:** `<ModuleLink to="invoices/new">` is module-relative; `<ModuleLink href="/settings">` is app-absolute.
  `useModuleNavigate()(to, { replace?, scroll? })` accepts `"?tab=gst"` to swap only the query string.
  `useSettingsHref()("payments")` → `/settings/payments`. `useQueryParams()` / `useCurrentPath()` wrap Next's hooks.
  Share links the API doesn't return are built from the module's base (`usePublicUrl` in billing-ui) → `/billing/i/<token>`.
- **Phone bar:** the first three `mobile: "tab"` items across modules, with the first visible `primary` action in the
  middle, then "More" (every section as a grid). The desktop top bar shows the primary action too.
- **i18n:** the kit merges `web.*` + every module's bundle (Tamil falls back key by key to English). Server overrides win
  for keys in the `web.*` and module namespaces. `describeError()` looks up `<moduleId>.errors.<code>` for every mounted
  module, then `web.errors.<code>`, and has messages for `plan_limit` / `feature_disabled`.
- **Host wiring:** the catch-all page **must be a client component** (`"use client"`), because the app object holds
  components; providers live inside `<WebAppRouter>`, so the root layout only sets fonts and CSS. `app/not-found.tsx`
  renders the router too. Next compiles the packages (`transpilePackages`), and Tailwind needs `@source` lines for
  `packages/web/src` and every mounted UI module.
- **`billingModule` extra option:** `nav?: "sections" | "single"`. Default "sections" (Sell / Stock / Insights) at "/",
  "single" (one "Billing" section next to the host's own sections) anywhere else.
- Pure helpers for tests and other shells: `buildNavModel`, `matchRoute`, `checkGate`, `visibleFor`, `featureChecker`,
  `grantAllows`, `permissionMatches`, `permissionAllows` (`packages/web/src/app/model.ts`, `packages/web/src/lib/features.tsx`,
  `packages/web/src/lib/permissions.ts`).
- **Settings tabs** (`<SettingsNav />`): from `sm` up a horizontally scrolling tab bar (no scrollbar) that fades only the
  side(s) with more tabs and scrolls the active tab into view; on phones a native `<select>` of the same pages.

### Lists and tables

Lists that grow are server-paged TanStack tables: the API pages/sorts/filters (docs/CONVENTIONS.md → "Lists and
tables"), the page binds that state to the URL. Three pieces:

| Piece | Package | Role |
|---|---|---|
| `useServerTable<Row, typeof filters>(opts)` | `@srirealtime/web` | URL ⇄ state (`page`, `size`, `sort`, `q`, each filter) written with `router.replace` and no scroll jump; fetches through `api()` with TanStack Query (`keepPreviousData`); returns `{ table, query, state, filters, facets, total, apiParams, update, setSearch, setSort, setPage, setPageSize, clearFilters }` |
| `<DataTable table={st.table} />` | `@srirealtime/ui` | TanStack Table v8 (manual paging/sorting/filtering): sortable headers (`aria-sort` + icon), numeric right-aligned columns, optional row checkboxes + floating bulk bar, sticky header (xl+, switched off automatically when the table is wider than the frame so it scrolls instead of clipping), skeleton rows on first load, dimmed rows + progress line while the next page loads, empty / no-results / error states, row click (Enter on a focused row too), footer "Showing 1–25 of 1,234" + rows per page (25/50/100) + prev/next + page numbers, and a card list on phones |
| `<DataTableToolbar table={st.table} quickFilters? children? />` | `@srirealtime/ui` | search (debounced 300 ms; Enter applies at once), one button per filter (popover with checkboxes and counts from `facets`; a date filter with presets Today … This financial year and a custom from/to), the Columns menu (md+, remembered per table in localStorage), active-filter chips (× each) and "Clear filters". `children` go at the right end (export, view switch) |

**URL:** `?page=3&size=50&sort=-total&q=meena&status=paid,overdue&from=2026-10-01&to=2026-10-31`. Defaults are left
out (page 1, the default size, the default sort, empty filters); params the table doesn't own (`view=board`) are kept;
any change of search, filter, sort or size goes back to page 1; a page past the end (old shared link) moves to the last
page. Two tables on one page: `urlPrefix: "inv"` → `inv.page`, `inv.sort` ….

**Columns** (`DataTableColumn<Row>`; memoise the array):

```ts
{
  id: "total",                       // also the sort key unless `sortable` is a string
  header: t("x.col.total"),          // ReactNode; give `label` (plain text) when the header isn't a string
  cell: (row, i) => money(row.total),
  numeric: true,                     // right-aligned tabular figures; first click sorts descending
  sortable: true,                    // or "serverKey"; must be a key of the route's defineSort map
  sortDescFirst: true,               // dates
  hideable: false,                   // keep identifying columns out of the Columns menu
  defaultHidden: true,               // off until the viewer turns it on
  card: "right",                     // phone card slot: "title" | "subtitle" | "meta" | "right"; omit = not on the card
  cardCell: (row) => "…",            // shorter card rendering (e.g. "No. · date")
  // hideBelow?: "sm" | "md" | "lg", className?, headerClassName?, width?, align?
}
```

Phone card: title (bold) and subtitle on the left, `right` slots stacked on the right (the first one bold: the amount),
`meta` slots in a small wrapped row underneath. A table without `card` columns stays a (scrolling) table on phones.

**Filters** (`ServerFilterDefs`; memoise; the object's keys are the filter ids and the default URL/API param names):

```ts
{ kind: "options", label, options: [{ value, label, icon? }], param?, single?, facet?, hidden? }  // value: string[]
{ kind: "dateRange", label, fromParam? /* "from" */, toParam? /* "to" */, presets? }              // value: { from?, to? }
{ kind: "text", param? }   // value: string | undefined; fixed context from a link (?customerId=…), never in the toolbar
```

`hidden: true` keeps a filter in the URL/API but drops its toolbar button (e.g. branch on single-branch shops).
`st.filters.<id>` is `{ value, set }` for quick filters such as status pills. "Clear filters" clears search and every
options/date filter (not `text` ones), keeping sort and page size.

**Converting a list page (copy-paste):**

```tsx
"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { ChipGroup, DataTable, DataTableToolbar, type DataTableColumn } from "@srirealtime/ui";

const STATUSES = ["open", "done", "void"] as const;

export default function ThingsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <ThingsList />
    </React.Suspense>
  );
}

function ThingsList() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("things.filter.status"), options: STATUSES.map((s) => ({ value: s, label: t(`things.status.${s}`) })) },
        date: { kind: "dateRange", label: t("things.filter.date") },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<ThingSummary>[]>(
    () => [
      {
        id: "number", header: t("things.col.number"), sortable: true, hideable: false, card: "subtitle",
        cell: (r) => <ModuleLink to={`things/${r.id}`} className="font-medium hover:underline">{r.number}</ModuleLink>,
        cardCell: (r) => `${r.number} · ${formatDate(r.date)}`,
      },
      { id: "date", header: t("things.col.date"), sortable: true, sortDescFirst: true, cell: (r) => formatDate(r.date) },
      { id: "customer", header: t("things.col.customer"), sortable: true, hideable: false, card: "title", cell: (r) => r.customerName },
      { id: "status", header: t("things.col.status"), sortable: true, card: "right", cell: (r) => <ThingStatus status={r.status} /> },
      { id: "total", header: t("things.col.total"), sortable: true, numeric: true, card: "right", cell: (r) => money(r.total) },
    ],
    [t, formatDate],
  );

  const st = useServerTable<ThingSummary, typeof filters>({
    queryKey: ["things", "list"], // the prefix your mutations already invalidate
    path: "/things", // api.get(path, { limit, offset, sort, q, status, from, to })
    columns,
    filters,
    defaultSort: "-date", // = the route's defineSort default
    search: t("things.search"), // placeholder; omit for no search box
    storageKey: "things-list", // remembers hidden columns; shows the Columns menu
    // selectable: true,          // + <DataTable bulkActions={(rows, clear) => <Button …/>} />
    // params: { customerId },    // fixed extra API params (not in the URL)
  });

  const status = st.filters.status;
  return (
    <Page>
      <PageHeading title={t("things.title")} description={st.total !== undefined ? t("things.count", { count: st.total }) : undefined} />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          // optional pills bound to the same URL state
          <ChipGroup
            size="sm"
            aria-label={t("things.filter.status")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("things.all") },
              ...STATUSES.map((s) => ({ value: s, label: t(`things.status.${s}`), meta: st.facets?.status?.[s] })),
            ]}
          />
        }
      />
      {/* `empty`: optional first-run empty state; the filtered "No results" + Clear filters is built in */}
      <DataTable table={st.table} onRowClick={(r) => navigate(`things/${r.id}`)} />
    </Page>
  );
}
```

Notes for conversions:
- `queryKey` must start with the key your mutations invalidate (bills `["invoices", "list", "table"]`, orders
  `["orders", "list"]`). Optimistic updates that patch list caches must handle the table's plain `{ items, … }` cache
  as well as older infinite `{ pages }` caches (see `useUpdateStatus` in orders-ui).
- Row click ignores clicks on links, buttons, checkboxes and menus inside the row; keep a real `<ModuleLink>` in the
  identifying cell so middle-click / open in a new tab works.
- Strings: the table's own strings are `web.table.*` (English + Tamil) via `useDataTableLabels()`; pass headers, filter
  labels and option labels already translated with the module's `t()`.
- `defaultSort` must equal the route's `defineSort` default, and every `sortable` key must be in its map (an unknown
  key is a 400; the hook drops sort keys from the URL that no column declares).
- Small client-side lists keep the older props form `<DataTable columns data loading pagination? pageSize? />`;
  `useDataTable({...})` from `@srirealtime/ui` builds an instance for any other data source (you handle sort/paging).
- Pure, tested helpers: `parseTableState`, `serializeTableState`, `tableApiParams`, `patchTableState`,
  `clearTableFilters` (`packages/web/src/lib/server-table-state.ts`); `pageWindow`, `rangeInfo`, `nextSort`,
  `cardSlots`, `initialVisibility`, `readVisibility`/`writeVisibility`, `presetDateRange`
  (`packages/ui/src/components/data-table-model.ts`).

| Page | Sort | Filters | Notes |
|---|---|---|---|
| billing-ui Bills (`invoices`) | number, date, customer, total, balance, status (default `-date`) | status (multi, facet counts, + pills incl. overdue), date, paid by (payment method), branch (multi-branch shops), q | `customerId` text filter for links |
| orders-ui Orders (`orders`) | number, placed, customer, total, status (default `-placed`) | status (multi, facets, + pills), payment status, channel, date, q (number, name, phone, email) | row selection + bulk bar (mark packed, packing slips); the kanban board (`?view=board`) uses the same filters minus status |

### Dashboard

`/` (and a module's own overview, e.g. billing at `/billing`) is one structured page built from every mounted module's
`widgets` and `actions` (`packages/web/src/app/dashboard.tsx`); no app hard-codes it.

| Zone | What the widget renders | Layout |
|---|---|---|
| (header) | — built by the kit | greeting + date (IST) + one quick-actions bar: every visible `actions` entry, the app's main (`primary`) action first, de-duplicated by target and label, 4 visible (2 on phones), the rest under "More" |
| `setup` | a full-width strip (onboarding) | right under the header; hides itself when done or dismissed |
| `kpi` | `<KpiTile label value format? exact? hint? delta? spark? icon? to/href loading error>` | one row, first `KPI_LIMIT` (4) by priority; the first tile is the page's one accent tile; 2 columns on phones |
| `attention` | one or more `<AttentionItem label count tone icon to/href loading error>` | rows of the single "Needs attention" card, sorted danger → warning → info → neutral, bigger counts first; a row hides at zero; "All caught up" when nothing is left |
| `main` | a card | wide left column (charts, recent activity) |
| `side` | a card | narrow right column under "Needs attention" |
| `secondary` | `<InsightCard icon title to linkLabel value caption>` | "More insights": even grid (equal row heights), collapsible |

- `priority`: lower first inside a zone (default 100), ties keep module order. Widgets without `zone` keep working: `size: "sm"` → secondary, md/lg → main.
- Phones: header → setup → KPIs → needs attention → main → side → more insights.
- Every widget sits in its own Suspense (a skeleton shaped like its zone) and error boundary: one failing widget shows a retry card (or, in `attention`/`setup`, disappears); the page stays up.
- Feature / role / permission gating per widget is unchanged (`Gated`).
- Pure helpers: `layoutWidgets(app, visible, { modules?, kpiLimit? })`, `mergeQuickActions(app, visible, modules?)`, `widgetZone(w)` (`model.ts`, tested in `dashboard-model.test.ts`).

| Module | kpi | attention | main | side | secondary |
|---|---|---|---|---|---|
| billing-ui | sales this month (10), to collect (40), collected (45), overdue (50) | overdue bills, items low/out of stock | sales trend (10), recent bills (30) | payments by method (10), top dues (20), low stock (30) | — |
| orders-ui | orders today (20) | to confirm, to pack, to ship | recent orders (20) | — | — |
| site-ui | store visitors · 7 days + conversion (30) | reviews to approve | — | — | your store (10) |
| inbox-ui | — | tickets past due, tickets needing reply, unread chats, unread WhatsApp | — | — | — |
| marketplace-ui | — | seller applications, seller products to review | — | — | payable to sellers (30) |
| commerce-ui | — | — | — | — | catalogue (20) |
| growth-ui | — | — | — | — | loyalty (40), scheduled reports (50) |
| workspace-ui | setup: "Get set up" strip | | | | |

### Permission gating

Every `Gated` thing (nav sections and items, routes, widgets, quick actions, settings pages) can declare
`permission: "staff.manage"` or `permission: ["reports.view", "settings.manage"]`.

- **Source:** `permissions` from `GET /auth/me` (the staff module resolves the member's roles; `[]` without a tenant).
  `useSession()` exposes `permissions` and `can(req)`; `usePermission(req)` is the hook form.
- **Who passes:** owners, admins and platform super-admins always (same as the API's `requirePermission`). Others need
  a grant that matches. If `/auth/me` sent no `permissions` array at all (an API without the staff module), the check
  fails open; the API's 403 is still the last word.
- **Matching** is `@srirealtime/core`'s `permissionMatches`, mirrored in `packages/web/src/lib/permissions.ts` (the kit
  doesn't depend on core): `*` is everything; `orders.*` covers `orders`, `orders.ship`, `orders.returns.approve`; a
  middle `*` is one segment (`*.view` covers `reports.view`, not `reports.sales.view`).
- **Arrays are any-of** (holding one key is enough). Need all? Nest the item or check in the page.
- **`permissionExplicit: true`** counts only the key itself, `<module>.*` or `*` (not `*.view`), for API checks that do
  the same: the audit log refuses the staff default's `*.view`.
- **Order:** role → permission → feature. Hidden from nav/dashboard/actions/settings tabs when it fails; a route or
  settings page opened directly renders **"No access"** (`PermissionGatePage`, `web.gate.permissionTitle/Body`, English +
  Tamil) with a "Go home" button. A feature that is off still wins for people who hold the permission.
- **No flash:** the signed-in area waits for `/auth/me` and `/v1/features` before rendering any screen, so "No access"
  never shows while loading. Bare `/settings` (no `""` page) opens the first settings page the user may see.
- Writes inside a readable page stay in-page (`can()` / the module's own `usePermissions`), e.g. order actions.

| Module | Where | Permission |
|---|---|---|
| workspace-ui | Settings → Team & roles | `staff.manage` |
| workspace-ui | Settings → Activity log | `audit.view` (explicit) |
| workspace-ui | Settings → Import & export | `importexport.run` |
| billing-ui | Expenses nav + route | `expenses.manage` |
| orders-ui | `coupons/new` route (list and editor stay readable; save/delete in-page) | `coupons.manage` |
| orders-ui | Settings → Delivery | `settings.manage` |
| site-ui | Home page, Pages, Blog, Menus (nav + every editor route) | `cms.manage` |
| site-ui | Reviews (nav, route, dashboard widget) | `reviews.manage` |
| site-ui | Store analytics (nav, route, visitors widget) | `reports.view` |
| commerce-ui, orders-ui orders | — (writes checked in-page) | — |

### Billing features in the UI

| Feature | Nav / routes | Inside pages |
|---|---|---|
| `invoices` | Dashboard/overview, Bills, Customers, Items, business profile, public bill `i/:token` | — |
| `invoices.credit-book` | Credit book, public statement `s/:token`, "Receive money" action, Top dues widget | Customer: receive, share statement, ledger, credit limit; customer form credit section; "Open credit book" buttons; hero "Receive money"; "To collect" links to unpaid bills instead |
| `invoices.whatsapp` | — | "Send on WhatsApp" becomes "Share link"; message timeline; Remind buttons (credit book, customer, Top dues) |
| `invoices.reminders` | Settings → Reminders | — |
| `invoices.reports` | Reports, sales trend + payments-by-method widgets | Sales / Payments / Dues tabs |
| `invoices.gst-reports` | — | GST tab |
| `inventory` | Stock, Low stock widget | Items: stock column and links; item form opening stock; Stock report tab |
| `inventory.purchases` | Purchases, Suppliers, "Add purchase" action | Stock page "Add purchase"; hero shortcut; Purchases report tab |
| `payments` | Settings → Online payments | Public bill "Pay online" |
