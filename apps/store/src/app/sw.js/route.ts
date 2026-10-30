import { serviceWorkerHandler } from "@rbms/storefront-ui/pwa";

/** The storefront service worker (one script for every shop, versioned by the build id). Registered in production only. */
export const GET = serviceWorkerHandler;
