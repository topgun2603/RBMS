import { describe, expect, it } from "vitest";
import { previewRouting } from "../preview";
import { previewCookie } from "../server/preview-routes";
import {
  editorMessage,
  editorMessageSchema,
  editorOrigins,
  frameAncestors,
  isAllowedOrigin,
  looksLikePreviewToken,
  originRegex,
  readEditorMessage,
  safePreviewPath,
  storeMessage,
  storeMessageSchema,
} from "./preview-protocol";

const DEV = editorOrigins({ NODE_ENV: "development" });
const PROD = editorOrigins({ NODE_ENV: "production", NEXT_PUBLIC_ROOT_DOMAIN: "rbms.in" });

describe("editor origins", () => {
  it("dev: any localhost port, subdomains included", () => {
    for (const o of ["http://localhost:3002", "http://anbu.localhost:3002", "http://anbu.localhost:3007", "http://127.0.0.1:3000"]) expect(isAllowedOrigin(o, DEV)).toBe(true);
    for (const o of ["https://evil.com", "http://localhost.evil.com:3002", "http://a.b.localhost:3002", "null", "", "http://evil.com/http://localhost:3002"]) expect(isAllowedOrigin(o, DEV)).toBe(false);
  });

  it("prod: https root domain and one-label subdomains only", () => {
    expect(PROD).toEqual(["https://rbms.in", "https://*.rbms.in"]);
    expect(isAllowedOrigin("https://anbu.rbms.in", PROD)).toBe(true);
    expect(isAllowedOrigin("https://rbms.in", PROD)).toBe(true);
    expect(isAllowedOrigin("http://anbu.rbms.in", PROD)).toBe(false);
    expect(isAllowedOrigin("https://anbu.rbms.in.evil.com", PROD)).toBe(false);
    expect(isAllowedOrigin("https://evilrbms.in", PROD)).toBe(false);
    expect(isAllowedOrigin("https://x.y.rbms.in", PROD)).toBe(false);
    expect(isAllowedOrigin("https://anbu.rbms.in:8443", PROD)).toBe(false);
  });

  it("PREVIEW_EDITOR_ORIGINS overrides (invalid entries dropped)", () => {
    const o = editorOrigins({ NODE_ENV: "production", PREVIEW_EDITOR_ORIGINS: "https://app.example.com, javascript:alert(1), https://*.shops.example.com" });
    expect(o).toEqual(["https://app.example.com", "https://*.shops.example.com"]);
    expect(isAllowedOrigin("https://raja.shops.example.com", o)).toBe(true);
  });

  it("patterns are anchored and escaped", () => {
    expect(originRegex("https://a.b")!.test("https://aXb")).toBe(false);
    expect(originRegex("ftp://x.com")).toBeNull();
    expect(originRegex("https://x.com/path")).toBeNull();
    expect(frameAncestors(PROD)).toBe("'self' https://rbms.in https://*.rbms.in");
  });
});

describe("messages", () => {
  it("accepts well-formed editor messages from allowed origins only", () => {
    const m = editorMessage({ type: "select", id: "k1" });
    expect(readEditorMessage({ origin: "http://anbu.localhost:3002", data: m }, DEV)).toEqual(m);
    expect(readEditorMessage({ origin: "https://evil.com", data: m }, DEV)).toBeNull();
    expect(readEditorMessage({ origin: "http://anbu.localhost:3002", data: { ...m, source: "other" } }, DEV)).toBeNull();
    expect(readEditorMessage({ origin: "http://anbu.localhost:3002", data: { ...m, v: 2 } }, DEV)).toBeNull();
    expect(readEditorMessage({ origin: "http://anbu.localhost:3002", data: "string" }, DEV)).toBeNull();
  });

  it("validates payloads", () => {
    const ok = (d: unknown) => editorMessageSchema.safeParse(d).success;
    expect(ok(editorMessage({ type: "theme", tokens: { colors: { primary: "#112233" } } }))).toBe(true);
    expect(ok(editorMessage({ type: "sections", sections: [{ type: "text", id: "k0" }] }))).toBe(true);
    expect(ok({ ...editorMessage({ type: "sections", sections: [] }), sections: Array.from({ length: 41 }, () => ({})) })).toBe(false);
    expect(ok({ ...editorMessage({ type: "select", id: null }), id: "x".repeat(41) })).toBe(false);
    expect(ok({ ...editorMessage({ type: "mode", mode: "edit" }), mode: "god" })).toBe(false);
    expect(ok({ source: "sr-preview", v: 1, type: "eval", code: "1" })).toBe(false);
    expect(storeMessageSchema.safeParse(storeMessage({ type: "rendered", kind: "sections", ms: 120 })).success).toBe(true);
  });
});

describe("paths and tokens", () => {
  it("keeps same-origin store paths only", () => {
    expect(safePreviewPath("/")).toBe("/");
    expect(safePreviewPath("/p/saree?size=m#reviews")).toBe("/p/saree?size=m#reviews");
    expect(safePreviewPath("/c/sarees?__preview=x&page=2")).toBe("/c/sarees?page=2");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/api/v1/auth/me", "/api", "p/x", "/a\nb", 5, null]) expect(safePreviewPath(bad)).toBeNull();
  });

  it("shape-checks tokens", () => {
    expect(looksLikePreviewToken(`pv1.${"a".repeat(40)}.${"b".repeat(43)}`)).toBe(true);
    expect(looksLikePreviewToken("pv1.x.y")).toBe(false);
    expect(looksLikePreviewToken(`pv1.${"a".repeat(40)}.${"b".repeat(43)};x=1`)).toBe(false);
  });
});

describe("middleware routing + cookie", () => {
  it("turns ?__preview into the enter route and marks preview responses private", () => {
    const r = previewRouting(new URL("http://anbu.localhost:3003/c/sarees?__preview=TOKEN&page=2"), false, DEV);
    expect(r).toEqual({ action: "enter", location: "/api/preview/enter?token=TOKEN&path=%2Fc%2Fsarees%3Fpage%3D2" });
    expect(previewRouting(new URL("http://anbu.localhost:3003/"), false, DEV)).toEqual({ action: "pass" });
    const p = previewRouting(new URL("http://anbu.localhost:3003/"), true, PROD);
    expect(p.action).toBe("preview");
    if (p.action === "preview") {
      expect(p.headers["cache-control"]).toContain("no-store");
      expect(p.headers["content-security-policy"]).toBe("frame-ancestors 'self' https://rbms.in https://*.rbms.in");
    }
  });

  it("builds an httpOnly cookie; partitioned SameSite=None on https", () => {
    expect(previewCookie("pv1.a.b", 1799.6, false)).toBe("sr_preview=pv1.a.b; Path=/; HttpOnly; Max-Age=1799; SameSite=Lax");
    expect(previewCookie("pv1.a.b", 60, true)).toBe("sr_preview=pv1.a.b; Path=/; HttpOnly; Max-Age=60; SameSite=None; Secure; Partitioned");
    expect(previewCookie("", -5, false)).toContain("Max-Age=0");
  });
});
