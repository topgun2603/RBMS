import { DEFAULT_STORE_THEME } from "@srirealtime/branding/theme";
import { describe, expect, it } from "vitest";
import type { EditorItem } from "../lib/hidden";
import { appearanceTokens, brandTokens, itemKeyForSection, previewSections, previewViewOfPath } from "./live-preview-drafts";
import { liveMessages, liveEn, liveTa } from "./live-preview-messages";
import { cleanPath, editorMessage, enterUrl, fitScale, originOf, PREVIEW_DEVICES, readStoreMessage } from "./live-preview-protocol";

const STORE = "http://anbu.localhost:3003";
const frame = {};
const msg = (data: unknown, over: Partial<{ origin: string; source: unknown }> = {}) => ({ origin: STORE, source: frame, data, ...over });

describe("live preview protocol (editor side)", () => {
  it("accepts store messages only from the frame and the store origin", () => {
    const ready = { source: "sr-preview", v: 1, type: "ready", path: "/", protocol: 1 };
    expect(readStoreMessage(msg(ready), frame, STORE)).toEqual(ready);
    expect(readStoreMessage(msg(ready, { origin: "http://evil.localhost:3003" }), frame, STORE)).toBeNull();
    expect(readStoreMessage(msg(ready, { source: {} }), frame, STORE)).toBeNull();
    expect(readStoreMessage(msg(ready), null, STORE)).toBeNull();
    expect(readStoreMessage(msg({ ...ready, source: "x" }), frame, STORE)).toBeNull();
    expect(readStoreMessage(msg({ source: "sr-preview", v: 1, type: "select", sectionId: "" }), frame, STORE)).toBeNull();
    expect(readStoreMessage(msg({ source: "sr-preview", v: 1, type: "rendered", kind: "sections", ms: 140 }), frame, STORE)).not.toBeNull();
  });

  it("wraps editor messages in the envelope", () => {
    expect(editorMessage({ type: "select", id: "k1" })).toEqual({ source: "sr-preview", v: 1, type: "select", id: "k1" });
  });

  it("builds the enter URL with a clean path", () => {
    expect(enterUrl(STORE, "pv1.a.b", "/p/saree?x=1")).toBe(`${STORE}/api/preview/enter?token=pv1.a.b&path=%2Fp%2Fsaree%3Fx%3D1`);
    for (const bad of ["https://evil.com", "//evil.com", "/api/v1/x", "", null, "/\\x"]) expect(cleanPath(bad as string)).toBe("/");
    expect(originOf("http://anbu.localhost:3003/")).toBe(STORE);
    expect(originOf("javascript:alert(1)")).toBeNull();
  });

  it("scales device widths down to fit, never up", () => {
    expect(PREVIEW_DEVICES).toEqual({ phone: 390, tablet: 820, desktop: 1440 });
    expect(fitScale(1440, 720)).toBe(0.5);
    expect(fitScale(390, 800)).toBe(1);
    expect(fitScale(390, 0)).toBe(1);
  });
});

describe("drafts → preview payloads", () => {
  const appearance = {
    colors: { primary: "#9d174d", accent: null, background: "#fffaf0", foreground: null },
    fontSans: "Poppins",
    fontHeading: "Poppins",
    radius: 0.75,
    mode: "light" as const,
    theme: { ...DEFAULT_STORE_THEME, header: "bold" as const },
    preset: null,
  };

  it("appearance draft → tokens (nulls dropped, same heading font left out)", () => {
    expect(appearanceTokens(appearance)).toEqual({
      colors: { primary: "#9d174d", background: "#fffaf0" },
      fontSans: "Poppins",
      radius: 0.75,
      mode: "light",
      theme: appearance.theme,
    });
  });

  it("branding draft keeps the saved radius, theme and secondary colour", () => {
    const saved = { colors: { primary: "#000000", secondary: "#123456" }, fontSans: "Inter", radius: 1.25, mode: "light" as const, theme: { header: "split" } };
    const out = brandTokens({ logoUrl: "", logoDarkUrl: "", faviconUrl: "", colors: { primary: "#ff0000", accent: "#00ff00", background: null, foreground: null }, fontSans: "Mukta", fontHeading: "Lora", mode: "dark" }, saved);
    expect(out).toEqual({ radius: 1.25, theme: { header: "split" }, colors: { secondary: "#123456", primary: "#ff0000", accent: "#00ff00" }, fontSans: "Mukta", fontHeading: "Lora", mode: "dark" });
  });

  it("gives every section an id that maps back to its item", () => {
    const items: EditorItem[] = [
      { key: "k0", hidden: false, form: { type: "text", heading: "Hi", markdown: "x" } as never },
      { key: "k1", hidden: true, form: { type: "text", id: "about", heading: "About", markdown: "y" } as never },
    ];
    const s = previewSections(items);
    expect(s.map((x) => x.id)).toEqual(["k0", "about"]);
    expect(s[1]).toMatchObject({ hidden: true });
    expect(itemKeyForSection(items, "about")).toBe("k1");
    expect(itemKeyForSection(items, "k0")).toBe("k0");
    expect(itemKeyForSection(items, "zzz")).toBeNull();
  });
});

describe("labels", () => {
  it("has every key in Tamil and fills placeholders", () => {
    expect(Object.keys(liveTa).sort()).toEqual(Object.keys(liveEn).sort());
    expect(liveMessages("en")("updated", { ms: 120 })).toBe("Updated in 120 ms");
    expect(liveMessages("ta")("updated", { ms: 120 })).toContain("120");
  });
});

describe("appearance preview chips follow the frame", () => {
  it("maps store paths to the home / listing / product chip; other pages keep the current chip", () => {
    expect(previewViewOfPath("/")).toBe("home");
    expect(previewViewOfPath("/?utm=x")).toBe("home");
    expect(previewViewOfPath("/p/silk-saree")).toBe("product");
    expect(previewViewOfPath("/products?sort=new")).toBe("listing");
    expect(previewViewOfPath("/c/sarees")).toBe("listing");
    expect(previewViewOfPath("/collections/new-arrivals")).toBe("listing");
    expect(previewViewOfPath("/search?q=kurti")).toBe("listing");
    expect(previewViewOfPath("/pages/about")).toBeNull();
    expect(previewViewOfPath("/cart")).toBeNull();
  });
});

describe("store probe", () => {
  it("is up on any answer, down on a network failure, up (let the ready timeout decide) when slow", async () => {
    const { probeStore } = await import("./live-preview");
    const seen: string[] = [];
    expect(await probeStore(STORE, (async (u: string) => (seen.push(u), new Response(null, { status: 404 }))) as unknown as typeof fetch)).toBe(true);
    expect(seen).toEqual([`${STORE}/favicon.svg`]);
    expect(await probeStore(STORE, (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch)).toBe(false);
    expect(await probeStore(STORE, (async () => Promise.reject(new DOMException("aborted", "AbortError"))) as unknown as typeof fetch)).toBe(true);
  });
});
