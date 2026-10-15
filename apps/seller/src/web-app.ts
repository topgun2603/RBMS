import { marketplaceModule } from "@srirealtime/marketplace-ui";
import { createWebApp } from "@srirealtime/web";

/**
 * The seller app: the marketplace seller portal at "/" for a shop's marketplace sellers. The shop comes from the
 * subdomain (anbu.localhost:3004). Sellers sign in with the kit's OTP login (/login); signed-in users who aren't a
 * seller yet see the apply screen.
 */
export const webApp = createWebApp({
  appId: "EC",
  name: "Seller",
  tenant: { from: "hostname" },
  modules: [marketplaceModule({ portal: "vendor", basePath: "/" })],
  home: "dashboard",
});
