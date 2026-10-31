/**
 * @rbms/storefront-ui — the shopper-facing store theme for Next.js (App Router).
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
export { ComparePage, compareMetadata } from "./pages/compare";
export { BundlesPage, bundlesMetadata } from "./pages/bundles";
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
export { HelpPage, helpMetadata, HelpArticlePage, helpArticleMetadata, RaiseTicketPage, MyTicketsPage, TicketPage, helpPrivateMetadata } from "./pages/help";
export { SellerPage, sellerMetadata, sellerJsonLd, sellerProductSummary } from "./pages/seller";
export { StoreNotFound } from "./pages/errors";
export { TableMenuPage, tableMetadata } from "./pages/table";
export { BookPage, bookMetadata, BookingPage, bookingMetadata, JobPage, jobMetadata } from "./pages/services";
export { WarrantyPage, warrantyMetadata, TrackRepairPage, trackRepairMetadata, JobTrackPage, jobTrackMetadata } from "./pages/aftersales";
export { StoreErrorView } from "./client/error-view";

// route handlers
export { proxyHandler, seoFileHandler, faviconHandler } from "./server/proxy";
export { previewEnterHandler, previewExitHandler } from "./server/preview-routes";
export { revalidateHandler, revalidateSecret, REVALIDATE_HEADER } from "./server/revalidate";
export { cacheResource, cacheTags, tagsToRevalidate, STORE_CACHE_RESOURCES, type StoreCacheResource } from "./lib/cache-tags";
export { getPreviewSession, getPreviewHome, isPreview, type PreviewSession } from "./server/preview";
export { PreviewMount } from "./pages/preview";

// server data helpers
export { getRequestInfo, getConfig, getBranding, getMenus, getCart, getFeatures, hasFeature, apiGet, apiGetOrNull, apiGetSafe, UpstreamError, CART_COOKIE } from "./server/api";
export { storeMetadata, toMetadata } from "./server/meta";

// pure helpers
export { tenantFromHost, upstreamTenantHeaders, hostName, isCustomDomain, ROOT_DOMAIN } from "./lib/tenant";
export { money, percentOff, imageUrl } from "./lib/format";
export { renderMarkdown, Markdown, safeHref } from "./lib/markdown";
export { en as storeMessagesEn, ta as storeMessagesTa, translatorFor, LOCALE_COOKIE } from "./lib/messages";
export { hrefWith, apiSearchQuery, PAGE_SIZE } from "./lib/url";
export { faqPageJsonLd, filterFaq } from "./lib/help";
export { featureOn, helpCentreOn, STORE_FEATURES } from "./lib/features";
export { isProxyAllowed } from "./server/proxy";

// components (server-safe)
export { ProductCard, ProductGrid, ProductGridSkeleton } from "./components/product-card";
export { ListingSkeleton, ProductPageSkeleton, CartSkeleton, CheckoutSkeleton, AccountSkeleton, TrackSkeleton, RailSkeleton, HelpSkeleton, SellerSkeleton, Bone } from "./components/skeletons";
export { TrustBadges, PaymentIcons } from "./components/trust";
export { EmptyBagArt, NoResultsArt, NoOrdersArt, EmptyWishlistArt, LostArt, OfflineArt } from "./components/illustrations";
export { SizeChart, sizeKindFor, sizeKindForGuide } from "./components/size-guide";
export { StoreImage, Price, Stars, JsonLd, Breadcrumbs, Container, Empty } from "./components/bits";

// client components
export { StoreProvider, useStore } from "./client/store-context";
export { StorePageTransition } from "./client/page-transition";

export type * from "./types";
