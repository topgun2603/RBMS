/**
 * @rbms/storefront-ui/pwa — the installable storefront (manifest, app icons, service worker, offline page) as
 * route handlers, plus the per-shop root viewport (theme-color). Server-only (route handlers / layouts).
 */
export { manifestHandler, appIconHandler, renderAppIcon, serviceWorkerHandler, offlinePageHandler, serviceWorkerSource, offlinePageHtml, pwaShop, storeBuildId, uploadPrefixes, OFFLINE_URL, type PwaShop, type PwaStoreConfig } from "./server/pwa";
export { storeViewport } from "./pages/layout";
export * from "./lib/pwa";
