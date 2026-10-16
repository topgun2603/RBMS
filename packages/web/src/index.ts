// @srirealtime/web: the shared client kit and the UI module system (docs/web-modules.md).

// API client, session, tenancy
export {
  api,
  apiDownload,
  apiUrl,
  absoluteUrl,
  ApiError,
  API_URL,
  configureApi,
  isPublicPath,
  onApiError,
  type ApiErrorEvent,
  type ApiOptions,
  type QueryParams,
} from "./lib/api";
export {
  getToken,
  setToken,
  useToken,
  useHydrated,
  useStored,
  readStored,
  writeStored,
  getStoredTenant,
  setStoredTenant,
  TOKEN_KEY,
  LOCALE_KEY,
  SIDEBAR_KEY,
  TENANT_KEY,
} from "./lib/session";
export {
  currentTenantSlug,
  getTenantStrategy,
  isValidShopSlug,
  RESERVED_SLUGS,
  validateSlug,
  rootDomain,
  rootUrl,
  shopUrl,
  tenantFromHost,
  useTenantSlug,
  type TenantStrategy,
} from "./lib/tenant";
export {
  useMe,
  meQueryKey,
  useSignOut,
  displayName,
  isSuperAdmin,
  hasShopAccess,
  canManageShop,
  effectiveRoles,
  roleAllows,
  SHOP_ROLES,
  MANAGER_ROLES,
} from "./lib/auth";
export * from "./lib/types";
export { permissionMatches, permissionsAllow, permissionAllows, explicitlyGranted, type PermissionReq, type PermissionHolder } from "./lib/permissions";
export { normalizeTarget, humanizeKey, formatPaise } from "./lib/format";
export * from "./lib/subscriptions";
export { useSubscriptionCurrent, usePublicPlans, subscriptionKeys } from "./lib/subscription-queries";
export {
  getStoredBranch,
  setStoredBranch,
  useStoredBranch,
  branchKey,
  isBranchError,
  BRANCH_HEADER,
  BRANCH_KEY_PREFIX,
} from "./lib/branch";
export { useDebounced } from "./lib/use-debounced";

// i18n, branding, features
export {
  I18nProvider,
  useI18n,
  tOr,
  describeError,
  isPlanLimit,
  isFeatureDisabled,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type Locale,
  type Messages,
  type MessageBundle,
  type Translator,
} from "./lib/i18n";
export { webMessages } from "./lib/messages";
export { ShopProvider, useShop, useOptionalShop, BrandingStyle, useDocumentBranding, useWebFonts, fontsInCss, brandingQueryKey } from "./lib/branding";
export {
  FeaturesProvider,
  useFeatures,
  useFeature,
  Feature,
  useToggleFeature,
  grantAllows,
  featureChecker,
  normalizeFeatures,
  featureKeys,
  type FeatureReq,
  type FeatureCheck,
} from "./lib/features";

// Components
export { WebProviders } from "./components/providers";
export { Page, PageHeading, DetailRow, SearchField, type PageWidth } from "./components/page";
export { QueryError } from "./components/query-state";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/confirm-dialog";
export { ThemeToggle } from "./components/theme-toggle";
export { LocaleSwitcher } from "./components/locale-switcher";
export { BrandMark } from "./components/brand-mark";
export { Splash } from "./components/splash";
export { SettingsNav } from "./components/settings-nav";
export { PlanBanner } from "./components/plan-banner";
export { UpgradeDialog, UpgradeDialogHost, limitName } from "./components/upgrade-dialog";
export {
  BranchSwitcher,
  useMyBranches,
  useCurrentBranch,
  pickCurrentBranch,
  myBranchesQueryKey,
  MULTI_BRANCH_FEATURE,
  type MyBranchItem,
  type MyBranchesResponse,
} from "./components/branch-switcher";
export { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useFormField } from "./components/form";

// Module system
export type {
  WebModule,
  WebApp,
  WebAppOptions,
  MountedModule,
  NavSection,
  NavItem,
  RouteDef,
  WidgetDef,
  WidgetZone,
  QuickAction,
  SettingsPage,
  Gated,
  IconType,
} from "./app/types";
export { createWebApp } from "./app/create-web-app";
export { WebAppRouter } from "./app/router";
export {
  ModuleLink,
  ModuleScope,
  useModule,
  useModuleHref,
  useModuleNavigate,
  useAppNavigate,
  useSettingsHref,
  useRouteParams,
  useQueryParams,
  useCurrentPath,
  useWebApp,
  useOptionalWebApp,
  joinPath,
  normalizeBase,
  type NavigateOptions,
} from "./app/navigation";
export { useSession, useOptionalSession, useVisible, usePermission, useGateContext, type SessionValue } from "./app/session";
export {
  layoutWidgets,
  mergeQuickActions,
  widgetZone,
  KPI_LIMIT,
  WIDGET_ZONES,
  type PlacedWidget,
  type MergedAction,
} from "./app/model";
export { buildNavModel, matchRoute, checkGate, visibleFor, type NavModel, type RouteMatch, type GateContext, type GateResult } from "./app/model";
export { Dashboard, ModuleDashboard, WidgetGrid } from "./app/dashboard";
export {
  KpiTile,
  KpiTileSkeleton,
  AttentionItem,
  InsightCard,
  Sparkline,
  type KpiTileProps,
  type AttentionItemProps,
  type AttentionTone,
  type InsightCardProps,
} from "./app/dashboard-parts";
export { AppFrame, useShellNav, useQuickActions } from "./app/shell";
export { LoginScreen } from "./app/login";
export { ShopGate } from "./app/shop-gate";
export { NotFound, FeatureGatePage, RoleGatePage, PermissionGatePage, featureName, featureModuleName } from "./app/gate";
