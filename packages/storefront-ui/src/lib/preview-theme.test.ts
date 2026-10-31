import { DEFAULT_STORE_THEME, themeDataAttributes } from "@rbms/branding/theme";
import { describe, expect, it } from "vitest";
import { applyPreviewTheme, findSection, resetPreviewTheme, sectionBox, sectionIdOf } from "../client/preview-dom";
import { storeCss, themeView } from "../server/api";
import { configPatchFor, fontsHrefFor, previewThemeFrom, storeCssText } from "./preview-theme";

const TOKENS = { colors: { primary: "#9d174d", accent: "#fde68a" }, fontSans: "Poppins", fontHeading: "Playfair Display", radius: 1, theme: { header: "bold", buttons: "square" } };

describe("preview theme (pure)", () => {
  it("matches what the server layout renders for the same tokens", () => {
    const th = previewThemeFrom(TOKENS)!;
    const patch = configPatchFor(th.tokens);
    expect(th.css).toBe(storeCss(patch.css));
    expect(storeCssText("a</style>b")).toBe(storeCss("a</style>b"));
    expect(th.css).toContain("--radius: 1rem;");
    expect(th.css).toContain('--font-heading: "Playfair Display", var(--font-jakarta');
    expect(th.css).toContain("--sf-button-radius: 0.125rem");
    // data-sf-* exactly as the layout derives them from the (defaulted) theme view.
    const layoutAttrs = Object.fromEntries(Object.entries(themeView(patch.theme)).map(([k, v]) => [`data-sf-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]));
    expect(th.attributes).toEqual(layoutAttrs);
    expect(th.attributes["data-sf-header"]).toBe("bold");
    expect(th.fonts).toEqual(["Poppins", "Playfair Display"]);
    expect(th.fontsHref).toBe("https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&family=Playfair+Display:wght@400;700&display=swap");
  });

  it("rejects tokens that could inject CSS", () => {
    expect(previewThemeFrom({ colors: { primary: "red;}body{display:none" } })).toBeNull();
    expect(previewThemeFrom({ colors: { primary: "#112233" }, fontSans: 'x";}</style><script>' })).toBeNull();
    expect(previewThemeFrom({ colors: { primary: "#112233" }, theme: { header: "<b>" } })).toBeNull();
    expect(previewThemeFrom(null)).toBeNull();
    expect(fontsHrefFor(["system-ui", "Bad;Font"])).toBeNull();
  });

  it("fills defaults for a minimal token set", () => {
    const th = previewThemeFrom({ colors: { primary: "#112233" } })!;
    expect(th.attributes).toEqual({ ...themeDataAttributes(DEFAULT_STORE_THEME), "data-sf-page-layout": "standard", "data-sf-mobile-nav": "off" });
    expect(th.fonts).toEqual(["Inter"]);
  });
});

// ------------------------------------------------------------------ a tiny DOM, enough for preview-dom.ts

class El {
  attrs = new Map<string, string>();
  children: El[] = [];
  parentNode: El | null = null;
  textContent = "";
  style: Record<string, string> = {};
  rect = { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  constructor(
    public tag: string,
    private doc: Doc,
  ) {}
  get id() {
    return this.attrs.get("id") ?? "";
  }
  get nextSibling(): El | null {
    const sib = this.parentNode?.children ?? [];
    return sib[sib.indexOf(this) + 1] ?? null;
  }
  getAttribute(n: string) {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, String(v));
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  appendChild(c: El) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c: El, ref: El | null) {
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
    this.parentNode = null;
  }
  closest(sel: string): El | null {
    const attr = /^\[([a-z-]+)\]$/.exec(sel)?.[1];
    for (let e: El | null = this; e; e = e.parentNode) if (attr && e.attrs.has(attr)) return e;
    return null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  get firstElementChild(): El | null {
    return this.children[0] ?? null;
  }
}

class Doc {
  head = new El("head", this);
  body = new El("body", this);
  all(): El[] {
    const out: El[] = [];
    const walk = (e: El) => {
      out.push(e);
      e.children.forEach(walk);
    };
    walk(this.head);
    walk(this.body);
    return out;
  }
  createElement(tag: string) {
    return new El(tag, this);
  }
  getElementById(id: string) {
    return this.all().find((e) => e.id === id) ?? null;
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string) {
    if (sel === ".sf-root") return this.all().filter((e) => (e.getAttribute("class") ?? "").split(" ").includes("sf-root"));
    const attr = /^\[([a-z-]+)\]$/.exec(sel)?.[1];
    return attr ? this.all().filter((e) => e.attrs.has(attr)) : [];
  }
}

function storePage() {
  const doc = new Doc();
  const base = doc.createElement("style");
  base.setAttribute("id", "sr-branding");
  base.textContent = ":root{--primary:saved}";
  doc.head.appendChild(base);
  const root = doc.createElement("div");
  root.setAttribute("class", "sf-root");
  root.setAttribute("data-sf-header", "classic");
  root.setAttribute("data-sf-buttons", "pill");
  doc.body.appendChild(root);
  return { doc, base, root, d: doc as unknown as Document };
}

describe("preview DOM", () => {
  it("swaps the branding CSS, root attributes and fonts, and resets them", () => {
    const { doc, base, root, d } = storePage();
    const th = previewThemeFrom(TOKENS)!;
    applyPreviewTheme(d, th);
    const style = doc.getElementById("sr-preview-branding")!;
    expect(style.textContent).toBe(th.css);
    expect(base.nextSibling).toBe(style); // right after the server stylesheet
    expect(base.getAttribute("media")).toBe("not all");
    expect(base.textContent).toBe(":root{--primary:saved}");
    expect(root.getAttribute("data-sf-header")).toBe("bold");
    expect(root.getAttribute("data-sf-buttons")).toBe("square");
    expect(root.getAttribute("data-sf-brand-fonts")).toBe("");
    expect(doc.getElementById("sr-preview-fonts")!.getAttribute("href")).toBe(th.fontsHref);

    // Applying again updates in place (no duplicates).
    applyPreviewTheme(d, previewThemeFrom({ colors: { primary: "#112233" } })!);
    expect(doc.all().filter((e) => e.id === "sr-preview-branding")).toHaveLength(1);
    expect(root.getAttribute("data-sf-header")).toBe("classic");
    expect(root.getAttribute("data-sf-brand-fonts")).toBeNull();

    resetPreviewTheme(d);
    expect(doc.getElementById("sr-preview-branding")).toBeNull();
    expect(doc.getElementById("sr-preview-fonts")).toBeNull();
    expect(base.getAttribute("media")).toBeNull();
    expect(root.getAttribute("data-sf-header")).toBe("classic");
    expect(root.getAttribute("data-sf-buttons")).toBe("pill");
    expect(root.getAttribute("data-sf-card")).toBeNull(); // attributes the server didn't render are removed again
  });

  it("finds sections by id (by value) and measures display:contents wrappers", () => {
    const { doc, root, d } = storePage();
    const wrap = doc.createElement("div");
    wrap.setAttribute("data-section-id", 'k1"]');
    const a = doc.createElement("section");
    a.rect = { top: 100, left: 0, width: 400, height: 50, bottom: 150, right: 400 };
    const b = doc.createElement("section");
    b.rect = { top: 150, left: 10, width: 300, height: 100, bottom: 250, right: 310 };
    wrap.appendChild(a);
    wrap.appendChild(b);
    root.appendChild(wrap);
    expect(findSection(d, 'k1"]')).toBe(wrap);
    expect(findSection(d, "nope")).toBeNull();
    expect(sectionIdOf(b as unknown as EventTarget)).toBe('k1"]');
    expect(sectionIdOf(root as unknown as EventTarget)).toBeNull();
    expect(sectionBox(wrap as unknown as Element)).toEqual({ top: 100, left: 0, width: 400, height: 150 });
  });
});
