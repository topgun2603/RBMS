import { StorePageTransition } from "@srirealtime/storefront-ui/client";

/** Re-mounts on every navigation: the storefront fades / lifts the new page in (never the first, server-rendered one). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <StorePageTransition>{children}</StorePageTransition>;
}
