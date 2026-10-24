import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDeviceToken } from "./api";
import { ShopBranding, shopBrandingQuery } from "./branding";
import { adminBrandingCss } from "./branding-css";

/**
 * ShopBranding: a shop's branding on public routes (POS terminal mode: a paired device has no staff session, so
 * ShopGate's ShopProvider never runs). Shapes as GET /v1/branding returns them for a dark, yellow-brand shop.
 */
const MURUGAN = `:root {
  color-scheme: dark;
  --background: oklch(0.19 0.007 258.369);
  --foreground: oklch(0.954 0.003 247.859);
  --card: oklch(0.247 0.006 258.361);
  --primary: oklch(0.861 0.173 91.936);
  --primary-foreground: oklch(0.145 0 0);
  --ring: oklch(0.861 0.173 91.936);
  --radius: 0rem;
}
`;

describe("ShopBranding (public routes, paired POS terminals)", () => {
  afterEach(() => {
    setDeviceToken(null);
    vi.unstubAllGlobals();
  });

  it("asks GET /v1/branding with the device token and no staff sign-in", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ appName: "Murugan Hardwares", css: MURUGAN }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    setDeviceToken("dev-1");
    const q = shopBrandingQuery("murugan", "device");
    expect(q.queryKey).toEqual(["branding", "murugan", "public", "device"]);
    const data = await q.queryFn();
    expect(data.css).toBe(MURUGAN);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/branding$/);
    const headers = new Headers(init.headers);
    expect(headers.get("x-device-token")).toBe("dev-1");
    expect(headers.get("authorization")).toBeNull();
    // No shop known yet (root address): keyed apart, the API resolves the shop from the device.
    expect(shopBrandingQuery(null, "device").queryKey).toEqual(["branding", "device", "public", "device"]);
  });

  it("renders the same light/dark-aware style as the signed-in apps", () => {
    const client = new QueryClient();
    client.setQueryData(shopBrandingQuery("murugan", "device").queryKey, { appName: "Murugan Hardwares", logoUrl: null, css: MURUGAN });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ShopBranding slug="murugan" via="device" />
      </QueryClientProvider>,
    );
    const css = adminBrandingCss(MURUGAN);
    expect(html).toContain('<style id="sr-branding">');
    expect(html).toContain(css.slice(0, 60));
    // The yellow primary is applied, and the dark palette only in dark mode (adminBrandingCss).
    expect(css).toContain("0.861 0.173 91.936");
    expect(css).toMatch(/\.dark/);
  });

  it("renders nothing until the branding is in, or for a shop without branding CSS", () => {
    const client = new QueryClient();
    const empty = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ShopBranding slug="murugan" enabled={false} />
      </QueryClientProvider>,
    );
    expect(empty).toBe("");
    client.setQueryData(shopBrandingQuery("plain").queryKey, { appName: null, logoUrl: null, css: "" });
    expect(
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <ShopBranding slug="plain" />
        </QueryClientProvider>,
      ),
    ).toBe("");
  });
});
