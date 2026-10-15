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
  widgets?: WidgetDef[];                       // dashboard cards: { id, feature?, size: "sm"|"md"|"lg", component }
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
interface WidgetDef extends Gated { id; size: "sm" | "md" | "lg"; rowSpan?: 1 | 2; component }
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
