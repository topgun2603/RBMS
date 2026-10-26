import { describe, expect, it } from "vitest";
import { isProxyAllowed } from "./proxy";

const ID = "9462c32e-79ff-42ad-89db-131cf80e76a7";

describe("store proxy: try-on reads", () => {
  it("lets the browser read a product's try-on setup and the shop's public image files, read-only", () => {
    expect(isProxyAllowed(`/v1/ai/imaging/public/tryon/${ID}`, "GET")).toBe(true);
    expect(isProxyAllowed(`/v1/uploads/files/t/${ID}/product-cleanup/2026/10/abc-tryon-x.png`, "GET")).toBe(true);
    expect(isProxyAllowed(`/v1/uploads/files/t/${ID}/product-cleanup/2026/10/abc-tryon-x.png`, "HEAD")).toBe(true);
    expect(isProxyAllowed(`/v1/ai/imaging/public/tryon/${ID}`, "DELETE")).toBe(false);
    expect(isProxyAllowed(`/v1/uploads/files/t/${ID}/a.png`, "PUT")).toBe(false);
  });
  it("keeps everything else of the owner-side imaging and uploads areas closed", () => {
    expect(isProxyAllowed("/v1/ai/imaging/status")).toBe(false);
    expect(isProxyAllowed("/v1/ai/imaging/cleanups")).toBe(false);
    expect(isProxyAllowed(`/v1/ai/imaging/tryon/${ID}`)).toBe(false);
    expect(isProxyAllowed("/v1/uploads/sign", "POST")).toBe(false);
    expect(isProxyAllowed("/v1/uploads/files/../../etc/passwd")).toBe(false);
    expect(isProxyAllowed(`/v1/uploads/files/t/${ID}/../../x.png`)).toBe(false);
    expect(isProxyAllowed(`/v1/ai/imaging/public/tryon/${ID}/extra`)).toBe(false);
  });
});

describe("shopper AI chat through the store proxy (AI Phase 4 part B)", () => {
  it("reaches only the chat status (GET), the chat (POST) and the together read (GET)", () => {
    expect(isProxyAllowed("/v1/ai/store/public/chat/status", "GET")).toBe(true);
    expect(isProxyAllowed("/v1/ai/store/public/chat", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/ai/store/public/chat", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/ai/store/public/chat/status", "POST")).toBe(false);
    expect(isProxyAllowed("/v1/ai/store/aliases/x", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/ai/store/pricing-hints", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/ai/store/chat/settings", "PUT")).toBe(false);
    expect(isProxyAllowed("/v1/ai/ask", "POST")).toBe(false);
  });
});
