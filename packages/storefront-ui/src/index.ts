/**
 * @srirealtime/storefront-ui — the shopper-facing store theme for Next.js (App Router).
 *
 * Server pages (async server components + `*Metadata()` helpers) fetch the public API for the shop on the request host;
 * client components (cart, checkout, account, search, reviews) talk to the API through the same-origin proxy
 * (`proxyHandler`, mounted at `/api/v1/[...path]`). Import this barrel only from server files (pages, layouts, route
 * handlers): it re-exports server helpers that read request headers.
 */

// layout + metadata
export { StoreLayout, storeRootMetadata } from "./pages/layout";
export { HomePage, homeMetadata, HomeSectionView } from "./pages/home";
export {
  ProductsPage,
  SearchPage,
  CategoryPage,
  CollectionView,
  productsMetadata,
  searchMetadata,
  categoryMetadata,
  collectionMetadata,
} from "./pages/listing";
export { ProductPage, productMetadata } from "./pages/product";
export { OrderConfirmationPage, TrackPage, TrackLookupPage, orderMetadata, trackMetadata } from "./pages/order";
export {
  CmsPageView,
  cmsPageMetadata,
  BlogIndexPage,
  blogMetadata,
  BlogPostPage,
  postMetadata,
  PolicyPage,
  policyMetadata,
  CartPage,
  cartMetadata,
  CheckoutPage,
  checkoutMetadata,
  AccountPage,
  accountMetadata,
  Blocks,
} from "./pages/content";
export { StoreNotFound } from "./pages/errors";
export { StoreErrorView } from "./client/error-view";

// route handlers
export { proxyHandler, seoFileHandler, faviconHandler } from "./server/proxy";

// server data helpers
export { getRequestInfo, getConfig, getBranding, getMenus, getCart, apiGet, apiGetOrNull, apiGetSafe, UpstreamError, CART_COOKIE } from "./server/api";
export { storeMetadata, toMetadata } from "./server/meta";

// pure helpers
export { tenantFromHost, upstreamTenantHeaders, hostName, isCustomDomain, ROOT_DOMAIN } from "./lib/tenant";
export { money, percentOff, imageUrl } from "./lib/format";
export { renderMarkdown, Markdown, safeHref } from "./lib/markdown";
export { en as storeMessagesEn, ta as storeMessagesTa, translatorFor, LOCALE_COOKIE } from "./lib/messages";
export { hrefWith, apiSearchQuery, PAGE_SIZE } from "./lib/url";

// components (server-safe)
export { ProductCard, ProductGrid, ProductGridSkeleton } from "./components/product-card";
export { ListingSkeleton, ProductPageSkeleton, CartSkeleton, CheckoutSkeleton, AccountSkeleton, TrackSkeleton, RailSkeleton, Bone } from "./components/skeletons";
export { TrustBadges, PaymentIcons } from "./components/trust";
export { EmptyBagArt, NoResultsArt, NoOrdersArt, EmptyWishlistArt, LostArt, OfflineArt } from "./components/illustrations";
export { SizeChart, sizeKindFor } from "./components/size-guide";
export { StoreImage, Price, Stars, JsonLd, Breadcrumbs, Container, Empty } from "./components/bits";

// client components
export { StoreProvider, useStore } from "./client/store-context";
export { StorePageTransition } from "./client/page-transition";

export type * from "./types";
